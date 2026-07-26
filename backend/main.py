"""
AdikeLive API — authentic arecanut prices from AGMARKNET + data.gov.in
"""

from __future__ import annotations

import asyncio
import re
import time
from datetime import date, datetime, timedelta
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend import agent_store

COMMODITY = "Arecanut(Betelnut/Supari)"
DATAGOV_RESOURCE = "9ef84268-d588-465a-a308-a864a43d0070"
DATAGOV_KEY = "579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b"

# Primary grower state (fast default). Expand via ?states= or scope=india
DEFAULT_STATES = ["Karnataka"]
ALL_INDIA_STATES = [
    "Karnataka",
    "Kerala",
    "Meghalaya",
    "Assam",
    "Goa",
    "Maharashtra",
    "Uttar Pradesh",
]

SHIVAMOGGA_MARKETS = {
    "shimoga",
    "shivamogga",
    "bhadravathi",
    "shikaripura",
    "sagar",
    "sorabha",
    "thirthahalli",
    "apmc thirthahalli",
    "hosanagara",
}

CACHE_TTL_SECONDS = 180  # 3 minutes live cache
_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0, "meta": {}}

app = FastAPI(
    title="Araka Net API",
    description="Live Arecanut (Adike) market prices from official AGMARKNET sources",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PriceRecord(BaseModel):
    id: str
    state: str
    district: str
    market: str
    commodity: str
    variety: str
    grade: str
    arrival_date: str
    min_price: float
    max_price: float
    modal_price: float
    arrival_qty: float | None = None
    unit: str = "Rs./Quintal"
    change: float | None = None
    change_pct: float | None = None
    is_shivamogga: bool = False
    source: str = "AGMARKNET"


class SummaryStats(BaseModel):
    avg_modal: float
    highest: float
    lowest: float
    markets: int
    varieties: int
    states: int
    records: int
    latest_date: str | None = None
    shivamogga_avg: float | None = None


class PricesResponse(BaseModel):
    updated_at: str
    source: str
    cache_age_seconds: int
    summary: SummaryStats
    records: list[PriceRecord]
    history: list[dict[str, Any]] = Field(default_factory=list)
    top_markets: list[dict[str, Any]] = Field(default_factory=list)


def _parse_number(value: Any) -> float:
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "").strip()
    try:
        return float(text) if text else 0.0
    except ValueError:
        return 0.0


def _parse_date(value: str) -> date | None:
    if not value:
        return None
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def _format_date(d: date) -> str:
    return d.strftime("%d-%m-%Y")


def _is_shivamogga(district: str, market: str) -> bool:
    d = (district or "").lower()
    m = (market or "").lower()
    if "shivamogga" in d or "shimoga" in d:
        return True
    return any(token in m for token in SHIVAMOGGA_MARKETS)


def _slug(*parts: str) -> str:
    raw = "|".join(parts).lower()
    return re.sub(r"[^a-z0-9]+", "-", raw).strip("-")


def _fetch_agmarknet_state(state: str, from_date: str, to_date: str) -> list[dict]:
    """Fetch authentic AGMARKNET rows for one state via official SDK."""
    from agmarknet import Agmarknet
    from agmarknet.exceptions import AgmarknetError

    api = Agmarknet()
    try:
        df = api.report(
            from_date=from_date,
            to_date=to_date,
            commodity=COMMODITY,
            state=state,
            data_type="both",
            limit=1000,
        )
    except AgmarknetError:
        return []
    except Exception:
        return []

    if df is None or getattr(df, "empty", True):
        return []

    rows: list[dict] = []
    for _, row in df.iterrows():
        rows.append(
            {
                "state": str(row.get("state_name") or state),
                "district": str(row.get("district_name") or ""),
                "market": str(row.get("market_name") or ""),
                "commodity": str(row.get("cmdt_name") or COMMODITY),
                "variety": str(row.get("variety_name") or "Other"),
                "grade": str(row.get("grade_name") or ""),
                "arrival_date": str(row.get("arrival_date") or ""),
                "min_price": _parse_number(row.get("min_price")),
                "max_price": _parse_number(row.get("max_price")),
                "modal_price": _parse_number(row.get("model_price")),
                "arrival_qty": _parse_number(row.get("arrival_qty")) or None,
                "unit": str(row.get("unit_name_price") or "Rs./Quintal"),
                "source": "AGMARKNET",
            }
        )
    return rows


