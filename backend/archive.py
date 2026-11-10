"""Durable store of official market rows.

Every row kept here was returned by AGMARKNET or data.gov.in. Nothing is
derived or estimated, so the archive can be served verbatim while an upstream
source is unreachable, and it keeps past dates available after those sources
drop them from their short live window.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from backend.dates import format_date, india_today, parse_date

ARCHIVE_PATH = Path(
    os.environ.get("MARKET_ARCHIVE_PATH")
    or (
        Path("/tmp/market_archive.json")
        if os.environ.get("VERCEL")
        else Path(__file__).resolve().parent / "data" / "market_archive.json"
    )
)
SEED_ARCHIVE_PATH = Path(__file__).resolve().parent / "data" / "market_archive.seed.json"

MAX_AGE_DAYS = 400
MAX_ROWS = 60_000
# Below this many distinct official dates we still ask for a captcha unlock.
MIN_ADEQUATE_DATES = 7
# If the newest saved official date is older than this many calendar days,
# treat the archive as stale and ask AGMARKNET (captcha) / data.gov.in again.
MAX_FRESH_LAG_DAYS = 2

_ROW_FIELDS = (
    "state",
    "district",
    "market",
    "commodity",
    "variety",
    "grade",
    "arrival_date",
    "min_price",
    "max_price",
    "modal_price",
    "arrival_qty",
    "unit",
    "source",
)
_KEY_FIELDS = ("state", "district", "market", "variety", "grade")

_lock = threading.Lock()
_rows: dict[str, dict[str, Any]] | None = None


def row_key(row: dict[str, Any]) -> str | None:
    """Stable identity of one official lot: place + variety + grade + date."""
    day = parse_date(str(row.get("arrival_date") or ""))
    if day is None:
        return None
    parts = [str(row.get(field) or "").strip().lower() for field in _KEY_FIELDS]
    parts.append(format_date(day))
    return "|".join(parts)


def _clean(row: dict[str, Any]) -> dict[str, Any] | None:
    day = parse_date(str(row.get("arrival_date") or ""))
    if day is None:
        return None
    cleaned: dict[str, Any] = {field: row.get(field) for field in _ROW_FIELDS}
    cleaned["arrival_date"] = format_date(day)
    for field in ("min_price", "max_price", "modal_price"):
        try:
            cleaned[field] = float(cleaned.get(field) or 0.0)
        except (TypeError, ValueError):
            cleaned[field] = 0.0
    qty = cleaned.get("arrival_qty")
    try:
        cleaned["arrival_qty"] = float(qty) if qty not in (None, "") else None
    except (TypeError, ValueError):
        cleaned["arrival_qty"] = None
    for field in ("state", "district", "market", "commodity", "variety", "grade", "unit", "source"):
        cleaned[field] = str(cleaned.get(field) or "")
    return cleaned


def _load_locked() -> dict[str, dict[str, Any]]:
    global _rows
    if _rows is not None:
        return _rows
    loaded: dict[str, dict[str, Any]] = {}
    try:
        if ARCHIVE_PATH.exists():
            payload = json.loads(ARCHIVE_PATH.read_text(encoding="utf-8"))
            stored = payload.get("rows")
            if isinstance(stored, list):
                for row in stored:
                    if not isinstance(row, dict):
                        continue
                    cleaned = _clean(row)
                    signature = row_key(row) if cleaned else None
                    if cleaned and signature:
                        loaded[signature] = cleaned
    except (OSError, ValueError):
        loaded = {}
    if not loaded:
        loaded = _load_seed_locked()
        if loaded:
            _rows = _prune_locked(loaded)
            _save_locked(_rows)
    else:
        _rows = loaded
    return _rows


def _load_seed_locked() -> dict[str, dict[str, Any]]:
    """Bundled official history used on cold serverless starts."""
    if not SEED_ARCHIVE_PATH.exists():
        return {}
    loaded: dict[str, dict[str, Any]] = {}
    try:
        payload = json.loads(SEED_ARCHIVE_PATH.read_text(encoding="utf-8"))
        stored = payload.get("rows")
        if isinstance(stored, list):
            for row in stored:
                if not isinstance(row, dict):
                    continue
                cleaned = _clean(row)
                signature = row_key(row) if cleaned else None
                if cleaned and signature:
                    loaded[signature] = cleaned
    except (OSError, ValueError):
        return {}
    return loaded


def ensure_seeded() -> dict[str, Any]:
    """Load archive from disk or bundled seed before the first request."""
    with _lock:
        rows = _load_locked()
        return stats_from_rows(rows)


def is_adequate(min_dates: int = MIN_ADEQUATE_DATES) -> bool:
    with _lock:
        return len({row["arrival_date"] for row in _load_locked().values()}) >= min_dates


def sealed_dates() -> set[str]:
    """Dates already stored from the graded lot report.

    The captcha-free daily feed has no grade, so rewriting those days would
    duplicate every lot. Newer days are not sealed and can refresh in place.
    """
    with _lock:
        return {
            row["arrival_date"]
            for row in _load_locked().values()
            if str(row.get("grade") or "").strip()
        }


def latest_day() -> date | None:
    with _lock:
        days = [
            parse_date(row["arrival_date"])
            for row in _load_locked().values()
        ]
        days = [day for day in days if day is not None]
        return max(days) if days else None


def days_behind(today: date | None = None) -> int | None:
    """How many calendar days the newest saved official date lags behind today."""
    newest = latest_day()
    if newest is None:
        return None
    return max(0, ((today or india_today()) - newest).days)


def is_stale(max_lag_days: int = MAX_FRESH_LAG_DAYS, today: date | None = None) -> bool:
    """True when there is no archive, or the newest official date is too old."""
    lag = days_behind(today)
    if lag is None:
        return True
    return lag > max_lag_days


def write_seed(rows: dict[str, dict[str, Any]] | None = None) -> bool:
    """Rewrite the bundled seed so the next cold start keeps unlocked history."""
    if rows is None:
        with _lock:
            payload_rows = list(_load_locked().values())
    else:
        payload_rows = list(rows.values())
    if not payload_rows:
        return False
    try:
        SEED_ARCHIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = SEED_ARCHIVE_PATH.with_suffix(".tmp")
        temp_path.write_text(
            json.dumps({"version": 1, "rows": payload_rows}, ensure_ascii=False),
            encoding="utf-8",
        )
        temp_path.replace(SEED_ARCHIVE_PATH)
        return True
    except OSError:
        return False


def stats_from_rows(rows: dict[str, dict[str, Any]]) -> dict[str, Any]:
    days = sorted({row["arrival_date"] for row in rows.values()})
    ordered = sorted(days, key=lambda value: parse_date(value) or date.min)
    newest = parse_date(ordered[-1]) if ordered else None
    lag = None
    if newest is not None:
        lag = max(0, (india_today() - newest).days)
    return {
        "rows": len(rows),
        "dates": len(ordered),
        "earliest_date": ordered[0] if ordered else None,
        "latest_date": ordered[-1] if ordered else None,
        "days_behind": lag,
        "stale": lag is None or lag > MAX_FRESH_LAG_DAYS,
    }


def _prune_locked(rows: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    cutoff = india_today() - timedelta(days=MAX_AGE_DAYS)
    kept = {
        signature: row
        for signature, row in rows.items()
        if (parse_date(row["arrival_date"]) or date.min) >= cutoff
    }
    if len(kept) > MAX_ROWS:
        ranked = sorted(
            kept.items(),
            key=lambda item: parse_date(item[1]["arrival_date"]) or date.min,
            reverse=True,
        )
        kept = dict(ranked[:MAX_ROWS])
    return kept


def _save_locked(rows: dict[str, dict[str, Any]]) -> None:
    try:
        ARCHIVE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temp_path = ARCHIVE_PATH.with_suffix(".tmp")
        temp_path.write_text(
            json.dumps({"version": 1, "rows": list(rows.values())}, ensure_ascii=False),
            encoding="utf-8",
        )
        temp_path.replace(ARCHIVE_PATH)
    except OSError:
        # A read-only filesystem must not break serving; memory copy still works.
        pass


def _same_lot(previous: dict[str, Any], cleaned: dict[str, Any]) -> bool:
    for field in (
        "min_price",
        "max_price",
        "modal_price",
        "arrival_qty",
        "district",
        "variety",
        "grade",
        "unit",
    ):
        if previous.get(field) != cleaned.get(field):
            return False
    return True


def remember(rows: list[dict[str, Any]]) -> int:
    """Store freshly fetched official rows. Returns how many dates/lots were new."""
    if not rows:
        return 0
    with _lock:
        global _rows
        current = dict(_load_locked())
        added = 0
        updated = 0
        for row in rows:
            signature = row_key(row)
            cleaned = _clean(row) if signature else None
            if not signature or cleaned is None:
                continue
            previous = current.get(signature)
            if previous is None:
                added += 1
            elif not _same_lot(previous, cleaned):
                updated += 1
            current[signature] = cleaned
        _rows = _prune_locked(current)
        if added or updated:
            _save_locked(_rows)
            # Keep the bundled seed in sync on writable hosts so cold starts
            # (and the next deploy) do not fall back to an older snapshot.
            if not os.environ.get("VERCEL"):
                write_seed(_rows)
        return added


def rows_since(cutoff: date) -> list[dict[str, Any]]:
    with _lock:
        return [
            dict(row)
            for row in _load_locked().values()
            if (parse_date(row["arrival_date"]) or date.min) >= cutoff
        ]


def stats() -> dict[str, Any]:
    with _lock:
        return stats_from_rows(_load_locked())
