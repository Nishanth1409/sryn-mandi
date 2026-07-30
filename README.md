# Sryn Mandi

Exact official arecanut (adike) mandi lots from data.gov.in and AGMARKNET,
browsable by every date those sources have actually published.

The app never generates a missing date or price.

## What you can do

- Browse **official lots by available date** with a compact calendar (only dates that exist).
- See **Your place rates** (GPS or chosen APMC) for the selected date.
- Filter **Official mandi rates** by market, variety, and date.
- Read **Variety history** (chart + top markets) filtered by place and variety, with manual location pick.
- Switch **language** (EN / ಕನ್ನಡ / हिंदी) and **theme** (sun / moon) from the header.
- Theme-aware brand logos for light and dark.

## Data sources

| Source | Status | Notes |
| --- | --- | --- |
| data.gov.in daily mandi feed | Working | Publishes the current day's lots; paginated on every fetch |
| AGMARKNET report API | Captcha-gated | Multi-day history unlocks when a visitor solves the official AGMARKNET captcha once |

Without a solved captcha, the open-data feed still supplies today's lots. Older
dates come from the local archive of previously unlocked official rows. Solving
the captcha in the app asks AGMARKNET for the exact history for the current
calendar year, archives every returned lot, then the date picker lists those
dates — nothing is invented.

### When the CAPTCHA appears

The unlock panel shows when AGMARKNET reports `captcha_required` **and** the
archive has few dates (about 3 or fewer). The visitor types the characters from
the official image once; the server uses the returned report ticket to page
through exact lots into the archive. After that, date browsing uses archived
official data — no captcha on every visit.

## Self-healing

- Every fetched row is written to a durable archive (`backend/data/market_archive.json`,
  overridable with `MARKET_ARCHIVE_PATH`), so an upstream outage never empties the board.
- Each source has its own time budget, so one stalling source cannot starve the other.
- Failed fetches retry with a widening delay (1 min → 15 min) until the sources answer;
  the browser retries too, so a stuck screen recovers without a manual reload.
- When AGMARKNET demands a captcha, automatic pulls pause and the site shows the
  official challenge for the visitor to solve. One answer yields a short-lived
  report ticket used to page through exact history into the archive.
- `GET /api/health` reports source status, failure counts and archive coverage.
- `GET /api/agmarknet/captcha` and `POST /api/agmarknet/unlock` are the visitor unlock path.

## Stack

- Frontend: Vite + React (Vercel)
- Backend: FastAPI (Render free)
- PWA install on Android / iOS home screen

## Local development

```bash
npm install
npm run setup:api
npm run dev
```

UI: http://127.0.0.1:5173 · API: http://127.0.0.1:8001

Optional: regenerate the header logos from the artwork in `public/Dark theme.png` and `public/light theme.png`:

```bash
python scripts/make_theme_logos.py
```

## Production env

Set on Vercel:

```
VITE_API_URL=https://YOUR-RENDER-API.onrender.com
```
