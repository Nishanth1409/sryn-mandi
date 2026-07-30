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

from backend import agmarknet_access, archive
from backend.dates import format_date as _format_date
from backend.dates import parse_date as _parse_date

# data.gov.in never answers requests that look like a bare script client: it
# accepts the connection and then holds it open until the read times out.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept": "application/json",
}

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

# Upstream publishes only a short live window; the archive keeps the older days.
MAX_SERVE_WINDOW_DAYS = 400
MAX_UPSTREAM_LOOKBACK_DAYS = 30
AGMARKNET_BLOCK_SECONDS = 6 * 3600
HEAL_INTERVAL_HEALTHY_SECONDS = 900
HEAL_INTERVAL_FIRST_RETRY_SECONDS = 60
HEAL_INTERVAL_MAX_SECONDS = 900

_health_lock = threading.Lock()
_health: dict[str, Any] = {
    "last_success_at": 0.0,
    "last_attempt_at": 0.0,
    "consecutive_failures": 0,
    "last_error": None,
    "agmarknet_blocked_until": 0.0,
    "sources": {"agmarknet": "unknown", "data.gov.in": "unknown"},
}


def _record_source(name: str, ok: bool, detail: str | None = None) -> None:
    with _health_lock:
        _health["sources"][name] = "ok" if ok else (detail or "failed")


def _record_fetch(rows: int, error: str | None = None) -> None:
    now = time.time()
    with _health_lock:
        _health["last_attempt_at"] = now
        if rows > 0:
            _health["last_success_at"] = now
            _health["consecutive_failures"] = 0
            _health["last_error"] = None
        else:
            _health["consecutive_failures"] += 1
            _health["last_error"] = error or "no rows returned by official sources"


def _heal_delay_seconds() -> float:
    with _health_lock:
        failures = int(_health["consecutive_failures"])
    if failures <= 0:
        return HEAL_INTERVAL_HEALTHY_SECONDS
    backoff = HEAL_INTERVAL_FIRST_RETRY_SECONDS * (2 ** (failures - 1))
    return float(min(backoff, HEAL_INTERVAL_MAX_SECONDS))


def _feed_health(fresh_rows: int, served_rows: int) -> dict[str, Any]:
    with _health_lock:
        last_success = float(_health["last_success_at"])
        snapshot = {
            "consecutive_failures": int(_health["consecutive_failures"]),
            "last_error": _health["last_error"],
            "sources": dict(_health["sources"]),
        }
    if fresh_rows > 0:
        state = "live"
    elif served_rows > 0:
        state = "archived"
    else:
        state = "unavailable"
    agmarknet_status = str(snapshot["sources"].get("agmarknet") or "")
    return {
        **snapshot,
        "state": state,
        "captcha_required": agmarknet_status == "captcha_required",
        "agmarknet_ticket": agmarknet_access.ticket_status(),
        "last_success_at": (
            datetime.fromtimestamp(last_success).isoformat(timespec="seconds")
            if last_success
            else None
        ),
        "archive": archive.stats(),
    }


def _clear_agmarknet_block() -> None:
    with _health_lock:
        _health["agmarknet_blocked_until"] = 0.0
        if _health["sources"].get("agmarknet") == "captcha_required":
            _health["sources"]["agmarknet"] = "ok"


PRICE_CACHE_PATH = Path(
    os.environ.get("PRICE_CACHE_PATH")
    or (
        Path("/tmp/prices_cache.json")
        if os.environ.get("VERCEL")
        else Path(__file__).resolve().parent / "data" / "prices_cache.json"
    )
)


def _invalidate_price_cache() -> None:
    with _cache_lock:
        _cache["data"] = None
        _cache["fetched_at"] = 0.0
        _cache["key"] = None
    try:
        if PRICE_CACHE_PATH.exists():
            PRICE_CACHE_PATH.unlink()
    except OSError:
        pass


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
    available_dates: list[str] = Field(default_factory=list)
    history: list[dict[str, Any]] = Field(default_factory=list)
    history_by_variety: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    top_markets: list[dict[str, Any]] = Field(default_factory=list)
    feed_health: dict[str, Any] = Field(default_factory=dict)


class AgmarknetUnlockRequest(BaseModel):
    captcha_key: str = Field(min_length=8)
    captcha: str = Field(min_length=3, max_length=16)
    days: int = Field(default=MAX_SERVE_WINDOW_DAYS, ge=7, le=MAX_SERVE_WINDOW_DAYS)
    scope: str = Field(default="karnataka")
    states: str | None = None


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


