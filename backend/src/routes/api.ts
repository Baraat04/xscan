import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { currentUser, requireUser } from "../services/auth.js";
import { adapters, ingestBus, isIngesting, runIngestion } from "../services/ingest.js";
import { ImportError, importListing, importOne } from "../services/web.js";
import { account } from "./account.js";
import { DEFAULT_THRESHOLD, RULES_VERSION } from "../services/screen.js";
import { examine, startTrial, trialBus } from "../services/tribunal.js";

export const api = Router();
api.use(account);

const aiLimiter = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false,
  message: { error: { code: "rate_limited", message: "Too many AI requests. Try again in a minute." } } });

const fail = (res: Response, status: number, code: string, message: string) => res.status(status).json({ error: { code, message } });
const pid = (req: Request<any>) => String(req.params.id);
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

function sse(res: Response) {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  res.write(": open\n\n");
  const ping = setInterval(() => res.write(": ping\n\n"), 15000);
  return {
    send: (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
    close: () => clearInterval(ping),
  };
}

api.get("/health", (_req, res) => res.json({ ok: true, db: db.kind }));

api.get("/sources/status", async (_req, res) => {
  const jobs = await db.query("SELECT DISTINCT ON (source) * FROM ingestion_jobs ORDER BY source, started_at DESC");
  const counts = await db.query("SELECT source, count(*)::int AS n, sum(CASE WHEN is_sample THEN 1 ELSE 0 END)::int AS samples FROM tenders GROUP BY source");
  res.json({
    sources: adapters.map((a) => ({ ...a.status(), lastJob: jobs.rows.find((j) => j.source === a.source) ?? null,
      count: counts.rows.find((c) => c.source === a.source)?.n ?? 0, samples: counts.rows.find((c) => c.source === a.source)?.samples ?? 0 })),
    database: db.kind,
    model: { provider: "Meta Model API", model: config.meta.model, judge: config.meta.judgeModel, configured: Boolean(config.meta.apiKey) },
    screening: { rulesVersion: RULES_VERSION, defaultThreshold: DEFAULT_THRESHOLD },
  });
});

const ListQuery = z.object({
  q: z.string().max(200).optional(),
  source: z.enum(["TED", "SAM_GOV", "USASPENDING", "WEB"]).optional(),
  jurisdiction: z.enum(["EU", "US", "OTHER"]).optional(),
  limit: z.coerce.number().int().min(1).max(3000).default(1500),
});

api.get("/tenders", async (req, res) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "invalid_query", parsed.error.issues[0].message);
  const { q, source, jurisdiction, limit } = parsed.data;
  const where: string[] = [];
  const params: unknown[] = [];
  if (q) { params.push(q); where.push(`(t.search @@ plainto_tsquery('simple', $${params.length}) OR t.title ILIKE '%' || $${params.length} || '%' OR t.buyer_name ILIKE '%' || $${params.length} || '%')`); }
  if (source) { params.push(source); where.push(`t.source = $${params.length}`); }
  if (jurisdiction) { params.push(jurisdiction); where.push(`t.jurisdiction = $${params.length}`); }
  params.push(currentUser(res)?.id ?? null);
  const userParam = params.length;
  params.push(limit);
  const { rows } = await db.query(
    `SELECT t.id, t.source, t.source_id, t.is_sample, t.jurisdiction, t.url, t.title, t.language, t.buyer_name, t.buyer_country,
            t.notice_type, t.procedure_type, t.cpv, t.naics, t.psc, t.estimated_value, t.currency, t.published_at, t.deadline_at,
            t.status, t.screen_score, t.screen, t.ingested_at, (t.imported_by IS NOT NULL) AS imported,
            EXISTS (SELECT 1 FROM saved_tenders s WHERE s.tender_id = t.id AND s.user_id = $${userParam}) AS saved,
            tr.id AS trial_id, tr.status AS trial_status, tr.risk_score, tr.risk_level
       FROM tenders t
       LEFT JOIN LATERAL (SELECT id, status, risk_score, risk_level FROM trials WHERE tender_id = t.id ORDER BY started_at DESC LIMIT 1) tr ON true
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY (tr.risk_score IS NOT NULL) DESC, t.screen_score DESC NULLS LAST, t.published_at DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );
  res.json({ tenders: rows });
});

api.get("/tenders/:id", async (req, res) => {
  if (!isUuid(pid(req))) return fail(res, 404, "not_found", "Tender not found");
  const tender = await db.one("SELECT * FROM tenders WHERE id = $1", [pid(req)]);
  if (!tender) return fail(res, 404, "not_found", "Tender not found");
  delete tender.search;
  const user = currentUser(res);
  tender.saved = user ? Boolean(await db.one("SELECT 1 FROM saved_tenders WHERE user_id = $1 AND tender_id = $2", [user.id, tender.id])) : false;
  const trials = await db.query("SELECT id, status, risk_score, risk_level, started_at, finished_at FROM trials WHERE tender_id = $1 ORDER BY started_at DESC", [pid(req)]);
  const buyer = tender.buyer_name
    ? await db.query(`SELECT t.id, t.title, t.screen_score, t.status, tr.risk_level FROM tenders t
        LEFT JOIN LATERAL (SELECT risk_level FROM trials WHERE tender_id = t.id AND status='complete' ORDER BY started_at DESC LIMIT 1) tr ON true
        WHERE t.buyer_name = $1 AND t.id <> $2 ORDER BY t.published_at DESC LIMIT 6`, [tender.buyer_name, tender.id])
    : { rows: [] };
  res.json({ tender, trials: trials.rows, buyerHistory: buyer.rows });
});

api.post("/tenders/:id/trials", requireUser, aiLimiter, async (req, res) => {
  if (!config.meta.apiKey) return fail(res, 503, "llm_unconfigured", "META_API_KEY is not configured on the server");
  if (!isUuid(pid(req))) return fail(res, 404, "not_found", "Tender not found");
  const running = await db.one("SELECT id FROM trials WHERE tender_id = $1 AND status = 'running' AND started_at > now() - interval '5 minutes'", [pid(req)]);
  if (running) return res.status(202).json({ trialId: running.id, resumed: true });
  const trialId = await startTrial(pid(req), currentUser(res)!.id);
  if (!trialId) return fail(res, 404, "not_found", "Tender not found");
  res.status(202).json({ trialId, resumed: false });
});

api.get("/trials/:id", async (req, res) => {
  if (!isUuid(pid(req))) return fail(res, 404, "not_found", "Trial not found");
  const trial = await db.one("SELECT * FROM trials WHERE id = $1", [pid(req)]);
  if (!trial) return fail(res, 404, "not_found", "Trial not found");
  const exams = await db.query("SELECT * FROM examinations WHERE trial_id = $1 ORDER BY created_at", [pid(req)]);
  res.json({ trial, examinations: exams.rows });
});

/** SSE: replays persisted stages first, then streams live ones. Safe to reconnect. */
api.get("/trials/:id/events", async (req: Request<{ id: string }>, res) => {
  if (!isUuid(pid(req))) return fail(res, 404, "not_found", "Trial not found");
  const trial = await db.one("SELECT * FROM trials WHERE id = $1", [pid(req)]);
  if (!trial) return fail(res, 404, "not_found", "Trial not found");
  const stream = sse(res);
  const sent = new Set<string>();
  const send = (event: string, data: unknown) => {
    if (["prosecution", "defense", "verdict", "letter"].includes(event)) {
      if (sent.has(event)) return;
      sent.add(event);
    }
    stream.send(event, data);
  };
  const listener = ({ event, data }: { event: string; data: unknown }) => send(event, data);
  trialBus.on(pid(req), listener);
  for (const k of ["prosecution", "defense", "verdict", "letter"] as const) if (trial[k]) send(k, trial[k]);
  if (trial.status === "complete") send("done", { metrics: trial.metrics });
  if (trial.status === "failed") send("failed", { message: trial.error });
  req.on("close", () => {
    trialBus.off(pid(req), listener);
    stream.close();
  });
});

const ExamineBody = z.object({ agent: z.enum(["prosecutor", "defense", "court"]), question: z.string().trim().min(3).max(600) });

api.post("/trials/:id/examine", requireUser, aiLimiter, async (req, res) => {
  const body = ExamineBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  if (!isUuid(pid(req))) return fail(res, 404, "not_found", "Trial not found");
  try {
    const out = await examine(pid(req), body.data.agent, body.data.question);
    if (!out) return fail(res, 409, "trial_not_ready", "The trial must be complete before cross-examination");
    res.json(out);
  } catch (e) {
    fail(res, 502, "llm_failed", (e as Error).message);
  }
});

const IngestBody = z.object({
  target: z.coerce.number().int().min(1, "Ask for at least 1 tender.").max(2000, "At most 2000 tenders per update.").default(120),
  sources: z.array(z.enum(["TED", "SAM_GOV", "USASPENDING"])).min(1, "Pick at least one source.").optional(),
});

api.post("/ingest", requireUser, async (req, res) => {
  const body = IngestBody.safeParse(req.body ?? {});
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  if (isIngesting()) return fail(res, 409, "busy", "An update is already running. Wait for it to finish.");
  void runIngestion({ ...body.data, userId: currentUser(res)!.id }).catch((e) => console.error("[ingest]", e));
  res.status(202).json({ started: true, target: body.data.target });
});

const importFail = (res: Response, e: unknown) =>
  e instanceof ImportError ? fail(res, 422, e.code, e.message) : fail(res, 502, "import_failed", `Import failed: ${(e as Error).message}`);

const OneBody = z.object({
  url: z.string().trim().max(2000).optional().transform((v) => v || undefined),
  text: z.string().max(200_000).optional().transform((v) => v?.trim() || undefined),
}).refine((b) => b.url || b.text, "Paste a link or the tender text.");

api.post("/import/one", requireUser, aiLimiter, async (req, res) => {
  if (!config.meta.apiKey) return fail(res, 503, "llm_unconfigured", "META_API_KEY is not configured on the server");
  const body = OneBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  try {
    res.status(201).json(await importOne(body.data, currentUser(res)!.id));
  } catch (e) {
    importFail(res, e);
  }
});

const ListingBody = z.object({
  url: z.string().trim().min(1, "Paste the link to the page with tenders.").max(2000),
  max: z.coerce.number().int().min(1).max(30, "At most 30 tenders per page.").default(10),
});

api.post("/import/listing", requireUser, aiLimiter, async (req, res) => {
  if (!config.meta.apiKey) return fail(res, 503, "llm_unconfigured", "META_API_KEY is not configured on the server");
  const body = ListingBody.safeParse(req.body);
  if (!body.success) return fail(res, 400, "invalid_body", body.error.issues[0].message);
  try {
    res.status(202).json(await importListing(body.data.url, body.data.max, currentUser(res)!.id));
  } catch (e) {
    importFail(res, e);
  }
});

api.get("/ingest/events", (req, res) => {
  const stream = sse(res);
  const onJob = (j: unknown) => stream.send("job", j);
  const onRecord = (r: unknown) => stream.send("record", r);
  const onRun = (r: unknown) => stream.send("run", r);
  ingestBus.on("job", onJob);
  ingestBus.on("record", onRecord);
  ingestBus.on("run", onRun);
  req.on("close", () => {
    ingestBus.off("job", onJob);
    ingestBus.off("record", onRecord);
    ingestBus.off("run", onRun);
    stream.close();
  });
});

api.get("/stats", async (_req, res) => {
  const r = await db.one(`SELECT count(*)::int AS total,
      sum(CASE WHEN status='cleared' THEN 1 ELSE 0 END)::int AS cleared,
      sum(CASE WHEN status='flagged' THEN 1 ELSE 0 END)::int AS flagged,
      sum(CASE WHEN status='tried' THEN 1 ELSE 0 END)::int AS tried FROM tenders`);
  const levels = await db.query(`SELECT risk_level, count(*)::int AS n FROM (SELECT DISTINCT ON (tender_id) risk_level FROM trials WHERE status='complete' ORDER BY tender_id, started_at DESC) x GROUP BY risk_level`);
  res.json({ ...r, verdicts: Object.fromEntries(levels.rows.map((l) => [l.risk_level, l.n])) });
});