async def _fetch_datagovin() -> list[dict]:
    """Supplement with today's open-data feed (data.gov.in / AGMARKNET)."""
    url = f"https://api.data.gov.in/resource/{DATAGOV_RESOURCE}"
    params = {
        "api-key": DATAGOV_KEY,
        "format": "json",
        "limit": 100,
        "filters[commodity]": COMMODITY,
    }
    try:
        async with httpx.AsyncClient(timeout=25.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            payload = resp.json()
    except Exception:
        return []

    rows: list[dict] = []
    for rec in payload.get("records") or []:
        rows.append(
            {
                "state": rec.get("state") or "",
                "district": rec.get("district") or "",
                "market": rec.get("market") or "",
                "commodity": rec.get("commodity") or COMMODITY,
                "variety": rec.get("variety") or "Other",
                "grade": rec.get("grade") or "",
                "arrival_date": rec.get("arrival_date") or "",
                "min_price": _parse_number(rec.get("min_price")),
                "max_price": _parse_number(rec.get("max_price")),
                "modal_price": _parse_number(rec.get("modal_price")),
                "arrival_qty": None,
                "unit": "Rs./Quintal",
                "source": "data.gov.in",
            }
        )
    return rows


def _normalize(raw_rows: list[dict]) -> list[PriceRecord]:
    # Group by market+variety for day-over-day change
    by_key: dict[str, list[dict]] = {}
    for row in raw_rows:
        key = _slug(row["state"], row["district"], row["market"], row["variety"])
        by_key.setdefault(key, []).append(row)

    records: list[PriceRecord] = []
    for key, items in by_key.items():
        items.sort(
            key=lambda r: _parse_date(r["arrival_date"]) or date.min,
            reverse=True,
        )
        latest = items[0]
        prev = items[1] if len(items) > 1 else None
        change = None
        change_pct = None
        if prev and latest["modal_price"] and prev["modal_price"]:
            change = round(latest["modal_price"] - prev["modal_price"], 2)
            if prev["modal_price"]:
                change_pct = round((change / prev["modal_price"]) * 100, 2)

        records.append(
            PriceRecord(
                id=key,
                state=latest["state"],
                district=latest["district"],
                market=latest["market"],
                commodity=latest["commodity"],
                variety=latest["variety"],
                grade=latest["grade"],
                arrival_date=latest["arrival_date"],
                min_price=latest["min_price"],
                max_price=latest["max_price"],
                modal_price=latest["modal_price"],
                arrival_qty=latest.get("arrival_qty"),
                unit=latest.get("unit") or "Rs./Quintal",
                change=change,
                change_pct=change_pct,
                is_shivamogga=_is_shivamogga(latest["district"], latest["market"]),
                source=latest.get("source") or "AGMARKNET",
            )
        )

    records.sort(key=lambda r: (not r.is_shivamogga, -r.modal_price, r.market))
    return records


def _build_history(raw_rows: list[dict], days: int = 30) -> list[dict[str, Any]]:
    cutoff = date.today() - timedelta(days=days)
    buckets: dict[str, list[float]] = {}
    for row in raw_rows:
        d = _parse_date(row["arrival_date"])
        if not d or d < cutoff or not row["modal_price"]:
            continue
        key = d.isoformat()
        buckets.setdefault(key, []).append(row["modal_price"])

    history = []
    for day in sorted(buckets.keys()):
        vals = buckets[day]
        history.append(
            {
                "date": day,
                "avg": round(sum(vals) / len(vals), 2),
                "min": round(min(vals), 2),
                "max": round(max(vals), 2),
                "count": len(vals),
            }
        )
    return history


def _build_top_markets(records: list[PriceRecord], limit: int = 8) -> list[dict]:
    # Prefer latest modal per market (highest variety)
    by_market: dict[str, PriceRecord] = {}
    for rec in records:
        key = f"{rec.market}|{rec.district}"
        existing = by_market.get(key)
        if existing is None or rec.modal_price > existing.modal_price:
            by_market[key] = rec
    ranked = sorted(by_market.values(), key=lambda r: r.modal_price, reverse=True)
    return [
        {
            "market": r.market,
            "district": r.district,
            "state": r.state,
            "variety": r.variety,
            "modal_price": r.modal_price,
            "change_pct": r.change_pct,
            "is_shivamogga": r.is_shivamogga,
            "arrival_date": r.arrival_date,
        }
        for r in ranked[:limit]
    ]


def _summary(records: list[PriceRecord]) -> SummaryStats:
    if not records:
        return SummaryStats(
            avg_modal=0,
            highest=0,
            lowest=0,
            markets=0,
            varieties=0,
            states=0,
            records=0,
        )
    modals = [r.modal_price for r in records if r.modal_price > 0]
    shiv = [r.modal_price for r in records if r.is_shivamogga and r.modal_price > 0]
    dates = [_parse_date(r.arrival_date) for r in records]
    latest = max((d for d in dates if d), default=None)
    return SummaryStats(
        avg_modal=round(sum(modals) / len(modals), 2) if modals else 0,
        highest=max(modals) if modals else 0,
        lowest=min(modals) if modals else 0,
        markets=len({(r.market, r.district) for r in records}),
        varieties=len({r.variety for r in records}),
        states=len({r.state for r in records}),
        records=len(records),
        latest_date=_format_date(latest) if latest else None,
        shivamogga_avg=round(sum(shiv) / len(shiv), 2) if shiv else None,
    )


async def _load_prices(days: int, states: list[str], force: bool = False) -> PricesResponse:
    now = time.time()
    cache_key = f"{days}|{','.join(sorted(states))}"
    if (
        not force
        and _cache["data"] is not None
        and _cache.get("key") == cache_key
        and now - _cache["fetched_at"] < CACHE_TTL_SECONDS
    ):
        cached: PricesResponse = _cache["data"]
        return cached.model_copy(
            update={"cache_age_seconds": int(now - _cache["fetched_at"])}
        )

    to_d = date.today()
    from_d = to_d - timedelta(days=max(days, 7))
    from_s, to_s = from_d.isoformat(), to_d.isoformat()

    loop = asyncio.get_event_loop()
    tasks = [
        loop.run_in_executor(None, _fetch_agmarknet_state, state, from_s, to_s)
        for state in states
    ]
    results = await asyncio.gather(*tasks)
    raw: list[dict] = []
    for batch in results:
        raw.extend(batch)

    # Merge open-data live feed (may include same-day extras)
    datagov = await _fetch_datagovin()
    raw.extend(datagov)

    records = _normalize(raw)
    history = _build_history(raw, days=days)
    response = PricesResponse(
        updated_at=datetime.now().isoformat(timespec="seconds"),
        source="AGMARKNET (api.agmarknet.gov.in) + data.gov.in",
        cache_age_seconds=0,
        summary=_summary(records),
        records=records,
        history=history,
        top_markets=_build_top_markets(records),
    )

    _cache["data"] = response
    _cache["fetched_at"] = now
    _cache["key"] = cache_key
    return response


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "Araka Net",
        "commodity": COMMODITY,
        "sources": ["AGMARKNET", "data.gov.in", "community_agent_quotes"],
        "agent_data_note": (
            "Private local-agent asking rates are not published by AGMARKNET. "
            "Araka Net stores community-reported agent quotes and compares them to official mandi modal."
        ),
    }


