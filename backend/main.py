"""
AdikeLive API — authentic arecanut prices from AGMARKNET + data.gov.in
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path
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
    "Assam",
    "Meghalaya",
    "Tamil Nadu",
    "West Bengal",
    "Goa",
    "Maharashtra",
    "Andhra Pradesh",
    "Tripura",
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

CACHE_TTL_SECONDS = 600  # 10 minutes fresh
STALE_TTL_SECONDS = 6 * 3600  # serve last good payload up to 6h on cold starts
_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0, "key": None}
_cache_lock = threading.Lock()
_agmarknet_local = threading.local()
_fetch_sem = threading.Semaphore(6)

PRICE_CACHE_PATH = Path(
    os.environ.get("PRICE_CACHE_PATH")
    or (
        Path("/tmp/prices_cache.json")
        if os.environ.get("VERCEL")
        else Path(__file__).resolve().parent / "data" / "prices_cache.json"
    )
)

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
    board_date: str | None = None
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


def _get_agmarknet():
    """Per-thread SDK client so state fetches can run in parallel safely."""
    from agmarknet import Agmarknet

    client = getattr(_agmarknet_local, "client", None)
    if client is None:
        client = Agmarknet(
            request_delay=0,
            timeout=15.0,
            max_workers=2,
            use_cache=True,
        )
        _agmarknet_local.client = client
    return client


def _read_disk_cache(cache_key: str) -> tuple[PricesResponse | None, float]:
    try:
        if not PRICE_CACHE_PATH.exists():
            return None, 0.0
        payload = json.loads(PRICE_CACHE_PATH.read_text(encoding="utf-8"))
        entry = (payload.get("entries") or {}).get(cache_key)
        if not entry:
            return None, 0.0
        fetched_at = float(entry.get("fetched_at") or 0)
        data = entry.get("data")
        if not isinstance(data, dict):
            return None, 0.0
        return PricesResponse.model_validate(data), fetched_at
    except Exception:
        return None, 0.0


def _write_disk_cache(cache_key: str, response: PricesResponse, fetched_at: float) -> None:
    try:
        PRICE_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        entries: dict[str, Any] = {}
        if PRICE_CACHE_PATH.exists():
            try:
                existing = json.loads(PRICE_CACHE_PATH.read_text(encoding="utf-8"))
                if isinstance(existing.get("entries"), dict):
                    entries = existing["entries"]
            except Exception:
                entries = {}
        entries[cache_key] = {
            "fetched_at": fetched_at,
            "data": response.model_dump(),
        }
        # Keep only the latest few scopes to bound /tmp size
        if len(entries) > 6:
            ranked = sorted(entries.items(), key=lambda kv: float(kv[1].get("fetched_at") or 0))
            entries = dict(ranked[-6:])
        PRICE_CACHE_PATH.write_text(
            json.dumps({"entries": entries}, ensure_ascii=False),
            encoding="utf-8",
        )
    except Exception:
        pass


def _cached_response(response: PricesResponse, fetched_at: float, now: float) -> PricesResponse:
    return response.model_copy(update={"cache_age_seconds": int(max(0, now - fetched_at))})


def _fetch_agmarknet_state(state: str, from_date: str, to_date: str) -> list[dict]:
    """Fetch authentic AGMARKNET rows for one state via official SDK."""
    from agmarknet.exceptions import AgmarknetError

    with _fetch_sem:
        api = _get_agmarknet()
        try:
            df = api.report(
                from_date=from_date,
                to_date=to_date,
                commodity=COMMODITY,
                state=state,
                data_type="price",
                limit=1000,
            )
        except AgmarknetError:
            return []
        except Exception:
            return []

    if df is None or getattr(df, "empty", True):
        return []

    rows: list[dict] = []
    records = df.to_dict(orient="records")
    for row in records:
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
                "modal_price": _parse_number(row.get("model_price") or row.get("modal_price")),
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
        async with httpx.AsyncClient(timeout=10.0) as client:
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
    # Keep latest lot per market+variety across dates. Live-day filtering is applied
    # for board summary/top markets; place variety boards may fall back to older dates.
    return records


def _pick_live_day(records: list[PriceRecord]) -> date | None:
    arrival_days = [_parse_date(r.arrival_date) for r in records]
    arrival_days = [d for d in arrival_days if d]
    if not arrival_days:
        return None
    today = date.today()
    return today if today in arrival_days else max(arrival_days)


def _filter_live_day(records: list[PriceRecord], live_day: date | None) -> list[PriceRecord]:
    if not live_day:
        return records
    return [r for r in records if _parse_date(r.arrival_date) == live_day]


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
    cache_key = f"live2|{days}|{','.join(sorted(states))}"

    with _cache_lock:
        mem = _cache
        if (
            not force
            and mem["data"] is not None
            and mem.get("key") == cache_key
            and getattr(mem["data"], "summary", None)
            and mem["data"].summary.records > 0
            and now - float(mem["fetched_at"]) < CACHE_TTL_SECONDS
        ):
            return _cached_response(mem["data"], float(mem["fetched_at"]), now)

    disk_data, disk_at = _read_disk_cache(cache_key)
    if (
        disk_data is not None
        and disk_data.summary.records > 0
        and not force
        and now - disk_at < CACHE_TTL_SECONDS
    ):
        with _cache_lock:
            _cache["data"] = disk_data
            _cache["fetched_at"] = disk_at
            _cache["key"] = cache_key
        return _cached_response(disk_data, disk_at, now)

    try:
        response = await _fetch_prices_fresh(days, states)
    except Exception:
        # Prefer last good board over a hard failure (cold start / upstream outage)
        if disk_data is not None and disk_data.summary.records > 0 and now - disk_at < STALE_TTL_SECONDS:
            return _cached_response(disk_data, disk_at, now)
        with _cache_lock:
            if (
                _cache["data"] is not None
                and _cache.get("key") == cache_key
                and _cache["data"].summary.records > 0
                and now - float(_cache["fetched_at"]) < STALE_TTL_SECONDS
            ):
                return _cached_response(_cache["data"], float(_cache["fetched_at"]), now)
        raise

    # Never persist or prefer an empty board over a previous good one
    if response.summary.records <= 0:
        if disk_data is not None and disk_data.summary.records > 0 and now - disk_at < STALE_TTL_SECONDS:
            return _cached_response(disk_data, disk_at, now)
        if len(states) > 1:
            # All-India failed upstream — fall back to Karnataka so UI stays usable
            return await _load_prices(days=days, states=DEFAULT_STATES, force=False)
        return response

    with _cache_lock:
        _cache["data"] = response
        _cache["fetched_at"] = now
        _cache["key"] = cache_key
    _write_disk_cache(cache_key, response, now)
    return response


async def _fetch_prices_fresh(days: int, states: list[str]) -> PricesResponse:
    to_d = date.today()
    # Multi-state boards use a shorter window so AGMARKNET pagination stays quick
    lookback = 7 if len(states) > 2 else max(days, 7)
    from_d = to_d - timedelta(days=lookback)
    from_s, to_s = from_d.isoformat(), to_d.isoformat()

    loop = asyncio.get_running_loop()
    datagov_task = asyncio.create_task(_fetch_datagovin())

    # Vercel/serverless: large parallel fan-out to AGMARKNET often returns empty.
    # Fetch in small batches with an overall deadline so we keep real rates.
    batch_size = 2 if len(states) > 2 else 1
    per_state_timeout = 18.0
    overall_deadline = time.time() + (50.0 if len(states) > 2 else 25.0)
    raw: list[dict] = []

    async def one_state(state: str) -> list[dict]:
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_agmarknet_state, state, from_s, to_s),
                timeout=per_state_timeout,
            )
        except Exception:
            return []

    for i in range(0, len(states), batch_size):
        if time.time() >= overall_deadline:
            break
        batch = states[i : i + batch_size]
        results = await asyncio.gather(*(one_state(state) for state in batch))
        for part in results:
            raw.extend(part)

    # Guarantee Karnataka data if multi-state path produced nothing
    if not raw and "Karnataka" in states:
        raw.extend(await one_state("Karnataka"))

    try:
        datagov = await asyncio.wait_for(datagov_task, timeout=8.0)
        raw.extend(datagov)
    except Exception:
        datagov_task.cancel()

    records = _normalize(raw)
    live_day = _pick_live_day(records)
    live_records = _filter_live_day(records, live_day) or records
    history = _build_history(raw, days=min(days, lookback))
    return PricesResponse(
        updated_at=datetime.now().isoformat(timespec="seconds"),
        source="AGMARKNET (api.agmarknet.gov.in) + data.gov.in",
        cache_age_seconds=0,
        summary=_summary(live_records),
        records=records,
        board_date=_format_date(live_day) if live_day else None,
        history=history,
        top_markets=_build_top_markets(live_records),
    )


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
    district: str
    market: str | None = "Local agent"
    note: str | None = None
    quote_date: str | None = None
    lat: float | None = None
    lng: float | None = None
    market_modal: float | None = Field(
        None,
        description="Official mandi modal for this place+variety; used to validate agent amount",
    )
    # Single amount (legacy) or purchase range
    rate: float | None = Field(None, description="Single purchase ₹/quintal")
    rate_min: float | None = Field(None, description="Purchase minimum ₹/quintal")
    rate_max: float | None = Field(None, description="Purchase maximum ₹/quintal")


AGENT_MAX_OVER_MARKET = 3000


def _validate_against_market(rate: float, modal: float) -> None:
    floor = float(modal)
    ceiling = floor + AGENT_MAX_OVER_MARKET
    if rate < floor:
        raise HTTPException(
            status_code=400,
            detail=f"Amount cannot be less than the mandi market rate (₹{round(floor):,}).",
        )
    if rate > ceiling:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Amount cannot exceed the mandi market rate by more than ₹{AGENT_MAX_OVER_MARKET:,}. "
                f"Max allowed: ₹{round(ceiling):,}."
            ),
        )


@app.get("/api/agent-quotes")
async def get_agent_quotes(
    district: str | None = Query(None),
    market: str | None = Query(None, description="Optional APMC / place filter"),
    variety_key: str | None = Query(None),
    days: int = Query(30, ge=1, le=90),
):
    quotes = agent_store.list_quotes(
        district=district, market=market, variety_key=variety_key, days=days
    )
    by_variety = agent_store.averages_by_variety(
        district=district, market=market, days=days
    )
    by_place = agent_store.stats_by_place_and_variety(district=district, days=days)
    if market:
        needle = market.lower().strip()
        by_place = [
            row
            for row in by_place
            if needle in str(row.get("market") or "").lower()
            or str(row.get("market") or "").lower() in needle
        ]
    return {
        "source": "user_submissions",
        "note": (
            "Local agent amounts come only from users/agents who submit their real purchase "
            "₹/quintal on this site for a place (GPS or chosen APMC). For the same place + variety, "
            "we show the minimum and maximum submitted amounts — not an average. "
            f"Each amount must be at least the mandi market rate and at most ₹{AGENT_MAX_OVER_MARKET} above it. "
            "AGMARKNET does not publish private agent quotes."
        ),
        "count": len(quotes),
        "averages_by_variety": by_variety,
        "stats_by_place": by_place,
        "quotes": quotes,
    }


@app.post("/api/agent-quotes")
async def post_agent_quote(body: AgentQuoteIn):
    modal = body.market_modal
    if modal is None or modal <= 0:
        raise HTTPException(
            status_code=400,
            detail="Mandi market rate is required for this variety at this place before submitting.",
        )

    rates: list[float] = []
    if body.rate_min is not None or body.rate_max is not None:
        rmin = body.rate_min if body.rate_min is not None else body.rate_max
        rmax = body.rate_max if body.rate_max is not None else body.rate_min
        assert rmin is not None and rmax is not None
        if rmin > rmax:
            raise HTTPException(
                status_code=400,
                detail="Purchase minimum cannot be greater than purchase maximum.",
            )
        rates = [float(rmin)] if float(rmin) == float(rmax) else [float(rmin), float(rmax)]
    elif body.rate is not None:
        rates = [float(body.rate)]
    else:
        raise HTTPException(
            status_code=400,
            detail="Enter purchase minimum and maximum amounts (or a single purchase amount).",
        )

    for rate in rates:
        _validate_against_market(rate, float(modal))

    try:
        base = body.model_dump()
        base.pop("market_modal", None)
        base.pop("rate_min", None)
        base.pop("rate_max", None)
        base.pop("rate", None)
        rows = []
        for rate in rates:
            rows.append(agent_store.add_quote({**base, "rate": rate}))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "quote": rows[0], "quotes": rows, "count": len(rows)}


@app.on_event("startup")
async def warmup():
    """Warm Karnataka cache on boot for a fast first paint."""
    try:
        agent_store.list_quotes(days=30)
    except Exception:
        pass
    try:
        await _load_prices(days=14, states=DEFAULT_STATES, force=False)
    except Exception:
        pass