def _agmarknet_blocked() -> bool:
    with _health_lock:
        return time.time() < float(_health.get("agmarknet_blocked_until") or 0.0)


def _block_agmarknet(reason: str) -> None:
    """Pause AGMARKNET calls so a hard rejection cannot eat the fetch budget."""
    with _health_lock:
        _health["agmarknet_blocked_until"] = time.time() + AGMARKNET_BLOCK_SECONDS
        _health["sources"]["agmarknet"] = reason


def _fetch_agmarknet_state(state: str, from_date: str, to_date: str) -> list[dict]:
    """Fetch authentic AGMARKNET rows for one state via official SDK."""
    df = None
    last_error: str | None = None
    for attempt in range(2):
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
            except Exception as exc:
                df = None
                detail = f"{exc} {getattr(exc, 'response_text', '') or ''}".lower()
                if "captcha" in detail:
                    # AGMARKNET now gates this endpoint behind a captcha; retrying
                    # cannot help until that changes.
                    _block_agmarknet("captcha_required")
                    return []
                last_error = type(exc).__name__
        if df is not None and not getattr(df, "empty", True):
            break
        if attempt == 0:
            time.sleep(1.0)

    if df is None or getattr(df, "empty", True):
        _record_source("agmarknet", False, last_error)
        return []
    _record_source("agmarknet", True)

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


DATAGOV_PAGE_SIZE = 100
DATAGOV_MAX_PAGES = 12
DATAGOV_ATTEMPTS_PER_PAGE = 3


async def _datagov_page(client: httpx.AsyncClient, offset: int) -> dict[str, Any]:
    """One page of the open-data feed, retried through transient stalls."""
    url = f"https://api.data.gov.in/resource/{DATAGOV_RESOURCE}"
    params = {
        "api-key": DATAGOV_KEY,
        "format": "json",
        "limit": DATAGOV_PAGE_SIZE,
        "offset": offset,
        "filters[commodity]": COMMODITY,
    }
    last_error: Exception | None = None
    for attempt in range(DATAGOV_ATTEMPTS_PER_PAGE):
        try:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except (httpx.HTTPError, ValueError) as exc:
            last_error = exc
            if attempt < DATAGOV_ATTEMPTS_PER_PAGE - 1:
                await asyncio.sleep(1.0 * (2**attempt))
    raise last_error if last_error else RuntimeError("data.gov.in page failed")


async def _fetch_datagovin() -> list[dict]:
    """Read every arecanut row the open-data feed currently publishes."""
    rows: list[dict] = []
    offset = 0
    failure: str | None = None
    timeout = httpx.Timeout(connect=10.0, read=20.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers=REQUEST_HEADERS
    ) as client:
        for _ in range(DATAGOV_MAX_PAGES):
            try:
                payload = await _datagov_page(client, offset)
            except Exception as exc:
                failure = type(exc).__name__
                break

            records = payload.get("records") or []
            for rec in records:
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

            offset += len(records)
            total = int(_parse_number(payload.get("total")))
            if not records or (total and offset >= total):
                break

    # A later page failing still leaves the earlier official rows usable.
    _record_source("data.gov.in", bool(rows), failure)
    return rows


