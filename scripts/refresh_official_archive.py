"""One-time local refresh: solve AGMARKNET captcha once, update seed + ticket.

Run on a trusted machine (not shown to app visitors):
  python scripts/refresh_official_archive.py
"""

from __future__ import annotations

import base64
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import agmarknet_access, archive  # noqa: E402


def main() -> None:
    archive.ensure_seeded()
    print("Before:", archive.stats())
    challenge = agmarknet_access.generate_captcha()
    key = challenge.get("captcha_key") or ""
    img = challenge.get("captcha_image") or ""
    out = ROOT / "backend" / "data" / "_captcha_refresh.png"
    out.write_bytes(base64.b64decode(img))
    print(f"Captcha image: {out}")
    answer = input("Type captcha exactly as shown: ").strip()
    if not answer:
        raise SystemExit("Captcha required to fetch official rows.")
    result = agmarknet_access.unlock_history(
        captcha_key=key,
        captcha=answer,
        states=["Karnataka"],
        lookback_days=400,
    )
    added = archive.remember(result["rows"])
    archive.write_seed()
    print("Added lots:", added)
    print("After:", archive.stats())
    print("Ticket:", agmarknet_access.ticket_status())


if __name__ == "__main__":
    main()
