"""Captcha-free daily arecanut prices from AGMARKNET.

The open-data host (api.data.gov.in) currently refuses connections, and the
multi-day report API asks for a captcha. The public date-wise commodity report
does neither: one call returns every market and variety for a month, with the
same modal prices the graded report publishes.
"""

from __future__ import annotations

import re
from datetime import date
from typing import Any

import httpx

from backend import archive
from backend.dates import format_date, india_today, parse_date

AGMARKNET_BASE = "https://api.agmarknet.gov.in/v1"
COMMODITY_NAME = "Arecanut(Betelnut/Supari)"
REQUEST_HEADERS = {
    "Accept": "application/json",
    "Origin": "https://agmarknet.gov.in",
    "Referer": "https://agmarknet.gov.in/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
    ),
}

# AGMARKNET's own spelling, which does not always match the names we ask for.
_STATE_ALIASES = {
    "kerala": "keralam",
    "chhattisgarh": "chattisgarh",
    "orissa": "odisha",
}

_filters_cache: dict[str, Any] | None = None
_filters_day: date | None = None


def _norm(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _core(value: str) -> str:
    text = re.sub(r"\b(apmc|market|mandi|yard|sub)\b", " ", value.lower())
    return re.sub(r"[^a-z0-9]+", "", text)


def _months_to_fetch(today: date | None = None) -> list[tuple[int, int]]:
    """Current month, plus the previous one when the archive does not cover it yet."""
    today = today or india_today()
    start = today.replace(day=1)
    latest = archive.latest_day()
    earliest = start
    if latest is not None and latest < start:
        earliest = latest.replace(day=1)
    if today.day <= 3:
        previous = date(start.year - 1, 12, 1) if start.month == 1 else date(start.year, start.month - 1, 1)
        if previous < earliest:
            earliest = previous
    months: list[tuple[int, int]] = []
    cursor = earliest
    while cursor <= start and len(months) < 3:
        months.append((cursor.year, cursor.month))
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months or [(today.year, today.month)]


async def _load_filters(client: httpx.AsyncClient) -> dict[str, Any]:
    global _filters_cache, _filters_day
    today = india_today()
    if _filters_cache is not None and _filters_day == today:
        return _filters_cache

    response = await client.get(f"{AGMARKNET_BASE}/daily-price-arrival/filters")
    response.raise_for_status()
    data = response.json().get("data") or {}

    states: dict[str, tuple[str, str]] = {}
    for row in data.get("state_data") or []:
        name = str(row.get("state_name") or "").strip()
        state_id = str(row.get("state_id") or "").strip()
        if not name or not state_id or name.lower().startswith("all "):
            continue
        states[_norm(name)] = (state_id, name)

    districts = {
        str(row.get("id")): str(row.get("district_name") or "").strip()
        for row in data.get("district_data") or []
        if str(row.get("district_name") or "").strip()
        and not str(row.get("district_name") or "").lower().startswith("all ")
    }

    by_full: dict[tuple[str, str], str] = {}
    by_core: dict[tuple[str, str], str] = {}
    for row in data.get("market_data") or []:
        state_id = str(row.get("state_id") or "").strip()
        district = districts.get(str(row.get("district_id") or ""))
        name = str(row.get("mkt_name") or "").strip()
        if not state_id or not district or not name or name.lower().startswith("all "):
            continue
        by_full[(state_id, _norm(name))] = district
        core = _core(name)
        if core:
            by_core.setdefault((state_id, core), district)

    commodity_id = ""
    for row in data.get("cmdt_data") or []:
        if str(row.get("cmdt_name") or "").strip().lower() == COMMODITY_NAME.lower():
            commodity_id = str(row.get("cmdt_id") or "")
            break
    if not commodity_id:
        raise RuntimeError("AGMARKNET filters did not include arecanut.")

    _filters_cache = {
        "commodity_id": commodity_id,
        "states": states,
        "by_full": by_full,
        "by_core": by_core,
    }
    _filters_day = today
    return _filters_cache


def _resolve_state(filters: dict[str, Any], name: str) -> tuple[str, str] | None:
    states: dict[str, tuple[str, str]] = filters["states"]
    key = _STATE_ALIASES.get(name.strip().lower(), name.strip().lower())
    key = _norm(key)
    found = states.get(key)
    if found:
        return found
    for official, pair in states.items():
        if key and (key in official or official in key):
            return pair
    return None


def _district_for(filters: dict[str, Any], state_id: str, market: str) -> str:
    full = filters["by_full"].get((state_id, _norm(market)))
    if full:
        return full
    return str(filters["by_core"].get((state_id, _core(market))) or "")


def _rows_from_month(
    payload: dict[str, Any],
    *,
    state_name: str,
    state_id: str,
    filters: dict[str, Any],
    sealed: set[str],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for market in payload.get("markets") or []:
        market_name = str(market.get("marketName") or "").strip()
        if not market_name:
            continue
        district = _district_for(filters, state_id, market_name)
        for day in market.get("dates") or []:
            parsed = parse_date(str(day.get("arrivalDate") or ""))
            if parsed is None:
                continue
            arrival = format_date(parsed)
            if arrival in sealed:
                continue
            for lot in day.get("data") or []:
                modal = _number(lot.get("modalPrice"))
                if modal <= 0:
                    continue
                rows.append(
                    {
                        "state": state_name,
                        "district": district,
                        "market": market_name,
                        "commodity": COMMODITY_NAME,
                        "variety": str(lot.get("variety") or "Other").strip() or "Other",
                        "grade": "",
                        "arrival_date": arrival,
                        "min_price": _number(lot.get("minimumPrice")),
                        "max_price": _number(lot.get("maximumPrice")),
                        "modal_price": modal,
                        "arrival_qty": _number(lot.get("arrivals")) or None,
                        "unit": "Rs./Quintal",
                        "source": "AGMARKNET",
                    }
                )
    return rows


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


async def fetch_rows(states: list[str]) -> list[dict[str, Any]]:
    """Official lots newer than the graded archive, for the requested states."""
    timeout = httpx.Timeout(connect=10.0, read=25.0, write=10.0, pool=10.0)
    async with httpx.AsyncClient(
        timeout=timeout, follow_redirects=True, headers=REQUEST_HEADERS
    ) as client:
        filters = await _load_filters(client)
        sealed = archive.sealed_dates()
        months = _months_to_fetch()
        rows: list[dict[str, Any]] = []
        resolved = 0
        for state in states:
            match = _resolve_state(filters, state)
            if match is None:
                continue
            resolved += 1
            state_id, state_name = match
            for year, month in months:
                response = await client.get(
                    f"{AGMARKNET_BASE}/prices-and-arrivals/date-wise/specific-commodity",
                    params={
                        "year": str(year),
                        "month": str(month),
                        "includeExcel": "false",
                        "stateId": state_id,
                        "commodityId": filters["commodity_id"],
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if not payload.get("success"):
                    continue
                rows.extend(
                    _rows_from_month(
                        payload,
                        state_name=state_name,
                        state_id=state_id,
                        filters=filters,
                        sealed=sealed,
                    )
                )
        if states and resolved == 0:
            raise RuntimeError("None of the requested states matched AGMARKNET.")
        return rows
