import { EventEmitter } from "node:events";
import { TedAdapter } from "../adapters/ted.js";
import { SamGovAdapter, UsaSpendingAdapter } from "../adapters/us.js";
import type { BaseProcurementAdapter, CanonicalTender, Source } from "../adapters/base.js";
import { audit, db, uuid } from "../db/index.js";
import { screenTender } from "./screen.js";

export const adapters: BaseProcurementAdapter[] = [new TedAdapter(), new SamGovAdapter(), new UsaSpendingAdapter()];
export const ingestBus = new EventEmitter();
ingestBus.setMaxListeners(200);

/** Upsert keyed on (source, source_id). Re-screens on every upsert so rule changes reapply. */
export async function upsertTender(t: CanonicalTender, importedBy: string | null = null) {
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
     notice_type, procedure_type, cpv, naics, psc, estimated_value, currency, published_at, deadline_at, sections, raw, screen, screen_score, status, imported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [id, t.source, t.sourceId, ...values, status, importedBy],
  );
  return { id, inserted: true, status };
}

/** Only live source data belongs in the database. Removes any synthetic notices an older build seeded. */
export async function purgeSamples() {
  const { rows } = await db.query("DELETE FROM tenders WHERE is_sample RETURNING id");
  if (rows.length) await audit("tenders.purge_samples", "tender", null, { removed: rows.length });
  return rows.length;
}

let running = false;
export const isIngesting = () => running;

export interface IngestOptions {
  /** How many new tenders to collect in total, split evenly across the chosen sources. */
  target?: number;
  sources?: Source[];
  userId?: string | null;
}

/**
 * Collect → validate → normalise → upsert → screen, per source. Sources are read newest-first and each one
 * stops as soon as it has delivered its share of new tenders, or after scanning a bounded number of records.
 * A source that runs dry passes its unused share on to the next. One failing record never stops the run.
 */
export async function runIngestion({ target = 120, sources, userId = null }: IngestOptions = {}) {
  if (running) return { alreadyRunning: true };
  running = true;
  const runId = uuid();
  const chosen = adapters.filter((a) => a.status().enabled && (!sources || sources.includes(a.source)));
  const results = [];
  let remaining = target;
  ingestBus.emit("run", { id: runId, status: "running", target, inserted: 0, sources: chosen.map((a) => a.source) });
  try {
    for (const [i, a] of chosen.entries()) {
      const share = Math.ceil(remaining / (chosen.length - i));
      if (share <= 0) break;
      const jobId = uuid();
      const job = { id: jobId, runId, source: a.source, target: share, fetched: 0, inserted: 0, updated: 0, cleared: 0, flagged: 0, status: "running", error: null as string | null };
      await db.query("INSERT INTO ingestion_jobs (id, source, status, target, user_id) VALUES ($1,$2,'running',$3,$4)", [jobId, a.source, share, userId]);
      ingestBus.emit("job", job);
      try {
        // Most records near the top are already on file after earlier runs, so scan well past the share.
        // Known records cost one lookup each (TED skips even their download), so the bound can be generous.
        const known = async (sourceId: string) => Boolean(await db.one("SELECT 1 FROM tenders WHERE source = $1 AND source_id = $2", [a.source, sourceId]));
        for await (const raw of a.fetchRecords({ limit: share * 6 + 1500, isKnown: known })) {
          job.fetched++;
          if (job.fetched % 25 === 0) ingestBus.emit("job", job);
          // Already on file: skip with one lookup instead of re-saving, so later updates reach new records fast.
          if (await known(a.getSourceIdentifier(raw))) {
            job.updated++;
            continue;
          }
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
          if (r.inserted) ingestBus.emit("record", { runId, source: a.source, title: t.title, status: r.status, id: r.id });
          if (job.inserted >= share) break;
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
      remaining -= job.inserted;
    }
    const inserted = results.reduce((n, j) => n + j.inserted, 0);
    await audit("ingestion.run", "ingestion", runId, { target, userId, jobs: results });
    ingestBus.emit("run", { id: runId, status: "complete", target, inserted, jobs: results });
    return { runId, inserted, jobs: results };
  } catch (e) {
    ingestBus.emit("run", { id: runId, status: "failed", target, error: (e as Error).message });
    throw e;
  } finally {
    running = false;
  }
}