def _normalize(raw_rows: list[dict]) -> list[PriceRecord]:
    """Keep every real dated lot and calculate change against its previous lot."""
    by_key: dict[str, list[dict]] = {}
    for row in raw_rows:
        if not _parse_date(str(row.get("arrival_date") or "")):
            continue
        key = _slug(
            row["state"],
            row["district"],
            row["market"],
            row["variety"],
            row.get("grade") or "",
        )
        by_key.setdefault(key, []).append(row)

    records: list[PriceRecord] = []
    for key, items in by_key.items():
        items.sort(
            key=lambda r: _parse_date(r["arrival_date"]) or date.min,
            reverse=True,
        )
        seen: set[tuple[Any, ...]] = set()
        unique_items: list[dict] = []
        for item in items:
            signature = (
                _format_date(_parse_date(item["arrival_date"]) or date.min),
                item.get("grade") or "",
                item.get("min_price") or 0,
                item.get("max_price") or 0,
                item.get("modal_price") or 0,
            )
            if signature not in seen:
                seen.add(signature)
                unique_items.append(item)

        for index, current in enumerate(unique_items):
            prev = unique_items[index + 1] if index + 1 < len(unique_items) else None
            change = None
            change_pct = None
            if prev and current["modal_price"] and prev["modal_price"]:
                change = round(current["modal_price"] - prev["modal_price"], 2)
                change_pct = round((change / prev["modal_price"]) * 100, 2)

            arrival_day = _parse_date(current["arrival_date"])
            arrival_date = _format_date(arrival_day) if arrival_day else current["arrival_date"]
            records.append(
                PriceRecord(
                    id=f"{key}-{arrival_date}-{index}",
                    state=current["state"],
                    district=current["district"],
                    market=current["market"],
                    commodity=current["commodity"],
                    variety=current["variety"],
                    grade=current["grade"],
                    arrival_date=arrival_date,
                    min_price=current["min_price"],
                    max_price=current["max_price"],
                    modal_price=current["modal_price"],
                    arrival_qty=current.get("arrival_qty"),
                    unit=current.get("unit") or "Rs./Quintal",
                    change=change,
                    change_pct=change_pct,
                    is_shivamogga=_is_shivamogga(current["district"], current["market"]),
                    source=current.get("source") or "AGMARKNET",
                )
            )

    records.sort(
        key=lambda r: (
            -(_parse_date(r.arrival_date) or date.min).toordinal(),
            not r.is_shivamogga,
            -r.modal_price,
            r.market,
        )
    )
    return records


def _available_dates(records: list[PriceRecord]) -> list[str]:
    days = {_parse_date(record.arrival_date) for record in records}
    return [_format_date(day) for day in sorted((d for d in days if d), reverse=True)]


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


# Same headline grades as the local place board (Sarakku / Bede / Rashi / Andal)
_VARIETY_BUCKETS: list[tuple[str, tuple[str, ...]]] = [
    ("sarakku", ("saraku", "sarakku", "sarak")),
    ("bede", ("bette", "bede", "tattibettee", "tatti bettee")),
    ("rashi", ("rashi", "rasi")),
    ("andal", ("andal", "andaal", "gorabalu", "gorabal")),
]


def _variety_bucket_key(variety: str) -> str | None:
    v = (variety or "").lower().strip()
    if not v:
        return None
    for key, needles in _VARIETY_BUCKETS:
        if any(v == n or n in v for n in needles):
            return key
    return None


def _history_from_buckets(buckets: dict[str, list[float]]) -> list[dict[str, Any]]:
    history: list[dict[str, Any]] = []
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


def _build_history_by_variety(raw_rows: list[dict], days: int = 30) -> dict[str, list[dict[str, Any]]]:
    """Daily modal avg/min/max per headline variety — not blended across grades."""
    cutoff = date.today() - timedelta(days=days)
    by_key: dict[str, dict[str, list[float]]] = {key: {} for key, _ in _VARIETY_BUCKETS}
    for row in raw_rows:
        d = _parse_date(row["arrival_date"])
        if not d or d < cutoff or not row.get("modal_price"):
            continue
        bucket = _variety_bucket_key(str(row.get("variety") or ""))
        if not bucket:
            continue
        day = d.isoformat()
        by_key[bucket].setdefault(day, []).append(float(row["modal_price"]))

    return {key: _history_from_buckets(buckets) for key, buckets in by_key.items()}


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
    cache_key = f"dated1|{days}|{','.join(sorted(states))}"

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


def _merge_rows(stored: list[dict], fresh: list[dict]) -> list[dict]:
    """Union of archived and freshly fetched lots; a fresh lot wins on conflict."""
    merged: dict[str, dict] = {}
    for row in [*stored, *fresh]:
        key = archive.row_key(row)
        if key:
            merged[key] = row
    return list(merged.values())


