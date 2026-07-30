"""Human-solved AGMARKNET captcha access.

AGMARKNET's daily report endpoint now requires a captcha on every new filter
set. The official portal solves that captcha in the browser, then receives a
short-lived `report_ticket` good for about 30 follow-up calls. This module
mirrors that contract exactly:

1. Ask AGMARKNET for a captcha image + key.
2. Accept the visitor's typed answer.
3. Use the resulting ticket to page through official lots.
4. Persist those exact rows into the local archive so date browsing works even
   after the ticket expires.

Nothing here invents prices or dates — every row comes from api.agmarknet.gov.in.
"""

from __future__ import annotations

import json
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import httpx

from backend.dates import format_date, parse_date

AGMARKNET_BASE = "https://api.agmarknet.gov.in/v1"
PORTAL_URL = "https://agmarknet.gov.in"
COMMODITY = "Arecanut(Betelnut/Supari)"
DEFAULT_GRADE_ID = "100003"
DEFAULT_VARIETY_ID = "100007"
REPORT_PAGE_LIMIT = 5000
MAX_PAGES = 30

REQUEST_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "Origin": PORTAL_URL,
    "Referer": f"{PORTAL_URL}/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
    ),
}

_lock = threading.Lock()
_ticket: dict[str, Any] | None = None


def _parse_expiry(value: str | None) -> float:
    if not value:
        return 0.0
    text = value.strip().rstrip("Z")
    try:
        # AGMARKNET returns "...+00:00Z" — strip trailing Z after timezone.
        if text.endswith("+00:00"):
            dt = datetime.fromisoformat(text)
        else:
            dt = datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except ValueError:
        return 0.0


def _year_window(lookback_days: int) -> tuple[date, date]:
    """Stay inside one calendar year — AGMARKNET rejects cross-year ranges."""
    today = date.today()
    year_start = date(today.year, 1, 1)
    earliest = today - timedelta(days=max(1, lookback_days))
    return max(earliest, year_start), today


def _resolve_filters(states: list[str]) -> dict[str, Any]:
    from agmarknet import Agmarknet

    api = Agmarknet(request_delay=0, timeout=20.0, use_cache=True)
    return api._resolve_report_filters(
        group=None,
        commodity=COMMODITY,
        state=states if len(states) > 1 else states[0],
        district=None,
        market=None,
        grade=DEFAULT_GRADE_ID,
        variety=DEFAULT_VARIETY_ID,
    )


def _report_payload(
    *,
    resolved: dict[str, Any],
    from_day: date,
    to_day: date,
    page: int,
    limit: int = REPORT_PAGE_LIMIT,
) -> dict[str, str]:
    from agmarknet.models import ReportRequest

    return ReportRequest.from_user_input(
        from_date=from_day,
        to_date=to_day,
        data_type="price",
        group=resolved["group"],
        commodity=resolved["commodity"],
        state=resolved["state"],
        district=resolved["district"],
        market=resolved["market"],
        grade=resolved["grade"],
        variety=resolved["variety"],
        page=page,
        limit=limit,
    ).to_payload()


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


