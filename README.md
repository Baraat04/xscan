# xscan — Tender Tribunal

Public tenders from the EU (TED), the US (USAspending, SAM.gov) and **any procurement website** (by link) are collected, screened by cheap rules, and the suspicious ones are **put on trial** by three Meta Muse agents:

1. **The Prosecutor** looks for conditions that tailor the tender to one supplier and quotes the notice verbatim for every count.
2. **The Defense** gives the buyer's most honest legitimate explanation, and concedes when there is none.
3. **The Court** weighs both sides count by count, sets a risk score and level, and names possibly relevant rules (Directive 2014/24/EU, FAR) marked for verification.
4. **The Clerk** drafts a formal request for clarification to the buyer, in the notice's own language, with an English version.

Every quote is checked against the notice text (`VERIFIED` / `APPROXIMATE` / `NOT_FOUND`). A quote the model made up is struck through and given no weight. The output is shown as a certified stenographic transcript: numbered lines, marked exhibits, and a reporter's certificate that records the model, the prompt version, latency and tokens.

## Run it

```bash
# 1. backend (Express, port 4000)
cd backend
cp .env.example .env        # set META_API_KEY; SAM_API_KEY is optional
npm install
npm run dev

# 2. frontend (Next.js 16, port 3000)
cd frontend
npm install
npm run dev
```

Database: with Docker running, `docker compose up -d db` starts PostgreSQL 16 + pgvector and the backend uses `DATABASE_URL`. Without it, the backend falls back to embedded PostgreSQL (PGlite) in `backend/.data/`, so the app still runs with no setup. The full stack runs in Docker with `docker compose --profile full up`.

Tests: `cd backend && npm test` (screening rules, quote verification, TED normalisation, strict schemas, prompt-injection wrapping).

## Features

- **Update** (top bar): fetches about 120 tenders that are not on file yet, newest first, split between TED and USAspending.
- **Add tenders** dialog, three ways:
  - *From official sources*: type how many new tenders to fetch (1 to 2000) and pick the sources.
  - *One tender by link*: paste a link to a single tender on any website. The AI reads the page and the check starts right away. If the page needs a login or JavaScript, paste its text instead.
  - *All tenders from a website*: paste a page that lists tenders (for example a search results page on goszakup.gov.kz or find-tender.service.gov.uk). xscan finds the tenders on it and imports up to 30.
- **Accounts**: sign up with email and password. Browsing is open; checking, adding and saving tenders need an account.
- **Saved tenders**: bookmark any tender and find it under *Saved*.
- **Source on every tender**: each row and case page says where the tender came from (official API or the website it was added from) and links to the original.

## How it works

| Stage | Where | Notes |
|---|---|---|
| Collect | `backend/src/adapters/` | `TedAdapter` (TED Search API v3, anonymous), `SamGovAdapter` (needs `SAM_API_KEY`), `UsaSpendingAdapter` (awards made without full and open competition). All share `BaseProcurementAdapter` and one canonical model; original payloads are kept in `raw`. |
| Import by link | `backend/src/services/web.ts` | Fetches the page server-side with SSRF protection (public addresses only, re-checked on every redirect, 3 MB cap, 20 s timeout), converts it to text (read-only form fields included, which many government portals use), and asks Muse to decide whether it is a tender and extract its facts. The tender text itself is the page's own text, cut to the tender with verbatim anchors, so quote checks still work. Listing pages: Muse picks the tender entries and their links by number from the page's real links, so it cannot invent URLs. |
| JavaScript pages | `backend/src/services/render.ts` | When a page arrives as an empty shell (SAM.gov and most modern portals) or turns plain requests away, it is opened in headless Chrome via puppeteer-core and read once its text stops changing. Every request the browser makes, redirects and page scripts included, passes the same public-address check, so a page cannot use the browser to reach internal addresses (covered by `test/render.test.ts`). Uses the installed Chrome/Chromium, or `CHROME_PATH`; the Docker image installs Chromium. |
| Site connectors | `backend/src/services/connectors.ts` | Portals that render in the browser from a public JSON API (their HTML is an empty shell) are read from that API instead. **zakup.gov.kz**: `/announcement/:id` (announcement, lots, document list) and `/plan-items/:id`; a listing import from any zakup.gov.kz page takes the newest announcements. No AI extraction is needed for these. |
| Accounts | `backend/src/services/auth.ts` | scrypt password hashes, random session tokens stored only as SHA-256 hashes, httpOnly SameSite=Lax cookie. Writes must be JSON from the app's own origin. |
| Screen | `backend/src/services/screen.ts` | 13 rules (deadline vs. directive minimums, brand lock without "or equivalent", turnover > 2x value, local-only eligibility, uncapped penalties, guarantees, amendments, prompt injection…). Noisy-OR score; the scrutiny threshold in the UI re-sorts the docket live. |
| Trial | `backend/src/services/tribunal.ts` | Muse Spark 1.3 on the Meta Model API, JSON-schema structured output, zod validation with a repair retry, bounded retries with backoff. Notice text is wrapped as untrusted data. Stages persist before they stream (SSE), so a page reload resumes a live hearing. |
| Examine | `POST /api/v1/trials/:id/examine` | Ask any party a follow-up. Answers go into the record as Q./A. lines and their quotes are verified too. |

API: `GET /api/v1/tenders`, `GET /api/v1/tenders/:id`, `POST /api/v1/tenders/:id/trials`, `GET /api/v1/trials/:id/events` (SSE), `POST /api/v1/trials/:id/examine`, `POST /api/v1/ingest` (`{ target, sources }`), `GET /api/v1/ingest/events` (SSE), `POST /api/v1/import/one` (`{ url }` or `{ text }`), `POST /api/v1/import/listing` (`{ url, max }`), `POST /api/v1/auth/signup|login|logout`, `GET /api/v1/auth/me`, `PUT|DELETE /api/v1/tenders/:id/save`, `GET /api/v1/me/saved`, `GET /api/v1/sources/status`.

## Honesty notes

- All notices are live public data from TED and USAspending (and SAM.gov once a key is set), or pages users added by link, which are labelled with their website. The synthetic notices in `backend/test/fixtures/` are used only by the tests and are never loaded into the database.
- The tribunal reports indicators for human review. It never calls a tender corrupt.
- Importing by link reads plain HTML pages directly and opens JavaScript pages in headless Chrome. Pages that need a login, or sites that block automated browsers, can't be read; paste the tender text instead.
- There is no embedding model on the Meta Model API yet, so search uses PostgreSQL full-text search; pgvector is provisioned for when one is added.