async def _fetch_agmarknet_rows(states: list[str], lookback: int, deadline: float) -> list[dict]:
    """Pull AGMARKNET rows for each state inside its own wall-clock budget."""
    to_d = date.today()
    from_d = to_d - timedelta(days=lookback)
    from_s, to_s = from_d.isoformat(), to_d.isoformat()

    if _agmarknet_blocked():
        return []

    loop = asyncio.get_running_loop()
    # Serverless hosts drop large parallel fan-outs to AGMARKNET, so fetch in
    # small batches and stop once the budget is gone.
    batch_size = 2 if len(states) > 2 else 1
    raw: list[dict] = []

    async def one_state(state: str) -> list[dict]:
        remaining = deadline - time.time()
        if remaining <= 1.0:
            return []
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(None, _fetch_agmarknet_state, state, from_s, to_s),
                timeout=min(remaining, 20.0),
            )
        except Exception:
            return []

    for index in range(0, len(states), batch_size):
        if time.time() >= deadline:
            break
        batch = states[index : index + batch_size]
        for part in await asyncio.gather(*(one_state(state) for state in batch)):
            raw.extend(part)

    # Karnataka carries most arecanut lots, so never leave it out on a partial run
    if not raw and "Karnataka" in states:
        raw.extend(await one_state("Karnataka"))

    return raw


async def _fetch_prices_fresh(days: int, states: list[str]) -> PricesResponse:
    lookback = 7 if len(states) > 2 else min(max(days, 7), MAX_UPSTREAM_LOOKBACK_DAYS)
    budget = 55.0 if len(states) > 2 else 40.0
    hard_deadline = time.time() + budget
    # Each source gets its own share, so a stalling AGMARKNET can never starve
    # data.gov.in (and vice versa) into looking like "no rates today".
    agmarknet_deadline = time.time() + budget * 0.5

    datagov_task = asyncio.create_task(_fetch_datagovin())

    fresh = await _fetch_agmarknet_rows(states, lookback, agmarknet_deadline)
    if not fresh and not _agmarknet_blocked() and time.time() < agmarknet_deadline - 5.0:
        # Transient upstream timeouts are common; give it one more chance now
        # instead of publishing an empty board.
        await asyncio.sleep(1.5)
        fresh = await _fetch_agmarknet_rows(states, lookback, agmarknet_deadline)

    try:
        fresh.extend(
            await asyncio.wait_for(
                datagov_task, timeout=max(5.0, hard_deadline - time.time())
            )
        )
    except Exception:
        datagov_task.cancel()
        _record_source("data.gov.in", False, "timeout")

    archive.remember(fresh)
    _record_fetch(len(fresh))

    serve_days = min(max(days, lookback), MAX_SERVE_WINDOW_DAYS)
    raw = _merge_rows(archive.rows_since(date.today() - timedelta(days=serve_days)), fresh)

    records = _normalize(raw)
    live_day = _pick_live_day(records)
    live_records = _filter_live_day(records, live_day) or records
    history = _build_history(raw, days=serve_days)
    history_by_variety = _build_history_by_variety(raw, days=serve_days)
    return PricesResponse(
        updated_at=datetime.now().isoformat(timespec="seconds"),
        source="AGMARKNET (api.agmarknet.gov.in) + data.gov.in",
        cache_age_seconds=0,
        summary=_summary(live_records),
        records=records,
        board_date=_format_date(live_day) if live_day else None,
        available_dates=_available_dates(records),
        history=history,
        history_by_variety=history_by_variety,
        top_markets=_build_top_markets(live_records),
        feed_health=_feed_health(fresh_rows=len(fresh), served_rows=len(records)),
    )


@app.get("/api/health")
async def health():
    with _health_lock:
        last_success = float(_health["last_success_at"])
        failures = int(_health["consecutive_failures"])
        last_error = _health["last_error"]
        sources = dict(_health["sources"])
    return {
        "status": "ok",
        "service": "Araka Net",
        "commodity": COMMODITY,
        "sources": sources,
        "data_note": "Only official dated market rows are returned; missing dates are never generated.",
        "self_healing": {
            "consecutive_failures": failures,
            "last_error": last_error,
            "next_retry_in_seconds": int(_heal_delay_seconds()),
            "last_success_at": (
                datetime.fromtimestamp(last_success).isoformat(timespec="seconds")
                if last_success
                else None
            ),
        },
        "archive": archive.stats(),
    }


@app.get("/api/agmarknet/captcha")
async def agmarknet_captcha():
    """Fresh AGMARKNET captcha image for the visitor to solve."""
    loop = asyncio.get_running_loop()
    try:
        challenge = await loop.run_in_executor(None, agmarknet_access.generate_captcha)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not load AGMARKNET captcha: {exc}") from exc
    if not challenge.get("captcha_key") or not challenge.get("image_data_url"):
        raise HTTPException(status_code=502, detail="AGMARKNET returned an empty captcha.")
    return challenge