@app.get("/api/prices", response_model=PricesResponse)
async def get_prices(
    days: int = Query(14, ge=3, le=60),
    states: str | None = Query(None, description="Comma-separated state names"),
    scope: str = Query("karnataka", description="'karnataka' or 'india'"),
    refresh: bool = Query(False),
):
    if states:
        state_list = [s.strip() for s in states.split(",") if s.strip()]
    elif scope.lower() == "india":
        state_list = ALL_INDIA_STATES
    else:
        state_list = DEFAULT_STATES
    return await _load_prices(days=days, states=state_list, force=refresh)


@app.get("/api/history")
async def get_market_history(
    market: str = Query(..., min_length=2),
    variety: str | None = None,
    days: int = Query(30, ge=7, le=90),
):
    data = await _load_prices(days=days, states=DEFAULT_STATES)
    # Rebuild from cached raw via records is insufficient; use history of matching market
    # Re-fetch focused Karnataka window if needed — use records' change path by filtering raw from cache
    # For simplicity, derive daily series from all records matching market in full payload:
    # We store only latest per variety; so call agmarknet again for Karnataka.
    from_d = (date.today() - timedelta(days=days)).isoformat()
    to_d = date.today().isoformat()
    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(
        None, _fetch_agmarknet_state, "Karnataka", from_d, to_d
    )
    market_l = market.lower()
    filtered = [
        r
        for r in raw
        if market_l in r["market"].lower()
        and (not variety or variety.lower() in r["variety"].lower())
    ]
    buckets: dict[str, list[float]] = {}
    for row in filtered:
        d = _parse_date(row["arrival_date"])
        if not d or not row["modal_price"]:
            continue
        buckets.setdefault(d.isoformat(), []).append(row["modal_price"])

    series = [
        {
            "date": day,
            "avg": round(sum(vals) / len(vals), 2),
            "min": round(min(vals), 2),
            "max": round(max(vals), 2),
            "count": len(vals),
        }
        for day, vals in sorted(buckets.items())
    ]
    return {
        "market": market,
        "variety": variety,
        "series": series,
        "source": "AGMARKNET",
    }


