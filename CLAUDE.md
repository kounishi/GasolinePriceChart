# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Next.js 14 (App Router) app that reads the weekly gasoline price Excel published by 資源エネルギー庁 (METI Agency for Natural Resources and Energy), stores the last 5 survey dates in Redis, renders comparison tables, and exports a filled A3 print template as `.xlsx`.

UI strings, code comments, and log messages are Japanese — keep new ones Japanese too.

## Commands

```bash
npm run dev              # dev server on :3000
npm run build            # next build
npm start                # serve the production build
npm run update-prices    # scrape enecho + write Redis (tsx scripts/update-prices.ts)
```

- `npm run update-prices` loads `.env.local` itself via `dotenv`; the Next.js processes get it from Next's built-in `.env.local` support.
- `npm run lint` exists but no ESLint config is committed, so it drops into Next's interactive setup. There are no tests and no test runner.
- Exercise the cron path locally: `curl.exe -H "Authorization: Bearer $env:CRON_SECRET" http://localhost:3000/api/cron/update-prices`
- VS Code launch configs are in `.vscode/launch.json` (server-side / client-side / full stack).
- `run-update-prices.bat` is the entry point for Windows Task Scheduler; it hardcodes the repo path.

## Environment

`.env.local` needs `REDIS_URL` and `CRON_SECRET` (see `SETUP_ENV.md`; `vercel env pull .env.local` works). Despite the spec doc, `@vercel/kv` is not used — `lib/store.ts` talks to Redis via the `redis` client.

## Architecture

### Write path (the only two writers)

`lib/enecho.ts` fetches `pl007/results.html` and cheerio-picks the `<a>` whose text contains 「週次ファイル」 → weekly `.xlsx` is downloaded → `buildPriceStateFromWorkbook()` in `lib/weekly.ts` parses it → `saveState()` writes the JSON blob to Redis key `gas_price_state`.

That sequence exists in exactly two places:

- `scripts/update-prices.ts` — the recommended path (local machine, no serverless timeout).
- `app/api/cron/update-prices/route.ts` — Vercel Cron, `maxDuration: 300`, requires `Authorization: Bearer ${CRON_SECRET}`.

The two files duplicate the same fetch/parse/skip logic almost line for line. **Any change to the update or skip rules must be applied to both.**

### enecho access is behind AWS WAF — every fetch needs the UA

Since 2026-07-01 the enecho site sits behind CloudFront + AWS WAF, which **403s any request whose User-Agent is not a browser**. Node's `fetch` sends `User-Agent: node`, so a bare `fetch` to enecho always fails. There are **three** enecho fetch sites and all of them must pass `ENECHO_FETCH_HEADERS` (exported from `lib/enecho.ts`):

- `lib/enecho.ts` — `results.html`
- `scripts/update-prices.ts` — weekly `.xlsx`
- `app/api/cron/update-prices/route.ts` — weekly `.xlsx`

Each must also call `assertNotWafChallenged(resp, label)` before the `!resp.ok` check. Under rapid access the WAF escalates to a JS challenge that returns **`202` + `x-amzn-waf-action: challenge` with an empty body**, and `202` satisfies `resp.ok`, so without that guard the empty HTML gets parsed and surfaces as the misleading 「「週次ファイル」のリンクが見つかりませんでした」. Both writers also wait `REQUEST_INTERVAL_MS` between `results.html` and the `.xlsx` to stay clear of the rate-based rule. `/common/**` is exempt from the WAF, which is why static assets still fetch fine.

`vercel.json` schedules the cron at `0 9 * * *`. Vercel evaluates cron expressions in UTC, so that is 18:00 JST — the README's "毎日午前9時（JST）" claim does not match the expression.

### Read path

- `GET /api/prices` → `loadState()`, used on page load.
- `POST /api/update-prices` → **does not touch enecho despite its name.** It only re-reads Redis and returns the state; the button in `app/page.tsx` is effectively "reload from Redis". Don't assume the name implies scraping.
- `GET /api/download-prices` → `loadState()` + template → filled workbook.

### Skip-update rule

An update is skipped only when all three hold: `lastSurveyDate` is unchanged **and** the stored data is not the legacy shape (6 sections, or ids containing `-east`/`-west`) **and** both 北海道 and 沖縄 rows carry non-zero prices. The latter two conditions are migration guards that force a rewrite of stale Redis blobs; removing them will strand old data.

### Two different region models — the main source of bugs

`lib/weekly.ts` builds **27 sections** = 3 fuels × 9 regions (`hokkaido, tohoku, kanto, chubu, kinki, chugoku, shikoku, kyushu, okinawa`), ids like `regular-kanto`. Section `surveyDates`/`national` are the same across sections of one fuel; prefecture order inside `REGION_PREFS` is deliberately aligned to the Excel template's column order.

Two consumers re-group those 27 sections differently, and neither grouping is derivable from the other:

1. `app/page.tsx` renders 6 display groups per fuel: 北海道・東北 / 関東 / 中部 / 近畿 / 中国・四国 / 九州・沖縄.
2. `app/api/download-prices/route.ts` collapses them into the template's 6 east/west blocks, and its mapping is *not* geographic:
   - `EAST_REGIONS = tohoku, kanto, chubu`
   - `WEST_REGIONS = kinki, chugoku, shikoku, kyushu, okinawa, hokkaido` — 北海道 sits in the west block because the template puts its column there (AB; 沖縄 at AA).
   - 三重 is copied out of `kinki` into the east block and filtered out of the west block, matching the template.

### Prefecture name matching

The weekly Excel labels those two columns 「北海道局」「沖縄局」, not 「北海道」「沖縄」. `normalizeName()` (strip half/full-width spaces) plus explicit 局-suffix fallbacks handle this on both the parse side (`lib/weekly.ts`) and the template-fill side (`download-prices`). Header text on either side changing is the usual cause of missing columns; both paths log warnings naming the key they searched for.

### Excel template

`templates/251203_ガソリン価格比較表.xlsx` is committed and required — `download-prices` throws without it. `SECTION_LAYOUTS` gives sheet 比較表まとめ plus `headerRow`/`dataStartRow` per block, but `fillSection()` does not trust them: it scans up to 20 rows up and 10 rows down for a row containing both 調査日 and 全国, then shifts `dataStartRow` by the offset it found. So moving rows in the template usually still works; renaming those two header cells breaks it.

Red highlighting of above-national prices is applied inline in the HTML table (`bg-red-200`) but **deliberately left to the template's conditional formatting in Excel** — the fill code in `fillSection()` is commented out on purpose.

### Storage fallback (important gotcha)

`lib/store.ts` falls back to a module-level in-memory `mockData` when `REDIS_URL` is unset *or* when any Redis call throws, logging only a `console.warn`. Writes then appear to succeed and silently vanish (and on serverless, each instance has its own copy). If data "won't persist", check for that warning first.

### Cache invalidation

`prices` and `download-prices` set `dynamic = 'force-dynamic'` and `revalidate = 0`, and `app/page.tsx` sends `cache: 'no-store'` plus no-cache headers on both fetches. Several recent commits exist purely to fix stale data — don't reintroduce caching on these routes.

## Doc drift

`gasoline_price_app_spec.md` is the original spec and is now stale: it describes `@vercel/kv`, 6 east/west sections with `region: 'east' | 'west'`, and `POST /api/update-prices` doing the scraping. Treat `lib/types.ts` and the route files as the source of truth.
