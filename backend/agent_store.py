"""User-submitted local agent purchase rates, min/max by place + variety."""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

STORE_PATH = Path(
    os.environ.get("AGENT_QUOTES_PATH")
    or (
        Path("/tmp/agent_quotes.json")
        if os.environ.get("VERCEL")
        else Path(__file__).resolve().parent / "data" / "agent_quotes.json"
    )
)
_lock = threading.Lock()

VALID_VARIETIES = {"sarakku", "bede", "rashi", "andal"}


def _today() -> str:
    return date.today().isoformat()


def _norm_place(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _ensure_store() -> list[dict[str, Any]]:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not STORE_PATH.exists():
        _save([])
        return []
    try:
        payload = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        quotes = payload.get("quotes")
        if not isinstance(quotes, list):
            return []
        # Drop any old seed / non-user entries
        return [q for q in quotes if q.get("source") == "user" or q.get("source") == "community"]
    except Exception:
        return []


def _save(quotes: list[dict[str, Any]]) -> None:
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STORE_PATH.write_text(
        json.dumps({"quotes": quotes, "updated_at": datetime.now().isoformat()}, indent=2),
        encoding="utf-8",
    )


def _same_district(requested: str | None, stored: str) -> bool:
    if not requested:
        return True
    d = requested.lower().strip()
    s = stored.lower().strip()
    if d in s or s in d:
        return True
    if ("shivamogga" in d or "shimoga" in d) and ("shivamogga" in s or "shimoga" in s):
        return True
    return False


def _same_market(requested: str | None, stored: str) -> bool:
    if not requested:
        return True
    return _norm_place(requested) == _norm_place(stored) or (
        _norm_place(requested) in _norm_place(stored)
        or _norm_place(stored) in _norm_place(requested)
    )


def list_quotes(
    *,
    district: str | None = None,
    market: str | None = None,
    variety_key: str | None = None,
    days: int = 30,
) -> list[dict[str, Any]]:
    with _lock:
        quotes = _ensure_store()

    cutoff = date.today().toordinal() - max(days, 1)
    out: list[dict[str, Any]] = []
    for q in quotes:
        # Only keep real user-submitted purchase amounts
        if q.get("source") not in ("user", "community"):
            continue
        # Ignore legacy seed id if still present
        if str(q.get("id", "")).startswith("seed-"):
            continue
        try:
            qd = date.fromisoformat(str(q.get("quote_date") or q.get("created_at", ""))[:10])
        except ValueError:
            continue
        if qd.toordinal() < cutoff:
            continue
        if not _same_district(district, str(q.get("district", ""))):
            continue
        if market and not _same_market(market, str(q.get("market", ""))):
            continue
        if variety_key and q.get("variety_key") != variety_key:
            continue
        out.append(q)

    out.sort(key=lambda x: str(x.get("created_at") or x.get("quote_date") or ""), reverse=True)
    return out


def _rate_stats(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    rates = [round(float(i["rate"])) for i in items if i.get("rate")]
    if not rates:
        return None
    latest = items[0]
    return {
        "count": len(rates),
        "min_rate": min(rates),
        "max_rate": max(rates),
        "rates": sorted(rates),
        "latest_rate": round(float(latest.get("rate") or 0)),
        "latest_date": latest.get("quote_date"),
        "unit": "Rs./Quintal",
        "source": "user_minmax",
    }


def averages_by_variety(
    district: str | None = None,
    market: str | None = None,
    days: int = 30,
) -> dict[str, dict[str, Any]]:
    """
    District (optional market) rollup per variety: min/max of user-submitted amounts.
    Kept under the old function name for API compatibility — no average is the primary value.
    """
    buckets: dict[str, list[dict[str, Any]]] = {k: [] for k in VALID_VARIETIES}
    for q in list_quotes(district=district, market=market, days=days):
        key = str(q.get("variety_key") or "")
        if key in buckets:
            buckets[key].append(q)

    result: dict[str, dict[str, Any]] = {}
    for key, items in buckets.items():
        stats = _rate_stats(items)
        if not stats:
            continue
        result[key] = {
            "variety_key": key,
            "district": district,
            "market": market,
            **stats,
        }
    return result


def stats_by_place_and_variety(
    district: str | None = None,
    days: int = 30,
) -> list[dict[str, Any]]:
    """
    Group submissions by place (district + market) and variety.
    Many agents at the same place → min and max for that place only.
    """
    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for q in list_quotes(district=district, days=days):
        variety = str(q.get("variety_key") or "")
        if variety not in VALID_VARIETIES:
            continue
        dist = str(q.get("district") or district or "").strip() or "Unknown"
        market = str(q.get("market") or "Local agent").strip() or "Local agent"
        groups.setdefault((dist, market, variety), []).append(q)

    rows: list[dict[str, Any]] = []
    for (dist, market, variety), items in groups.items():
        stats = _rate_stats(items)
        if not stats:
            continue
        rows.append(
            {
                "district": dist,
                "market": market,
                "place_label": f"{market} · {dist}",
                "variety_key": variety,
                **stats,
            }
        )

    rows.sort(
        key=lambda r: (
            str(r.get("district") or ""),
            str(r.get("market") or ""),
            str(r.get("variety_key") or ""),
        )
    )
    return rows


def add_quote(payload: dict[str, Any]) -> dict[str, Any]:
    variety_key = str(payload.get("variety_key", "")).lower().strip()
    if variety_key not in VALID_VARIETIES:
        raise ValueError("variety_key must be sarakku|bede|rashi|andal")

    rate = float(payload.get("rate") or 0)
    if rate < 1000 or rate > 500000:
        raise ValueError("rate must be a realistic ₹/quintal amount")

    district = str(payload.get("district") or "").strip()
    if len(district) < 2:
        raise ValueError("district is required")

    market = str(payload.get("market") or "Local agent purchase").strip()[:120]
    if len(market) < 2:
        market = "Local agent purchase"

    row = {
        "id": str(uuid.uuid4()),
        "variety_key": variety_key,
        "rate": round(rate),
        "unit": "Rs./Quintal",
        "district": district,
        "market": market,
        "source": "user",
        "note": str(payload.get("note") or "User-submitted local purchase rate").strip()[:240],
        "quote_date": str(payload.get("quote_date") or _today())[:10],
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "lat": payload.get("lat"),
        "lng": payload.get("lng"),
    }

    with _lock:
        quotes = _ensure_store()
        # purge any leftover seeds
        quotes = [q for q in quotes if not str(q.get("id", "")).startswith("seed-")]
        quotes.insert(0, row)
        quotes = quotes[:800]
        _save(quotes)
    return row


def reset_store() -> None:
    """Clear all quotes (dev/admin)."""
    with _lock:
        _save([])