@app.get("/api/agmarknet/status")
async def agmarknet_status():
    with _health_lock:
        source = _health["sources"].get("agmarknet")
        blocked_until = float(_health.get("agmarknet_blocked_until") or 0.0)
    return {
        "captcha_required": source == "captcha_required" or time.time() < blocked_until,
        "source": source,
        "ticket": agmarknet_access.ticket_status(),
        "archive": archive.stats(),
    }


@app.post("/api/agmarknet/unlock")
async def agmarknet_unlock(body: AgmarknetUnlockRequest):
    """Visitor solves the AGMARKNET captcha; we archive the exact official history."""
    if body.states:
        state_list = [s.strip() for s in body.states.split(",") if s.strip()]
    elif body.scope.lower() == "india":
        # One captcha covers one filter set — prefer the main belt, not all India,
        # so pagination finishes inside the ticket budget.
        state_list = ["Karnataka", "Kerala", "Assam", "Tamil Nadu"]
    else:
        state_list = DEFAULT_STATES

    loop = asyncio.get_running_loop()
    try:
        unlocked = await loop.run_in_executor(
            None,
            lambda: agmarknet_access.unlock_history(
                captcha_key=body.captcha_key,
                captcha=body.captcha,
                states=state_list,
                lookback_days=body.days,
            ),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        detail = str(exc)
        status = 400 if "CAPTCHA" in detail.upper() or "captcha" in detail.lower() else 502
        raise HTTPException(status_code=status, detail=detail) from exc

    rows = unlocked["rows"]
    added = archive.remember(rows)
    _record_source("agmarknet", True)
    _record_fetch(len(rows))
    _clear_agmarknet_block()
    _invalidate_price_cache()

    prices = await _load_prices(days=body.days, states=state_list, force=True)
    return {
        "ok": True,
        "added_rows": added,
        "fetched_rows": unlocked["row_count"],
        "total_count": unlocked["total_count"],
        "pages_fetched": unlocked["pages_fetched"],
        "from_date": unlocked["from_date"],
        "to_date": unlocked["to_date"],
        "states": unlocked["states"],
        "available_dates": unlocked["available_dates"],
        "date_count": unlocked["date_count"],
        "report_access": unlocked["report_access"],
        "prices": prices,
    }


@app.get("/api/prices", response_model=PricesResponse)
async def get_prices(
    days: int = Query(14, ge=3, le=MAX_SERVE_WINDOW_DAYS),
    states: str | None = Query(None, description="Comma-separated state names"),
    scope: str = Query("karnataka", description="'karnataka' or 'india'"),
    refresh: bool = Query(False),
    rate_date: str | None = Query(
        None,
        description="Optional exact available date (DD-MM-YYYY, DD/MM/YYYY, or YYYY-MM-DD)",
    ),
):
    if states:
        state_list = [s.strip() for s in states.split(",") if s.strip()]
    elif scope.lower() == "india":
        state_list = ALL_INDIA_STATES
    else:
        state_list = DEFAULT_STATES
    response = await _load_prices(days=days, states=state_list, force=refresh)
    if rate_date is None:
        return response
    selected_day = _parse_date(rate_date)
    if selected_day is None:
        raise HTTPException(status_code=400, detail="Invalid rate_date.")
    selected = _filter_live_day(response.records, selected_day)
    selected_date = _format_date(selected_day)
    return response.model_copy(
        update={
            "summary": _summary(selected),
            "records": selected,
            "board_date": selected_date,
            "top_markets": _build_top_markets(selected),
        }
    )


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


async def _self_heal_loop() -> None:
    """Re-fetch on a schedule that tightens while the official feeds are failing."""
    while True:
        await asyncio.sleep(_heal_delay_seconds())
        try:
            await _load_prices(
                days=MAX_SERVE_WINDOW_DAYS, states=DEFAULT_STATES, force=True
            )
        except Exception:
            _record_fetch(0, "refresh attempt raised")


@app.on_event("startup")
async def warmup():
    """Warm the Karnataka board and start the recovery loop."""
    try:
        await _load_prices(days=MAX_SERVE_WINDOW_DAYS, states=DEFAULT_STATES, force=False)
    except Exception:
        _record_fetch(0, "startup fetch failed")
    # Serverless instances are frozen between requests, so the loop only helps
    # on long-lived hosts; there, healing happens without any user action.
    if not os.environ.get("VERCEL"):
        app.state.heal_task = asyncio.create_task(_self_heal_loop())