def _normalize_rows(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for row in records:
        arrival = str(row.get("arrival_date") or "")
        day = parse_date(arrival)
        rows.append(
            {
                "state": str(row.get("state_name") or ""),
                "district": str(row.get("district_name") or ""),
                "market": str(row.get("market_name") or ""),
                "commodity": str(row.get("cmdt_name") or COMMODITY),
                "variety": str(row.get("variety_name") or "Other"),
                "grade": str(row.get("grade_name") or ""),
                "arrival_date": format_date(day) if day else arrival,
                "min_price": _parse_number(row.get("min_price")),
                "max_price": _parse_number(row.get("max_price")),
                "modal_price": _parse_number(
                    row.get("model_price") or row.get("modal_price")
                ),
                "arrival_qty": _parse_number(row.get("arrival_qty")) or None,
                "unit": str(row.get("unit_name_price") or "Rs./Quintal"),
                "source": "AGMARKNET",
            }
        )
    return rows


def _remember_ticket(access: dict[str, Any], *, from_day: date, to_day: date, states: list[str]) -> None:
    global _ticket
    ticket = access.get("report_ticket")
    if not ticket:
        return
    with _lock:
        _ticket = {
            "report_ticket": ticket,
            "expires_at": _parse_expiry(access.get("expires_at")),
            "expires_at_iso": access.get("expires_at"),
            "remaining_calls": int(access.get("remaining_calls") or 0),
            "max_calls": int(access.get("max_calls") or 0),
            "from_date": from_day.isoformat(),
            "to_date": to_day.isoformat(),
            "states": list(states),
            "saved_at": time.time(),
        }


def ticket_status() -> dict[str, Any]:
    with _lock:
        current = dict(_ticket) if _ticket else None
    if not current:
        return {"active": False, "reason": "none"}
    if time.time() >= float(current.get("expires_at") or 0):
        return {"active": False, "reason": "expired", **{k: current[k] for k in ("from_date", "to_date", "states") if k in current}}
    if int(current.get("remaining_calls") or 0) <= 0:
        return {"active": False, "reason": "exhausted", **current}
    return {"active": True, **current}


def clear_ticket() -> None:
    global _ticket
    with _lock:
        _ticket = None


def generate_captcha() -> dict[str, Any]:
    """Return a fresh AGMARKNET captcha challenge for the visitor to solve."""
    with httpx.Client(timeout=30.0, headers=REQUEST_HEADERS) as client:
        response = client.post(f"{AGMARKNET_BASE}/captcha/generator", json={})
        response.raise_for_status()
        payload = response.json()
    image = payload.get("captcha_image") or ""
    image_type = payload.get("image_type") or "image/png"
    return {
        "captcha_key": payload.get("captcha_key"),
        "captcha_image": image,
        "image_type": image_type,
        "image_data_url": f"data:{image_type};base64,{image}" if image else None,
        "expires_at": payload.get("expires_at"),
        "generated_at": payload.get("generated_at"),
    }


def unlock_history(
    *,
    captcha_key: str,
    captcha: str,
    states: list[str],
    lookback_days: int = 400,
) -> dict[str, Any]:
    """Solve the captcha once, page through official history, return exact rows."""
    if not captcha_key.strip() or not captcha.strip():
        raise ValueError("captcha_key and captcha are required")
    if not states:
        raise ValueError("at least one state is required")

    from_day, to_day = _year_window(lookback_days)
    resolved = _resolve_filters(states)
    all_rows: list[dict[str, Any]] = []
    total_count = 0
    pages_fetched = 0
    access: dict[str, Any] = {}

    with httpx.Client(timeout=120.0, headers=REQUEST_HEADERS) as client:
        for page in range(1, MAX_PAGES + 1):
            body = _report_payload(
                resolved=resolved,
                from_day=from_day,
                to_day=to_day,
                page=page,
            )
            if page == 1:
                body["captcha_key"] = captcha_key.strip()
                body["captcha"] = captcha.strip()
            else:
                ticket = access.get("report_ticket")
                if not ticket:
                    break
                body["report_ticket"] = ticket

            response = client.post(f"{AGMARKNET_BASE}/daily-price-arrival/report", json=body)
            try:
                payload = response.json()
            except ValueError as exc:
                raise RuntimeError(f"AGMARKNET returned non-JSON ({response.status_code})") from exc

            if response.status_code != 200:
                detail = payload.get("detail") or payload.get("message") or response.text
                code = payload.get("code") or "AGMARKNET_ERROR"
                raise RuntimeError(f"{code}: {detail}")

            access = payload.get("report_access") or access
            _remember_ticket(access, from_day=from_day, to_day=to_day, states=states)

            block = ((payload.get("data") or {}).get("records") or [{}])[0]
            page_rows = block.get("data") or []
            info = (block.get("pagination") or [{}])[0]
            total_count = int(info.get("total_count") or total_count or len(page_rows))
            total_pages = int(info.get("total_pages") or 1)
            all_rows.extend(_normalize_rows(page_rows))
            pages_fetched += 1

            if page >= total_pages or not page_rows:
                break
            if int(access.get("remaining_calls") or 0) <= 0:
                break

    dates = sorted(
        {
            row["arrival_date"]
            for row in all_rows
            if parse_date(row["arrival_date"]) is not None
        },
        key=lambda value: parse_date(value) or date.min,
    )
    return {
        "rows": all_rows,
        "row_count": len(all_rows),
        "total_count": total_count,
        "pages_fetched": pages_fetched,
        "from_date": format_date(from_day),
        "to_date": format_date(to_day),
        "states": states,
        "available_dates": dates,
        "date_count": len(dates),
        "report_access": {
            "report_ticket": access.get("report_ticket"),
            "expires_at": access.get("expires_at"),
            "remaining_calls": access.get("remaining_calls"),
            "max_calls": access.get("max_calls"),
        },
    }
