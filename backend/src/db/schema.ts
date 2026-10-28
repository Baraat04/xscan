// Idempotent schema. Runs on every boot against Postgres or PGlite.
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tenders (
  id              uuid PRIMARY KEY,
  source          text NOT NULL,            -- TED | SAM_GOV | USASPENDING
  source_id       text NOT NULL,            -- publication number / notice id / award id
  is_sample       boolean NOT NULL DEFAULT false,
  jurisdiction    text NOT NULL,            -- EU | US
  url             text,
  title           text NOT NULL,
  summary         text,
  language        text,
  buyer_name      text,
  buyer_country   text,
  notice_type     text,
  procedure_type  text,
  cpv             text[] NOT NULL DEFAULT '{}',
  naics           text,
  psc             text,
  estimated_value numeric,
  currency        text,
  published_at    timestamptz,
  deadline_at     timestamptz,
  sections        jsonb NOT NULL DEFAULT '[]',  -- [{key,label,text}] source text, verbatim
  raw             jsonb,                         -- original payload
  status          text NOT NULL DEFAULT 'new',   -- new | cleared | flagged | tried
  screen          jsonb,
  screen_score    real,
  ingested_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  search          tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(buyer_name,'') || ' ' || coalesce(summary,''))
  ) STORED,
  UNIQUE (source, source_id)
);
CREATE INDEX IF NOT EXISTS tenders_search_idx ON tenders USING gin (search);
CREATE INDEX IF NOT EXISTS tenders_status_idx ON tenders (status, screen_score DESC);

CREATE TABLE IF NOT EXISTS trials (
  id             uuid PRIMARY KEY,
  tender_id      uuid NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  status         text NOT NULL,              -- running | complete | failed
  model          text NOT NULL,
  prompt_version text NOT NULL,
  prosecution    jsonb,
  defense        jsonb,
  verdict        jsonb,
  letter         jsonb,
  risk_score     real,
  risk_level     text,
  metrics        jsonb NOT NULL DEFAULT '{}',
  error          text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz
);
CREATE INDEX IF NOT EXISTS trials_tender_idx ON trials (tender_id, started_at DESC);

CREATE TABLE IF NOT EXISTS examinations (
  id         uuid PRIMARY KEY,
  trial_id   uuid NOT NULL REFERENCES trials(id) ON DELETE CASCADE,
  agent      text NOT NULL,
  question   text NOT NULL,
  answer     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id          uuid PRIMARY KEY,
  source      text NOT NULL,
  status      text NOT NULL,
  fetched     int NOT NULL DEFAULT 0,
  inserted    int NOT NULL DEFAULT 0,
  updated     int NOT NULL DEFAULT 0,
  cleared     int NOT NULL DEFAULT 0,
  flagged     int NOT NULL DEFAULT 0,
  error       text,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS audit_events (
  id        uuid PRIMARY KEY,
  at        timestamptz NOT NULL DEFAULT now(),
  action    text NOT NULL,
  entity    text NOT NULL,
  entity_id text,
  detail    jsonb
);
`;
