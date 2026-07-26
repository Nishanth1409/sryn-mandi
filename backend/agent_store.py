"""User-submitted local agent purchase rates, averaged by location + variety."""

from __future__ import annotations

import json
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

STORE_PATH = Path(__file__).resolve().parent / "data" / "agent_quotes.json"
_lock = threading.Lock()

VALID_VARIETIES = {"sarakku", "bede", "rashi", "andal"}


def _today() -> str:
    return date.today().isoformat()


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


def list_quotes(
    *,
    district: str | None = None,
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
        if variety_key and q.get("variety_key") != variety_key:
            continue
        out.append(q)

    out.sort(key=lambda x: str(x.get("created_at") or x.get("quote_date") or ""), reverse=True)
    return out


def averages_by_variety(
    district: str | None = None,
    days: int = 30,
) -> dict[str, dict[str, Any]]:
    """
    For each variety at this location: average of all user-submitted agent purchase rates.
    Returns count, avg, min, max, latest rate + date.
    """
    buckets: dict[str, list[dict[str, Any]]] = {k: [] for k in VALID_VARIETIES}
    for q in list_quotes(district=district, days=days):
        key = str(q.get("variety_key") or "")
        if key in buckets:
            buckets[key].append(q)

    result: dict[str, dict[str, Any]] = {}
    for key, items in buckets.items():
        if not items:
            continue
        rates = [float(i["rate"]) for i in items if i.get("rate")]
        if not rates:
            continue
        latest = items[0]
        result[key] = {
            "variety_key": key,
            "district": district,
            "count": len(rates),
            "avg_rate": round(sum(rates) / len(rates)),
            "min_rate": round(min(rates)),
            "max_rate": round(max(rates)),
            "latest_rate": round(float(latest.get("rate") or 0)),
            "latest_date": latest.get("quote_date"),
            "unit": "Rs./Quintal",
            "source": "user_average",
        }
    return result


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

    row = {
        "id": str(uuid.uuid4()),
        "variety_key": variety_key,
        "rate": round(rate),
        "unit": "Rs./Quintal",
        "district": district,
        "market": str(payload.get("market") or "Local agent purchase").strip()[:120],
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