class AgentQuoteIn(BaseModel):
    variety_key: str = Field(..., description="sarakku|bede|rashi|andal")
    rate: float = Field(..., description="₹ per quintal purchase amount")
    district: str
    market: str | None = "Local agent"
    note: str | None = None
    quote_date: str | None = None
    lat: float | None = None
    lng: float | None = None


@app.get("/api/agent-quotes")
async def get_agent_quotes(
    district: str | None = Query(None),
    variety_key: str | None = Query(None),
    days: int = Query(30, ge=1, le=90),
):
    quotes = agent_store.list_quotes(district=district, variety_key=variety_key, days=days)
    averages = agent_store.averages_by_variety(district=district, days=days)
    return {
        "source": "user_submissions",
        "note": (
            "Local agent rates come only from users/agents who submit their actual purchase "
            "amounts on this website for their GPS location. The shown rate is the average of "
            "all submissions for that district + variety. AGMARKNET does not publish private agent quotes."
        ),
        "count": len(quotes),
        "averages_by_variety": averages,
        "quotes": quotes,
    }


@app.post("/api/agent-quotes")
async def post_agent_quote(body: AgentQuoteIn):
    try:
        row = agent_store.add_quote(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "quote": row}


@app.on_event("startup")
async def warmup():
    """Warm cache on boot so first UI load is fast."""
    # Ensure agent quote store exists (user submissions only — no seed rates)
    try:
        agent_store.list_quotes(days=30)
    except Exception:
        pass
    try:
        await _load_prices(days=14, states=["Karnataka"], force=True)
    except Exception:
        pass
