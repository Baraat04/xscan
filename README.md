# xscan — Tender Tribunal

Public tenders from the EU (TED) and the US (SAM.gov, USAspending) are collected, screened by cheap rules, and the suspicious ones are **put on trial** by three Meta Muse agents:

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

## How it works

| Stage | Where | Notes |
|---|---|---|
| Collect | `backend/src/adapters/` | `TedAdapter` (TED Search API v3, anonymous), `SamGovAdapter` (needs `SAM_API_KEY`), `UsaSpendingAdapter` (awards made without full and open competition). All share `BaseProcurementAdapter` and one canonical model; original payloads are kept in `raw`. |
| Screen | `backend/src/services/screen.ts` | 13 rules (deadline vs. directive minimums, brand lock without "or equivalent", turnover > 2x value, local-only eligibility, uncapped penalties, guarantees, amendments, prompt injection…). Noisy-OR score; the scrutiny threshold in the UI re-sorts the docket live. |
| Trial | `backend/src/services/tribunal.ts` | Muse Spark 1.3 on the Meta Model API, JSON-schema structured output, zod validation with a repair retry, bounded retries with backoff. Notice text is wrapped as untrusted data. Stages persist before they stream (SSE), so a page reload resumes a live hearing. |
| Examine | `POST /api/v1/trials/:id/examine` | Ask any party a follow-up. Answers go into the record as Q./A. lines and their quotes are verified too. |

API: `GET /api/v1/tenders`, `GET /api/v1/tenders/:id`, `POST /api/v1/tenders/:id/trials`, `GET /api/v1/trials/:id/events` (SSE), `POST /api/v1/trials/:id/examine`, `POST /api/v1/ingest`, `GET /api/v1/sources/status`.

## Honesty notes

- Sample notices (`SAMPLE-…`) are synthetic, with fictional buyers, and are labelled in the UI. Everything else is live public data.
- The tribunal reports indicators for human review. It never calls a tender corrupt.
- There is no embedding model on the Meta Model API yet, so search uses PostgreSQL full-text search; pgvector is provisioned for when one is added.
