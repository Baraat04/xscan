import { EventEmitter } from "node:events";
import { TedAdapter } from "../adapters/ted.js";
import { SamGovAdapter, UsaSpendingAdapter } from "../adapters/us.js";
import type { BaseProcurementAdapter, CanonicalTender } from "../adapters/base.js";
import { sampleTenders } from "../data/samples.js";
import { audit, db, uuid } from "../db/index.js";
import { screenTender } from "./screen.js";

export const adapters: BaseProcurementAdapter[] = [new TedAdapter(), new SamGovAdapter(), new UsaSpendingAdapter()];
export const ingestBus = new EventEmitter();

/** Upsert keyed on (source, source_id). Re-screens on every upsert so rule changes reapply. */
export async function upsertTender(t: CanonicalTender) {
  const screen = screenTender(t);
  const status = screen.verdict === "CLEARED" ? "cleared" : "flagged";
  const existing = await db.one<{ id: string; status: string }>("SELECT id, status FROM tenders WHERE source = $1 AND source_id = $2", [t.source, t.sourceId]);
  const values = [
    t.isSample, t.jurisdiction, t.url, t.title, t.summary, t.language, t.buyerName, t.buyerCountry, t.noticeType, t.procedureType,
    t.cpv, t.naics, t.psc, t.estimatedValue, t.currency, t.publishedAt, t.deadlineAt, JSON.stringify(t.sections), JSON.stringify(t.raw),
    JSON.stringify(screen), screen.score,
  ];
  if (existing) {
    await db.query(
      `UPDATE tenders SET is_sample=$2, jurisdiction=$3, url=$4, title=$5, summary=$6, language=$7, buyer_name=$8, buyer_country=$9,
       notice_type=$10, procedure_type=$11, cpv=$12, naics=$13, psc=$14, estimated_value=$15, currency=$16, published_at=$17,
       deadline_at=$18, sections=$19, raw=$20, screen=$21, screen_score=$22,
       status = CASE WHEN status = 'tried' THEN status ELSE $23 END, updated_at=now() WHERE id=$1`,
      [existing.id, ...values, status],
    );
    return { id: existing.id, inserted: false, status };
  }
  const id = uuid();
  await db.query(
    `INSERT INTO tenders (id, source, source_id, is_sample, jurisdiction, url, title, summary, language, buyer_name, buyer_country,
     notice_type, procedure_type, cpv, naics, psc, estimated_value, currency, published_at, deadline_at, sections, raw, screen, screen_score, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
    [id, t.source, t.sourceId, ...values, status],
  );
  return { id, inserted: true, status };
}

export async function seedSamples() {
  for (const t of sampleTenders()) await upsertTender(t);
}

let running = false;

/** Collect → validate → normalise → upsert → screen, per source. One failing record never stops the run. */
export async function runIngestion(limitPerSource = 30) {
  if (running) return { alreadyRunning: true };
  running = true;
  const results = [];
  try {
    for (const a of adapters) {
      const st = a.status();
      if (!st.enabled) continue;
      const jobId = uuid();
      const job = { id: jobId, source: a.source, fetched: 0, inserted: 0, updated: 0, cleared: 0, flagged: 0, status: "running", error: null as string | null };
      await db.query("INSERT INTO ingestion_jobs (id, source, status) VALUES ($1,$2,'running')", [jobId, a.source]);
      ingestBus.emit("job", job);
      try {
        for await (const raw of a.fetchRecords({ limit: limitPerSource })) {
          job.fetched++;
          let t: CanonicalTender | null = null;
          try {
            t = a.normalize(raw);
          } catch (e) {
            console.warn(`[ingest] ${a.source} normalize failed: ${(e as Error).message}`);
          }
          if (!t) continue;
          const r = await upsertTender(t);
          r.inserted ? job.inserted++ : job.updated++;
          r.status === "cleared" ? job.cleared++ : job.flagged++;
          ingestBus.emit("record", { source: a.source, title: t.title, status: r.status, id: r.id });
        }
        job.status = "complete";
      } catch (e) {
        job.status = "failed";
        job.error = (e as Error).message;
      }
      await db.query(
        "UPDATE ingestion_jobs SET status=$2, fetched=$3, inserted=$4, updated=$5, cleared=$6, flagged=$7, error=$8, finished_at=now() WHERE id=$1",
        [jobId, job.status, job.fetched, job.inserted, job.updated, job.cleared, job.flagged, job.error],
      );
      ingestBus.emit("job", job);
      results.push(job);
    }
    await audit("ingestion.run", "ingestion", null, results);
    return { jobs: results };
  } finally {
    running = false;
  }
}
