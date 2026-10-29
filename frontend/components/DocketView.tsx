"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { daysUntil, money } from "@/lib/format";
import type { Source } from "@/lib/types";
import { SaveButton, SourceTag, StatusMark } from "./Bits";
import { Search } from "./Icons";
import { classify, useStore } from "./Store";

type Status = "all" | "referred" | "ruled" | "cleared";
type Sort = "score" | "newest" | "deadline" | "value";
const STATUSES: { id: Status; label: string; hint: string }[] = [
  { id: "all", label: "All", hint: "Every tender on file" },
  { id: "referred", label: "To check", hint: "Screening found warning signs" },
  { id: "ruled", label: "Checked", hint: "The AI court has given a verdict" },
  { id: "cleared", label: "Looks normal", hint: "Screening found nothing serious" },
];
const PAGE = 60;

export function DocketView({ savedOnly = false }: { savedOnly?: boolean }) {
  const { tenders, error, threshold, setThreshold, user, requireUser, setAddOpen } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const status = (STATUSES.find((s) => s.id === params.get("status"))?.id ?? "all") as Status;
  const source = (params.get("source") ?? "") as Source | "";
  const region = params.get("region") ?? "";
  const sort = (params.get("sort") ?? "score") as Sort;
  const [q, setQ] = useState(params.get("q") ?? "");
  const [shown, setShown] = useState(PAGE);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    setShown(PAGE);
    router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const base = useMemo(() => (tenders ?? []).filter((t) => {
    if (savedOnly && !t.saved) return false;
    if (source && t.source !== source) return false;
    if (region && t.jurisdiction !== region) return false;
    return true;
  }), [tenders, savedOnly, source, region]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { all: 0, referred: 0, ruled: 0, cleared: 0 };
    for (const t of base) {
      const k = classify(t, threshold);
      c.all++;
      c[k === "running" ? "referred" : k]++;
    }
    return c;
  }, [base, threshold]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = base.filter((t) => {
      const k = classify(t, threshold);
      if (status === "referred" && k !== "referred" && k !== "running") return false;
      if (status === "ruled" && k !== "ruled") return false;
      if (status === "cleared" && k !== "cleared") return false;
      return !needle || `${t.title} ${t.buyer_name} ${t.source_id}`.toLowerCase().includes(needle);
    });
    const time = (s: string | null, missing: number) => (s ? Date.parse(s) : missing);
    return list.sort((a, b) => {
      if (sort === "newest") return time(b.published_at, 0) - time(a.published_at, 0);
      if (sort === "deadline") return time(a.deadline_at, Infinity) - time(b.deadline_at, Infinity);
      if (sort === "value") return Number(b.estimated_value ?? -1) - Number(a.estimated_value ?? -1);
      return (b.risk_score ?? b.screen_score ?? 0) - (a.risk_score ?? a.screen_score ?? 0);
    });
  }, [base, threshold, status, sort, q]);

  if (savedOnly && user === null) {
    return (
      <div className="page">
        <article className="sheet case-msg">
          <h1 className="empty-h">Saved tenders</h1>
          <p>Sign in to save tenders and find them here later.</p>
          <Link className="btn btn-ink" href="/login?next=/saved">Sign in</Link>
        </article>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{savedOnly ? "Saved tenders" : "Tenders"}</h1>
          <p>{savedOnly ? "The tenders you saved to follow." : "Every tender on file. Screening sorts them; open one to check it with AI."}</p>
        </div>
        <div className="threshold">
          <div className="threshold-row">
            <label htmlFor="thr">Warning sensitivity</label>
            <b>{threshold.toFixed(2)}</b>
          </div>
          <input id="thr" type="range" min={0.1} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <small>Lower it to mark more tenders “to check”, raise it to see only the strongest warnings.</small>
        </div>
      </header>

      <article className="sheet docket-sheet">
        <div className="filters">
          <label className="search">
            <Search />
            <input value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} onBlur={() => set("q", q.trim())} placeholder="Search by title, buyer or number" aria-label="Search tenders" />
          </label>
          <div className="seg status-seg" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s.id} aria-pressed={status === s.id} onClick={() => set("status", s.id === "all" ? "" : s.id)} title={s.hint}>
                {s.label} <em>{tenders ? counts[s.id] : "…"}</em>
              </button>
            ))}
          </div>
          <div className="selects">
            <label>
              <span>Source</span>
              <select value={source} onChange={(e) => set("source", e.target.value)}>
                <option value="">All sources</option>
                <option value="TED">TED (EU, official)</option>
                <option value="USASPENDING">USAspending (US, official)</option>
                <option value="SAM_GOV">SAM.gov (US, official)</option>
                <option value="WEB">Added by link</option>
              </select>
            </label>
            <label>
              <span>Region</span>
              <select value={region} onChange={(e) => set("region", e.target.value)}>
                <option value="">All regions</option>
                <option value="EU">European Union</option>
                <option value="US">United States</option>
                <option value="OTHER">Other countries</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sort} onChange={(e) => set("sort", e.target.value === "score" ? "" : e.target.value)}>
                <option value="score">Most warnings first</option>
                <option value="newest">Newest first</option>
                <option value="deadline">Deadline soonest</option>
                <option value="value">Largest value</option>
              </select>
            </label>
          </div>
        </div>

        <div className="dk-table" role="table" aria-label="Tenders">
          <div className="dk-row dk-headrow" role="row">
            <span role="columnheader">Tender</span>
            <span role="columnheader">Value</span>
            <span role="columnheader">Deadline</span>
            <span role="columnheader" title="Warning score from screening, or the court's risk score once checked">Score</span>
            <span role="columnheader">Status</span>
            <span role="columnheader"><span className="sr-only">Save</span></span>
          </div>
          {error && <p className="list-empty">{error}</p>}
          {!tenders && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="dk-skel" />)}
          {tenders && rows.length === 0 && (
            <div className="list-empty">
              {savedOnly && !base.length ? (
                <p>Nothing saved yet. Open any tender and press <b>Save</b>, or use the bookmark in the list.</p>
              ) : q ? (
                <p>No tender matches “{q}”.</p>
              ) : source === "WEB" && !base.length ? (
                <>
                  <p>No tenders added by link yet.</p>
                  <button className="btn btn-ink" onClick={() => requireUser(() => setAddOpen(true))}>Add tenders from a website</button>
                </>
              ) : (
                <p>Nothing matches these filters. Clear a filter or change the warning sensitivity.</p>
              )}
            </div>
          )}
          {rows.slice(0, shown).map((t) => {
            const k = classify(t, threshold);
            const d = daysUntil(t.deadline_at);
            return (
              <div key={t.id} className={`dk-row ${k}`} role="row">
                <span className="dk-notice" role="cell">
                  {/* Web imports are keyed by their address, which the source tag already shows. */}
                  {t.source !== "WEB" && <span className="case-no">{t.source_id}</span>}
                  <Link href={`/case/${t.id}`} className="case-title stretch" lang={t.language ?? undefined}>{t.title}</Link>
                  <span className="case-meta">{t.buyer_name ?? "Buyer not published"}</span>
                  <SourceTag t={t} />
                </span>
                <span className="dk-num" role="cell" data-label="Value">{money(t.estimated_value, t.currency)}</span>
                <span className="dk-num" role="cell" data-label="Deadline">
                  {t.notice_type === "award" ? "Awarded" : d === null ? "Not published" : d < 0 ? "Closed" : d === 1 ? "1 day" : `${d} days`}
                </span>
                <span className="dk-num dk-score" role="cell" data-label="Score">{(t.risk_score ?? t.screen_score ?? 0).toFixed(2)}</span>
                <span role="cell" className="dk-status"><StatusMark t={t} kind={k} /></span>
                <span role="cell" className="dk-save"><SaveButton id={t.id} saved={t.saved} /></span>
              </div>
            );
          })}
        </div>
        {tenders && rows.length > 0 && (
          <div className="dk-foot">
            <span>Showing {Math.min(shown, rows.length)} of {rows.length}{rows.length !== (tenders?.length ?? 0) && !savedOnly ? ` (${tenders.length} on file)` : ""}.</span>
            {shown < rows.length && <button className="btn btn-paper" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
          </div>
        )}
      </article>
    </div>
  );
}
