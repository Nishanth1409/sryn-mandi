"""Shared arrival-date parsing for the official AGMARKNET / data.gov.in formats."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

INPUT_FORMATS = ("%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d")


def parse_date(value: str) -> date | None:
    if not value:
        return None
    for fmt in INPUT_FORMATS:
        try:
            return datetime.strptime(value.strip(), fmt).date()
        except ValueError:
            continue
    return None


def format_date(value: date) -> str:
    return value.strftime("%d-%m-%Y")


def india_today() -> date:
    """Calendar day in India (IST, no daylight saving)."""
    return (datetime.now(timezone.utc) + timedelta(hours=5, minutes=30)).date()
