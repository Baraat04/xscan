"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { daysUntil, money, sourceLabel } from "@/lib/format";
import type { Source } from "@/lib/types";
import { classify, useStore } from "./Store";
import { Search } from "./Icons";

type Status = "all" | "referred" | "ruled" | "cleared";
type Sort = "score" | "newest" | "deadline" | "value";
const STATUSES: { id: Status; label: string }[] = [
  { id: "all", label: "All" }, { id: "referred", label: "Referred" }, { id: "ruled", label: "Ruled" }, { id: "cleared", label: "Cleared" },
];

export function DocketView() {
  const { tenders, error, threshold, setThreshold } = useStore();
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const status = (STATUSES.find((s) => s.id === params.get("status"))?.id ?? "all") as Status;
  const source = (params.get("source") ?? "") as Source | "";
  const region = params.get("region") ?? "";
  const sort = (params.get("sort") ?? "score") as Sort;
  const [q, setQ] = useState(params.get("q") ?? "");

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${path}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  const counts = useMemo(() => {
    const c: Record<Status, number> = { all: 0, referred: 0, ruled: 0, cleared: 0 };
    for (const t of tenders ?? []) {
      if (source && t.source !== source) continue;
      if (region && t.jurisdiction !== region) continue;
      const k = classify(t, threshold);
      c.all++;
      c[k === "running" ? "referred" : k]++;
    }
    return c;
  }, [tenders, threshold, source, region]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (tenders ?? []).filter((t) => {
      const k = classify(t, threshold);
      if (status === "referred" && k !== "referred" && k !== "running") return false;
      if (status === "ruled" && k !== "ruled") return false;
      if (status === "cleared" && k !== "cleared") return false;
      if (source && t.source !== source) return false;
      if (region && t.jurisdiction !== region) return false;
      return !needle || `${t.title} ${t.buyer_name} ${t.source_id}`.toLowerCase().includes(needle);
    });
    const time = (s: string | null, missing: number) => (s ? Date.parse(s) : missing);
    return list.sort((a, b) => {
      if (sort === "newest") return time(b.published_at, 0) - time(a.published_at, 0);
      if (sort === "deadline") return time(a.deadline_at, Infinity) - time(b.deadline_at, Infinity);
      if (sort === "value") return Number(b.estimated_value ?? -1) - Number(a.estimated_value ?? -1);
      return (b.risk_score ?? b.screen_score ?? 0) - (a.risk_score ?? a.screen_score ?? 0);
    });
  }, [tenders, threshold, status, source, region, sort, q]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Docket</h1>
          <p>Every notice on file. Screening sorts them; you decide which to put on trial.</p>
        </div>
        <div className="threshold">
          <div className="threshold-row">
            <label htmlFor="thr">Scrutiny threshold</label>
            <b>{threshold.toFixed(2)}</b>
          </div>
          <input id="thr" type="range" min={0.1} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          <small>Notices scoring below it at screening are cleared. Lower it to refer more.</small>
        </div>
      </header>

      <article className="sheet docket-sheet">
        <div className="filters">
          <label className="search">
            <Search />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onBlur={() => set("q", q.trim())}
              placeholder="Search title, buyer or notice number"
              aria-label="Search the docket"
            />
          </label>
          <div className="seg status-seg" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s.id} aria-pressed={status === s.id} onClick={() => set("status", s.id === "all" ? "" : s.id)}>
                {s.label} <em>{tenders ? counts[s.id] : "…"}</em>
              </button>
            ))}
          </div>
          <div className="selects">
            <label>
              <span>Source</span>
              <select value={source} onChange={(e) => set("source", e.target.value)}>
                <option value="">All sources</option>
                <option value="TED">TED (EU)</option>
                <option value="SAM_GOV">SAM.gov (US)</option>
                <option value="USASPENDING">USAspending (US)</option>
              </select>
            </label>
            <label>
              <span>Region</span>
              <select value={region} onChange={(e) => set("region", e.target.value)}>
                <option value="">EU and US</option>
                <option value="EU">European Union</option>
                <option value="US">United States</option>
              </select>
            </label>
            <label>
              <span>Sort</span>
              <select value={sort} onChange={(e) => set("sort", e.target.value === "score" ? "" : e.target.value)}>
                <option value="score">Highest risk first</option>
                <option value="newest">Newest first</option>
                <option value="deadline">Deadline soonest</option>
                <option value="value">Largest value</option>
              </select>
            </label>
          </div>
        </div>

        <div className="dk-table" role="table" aria-label="Notices">
          <div className="dk-row dk-headrow" role="row">
            <span role="columnheader">Notice</span>
            <span role="columnheader">Value</span>
            <span role="columnheader">Deadline</span>
            <span role="columnheader" title="Screening score, or the court's risk score once ruled">Score</span>
            <span role="columnheader">Status</span>
          </div>
          {error && <p className="list-empty">{error}</p>}
          {!tenders && !error && Array.from({ length: 6 }, (_, i) => <div key={i} className="dk-skel" />)}
          {tenders && rows.length === 0 && (
            <p className="list-empty">
              {q ? `No notice matches “${q}”.` : status === "ruled" ? "No case has been ruled on yet. Open a referred notice and call the case." : "Nothing matches these filters. Lower the scrutiny threshold or clear a filter."}
            </p>
          )}
          {rows.map((t) => {
            const k = classify(t, threshold);
            const d = daysUntil(t.deadline_at);
            return (
              <Link key={t.id} href={`/case/${t.id}`} className={`dk-row ${k}`} role="row">
                <span className="dk-notice" role="cell">
                  <span className="case-no">{t.source_id}{t.is_sample && <span className="sample">SAMPLE</span>}</span>
                  <span className="case-title" lang={t.language ?? undefined}>{t.title}</span>
                  <span className="case-meta">{sourceLabel(t.source)} · {t.buyer_name ?? "Buyer not published"}</span>
                </span>
                <span className="dk-num" role="cell" data-label="Value">{money(t.estimated_value, t.currency)}</span>
                <span className="dk-num" role="cell" data-label="Deadline">
                  {t.notice_type === "award" ? "Awarded" : d === null ? "Not published" : d < 0 ? "Closed" : d === 1 ? "1 day" : `${d} days`}
                </span>
                <span className="dk-num dk-score" role="cell" data-label="Score">{(t.risk_score ?? t.screen_score ?? 0).toFixed(2)}</span>
                <span role="cell" className="dk-status">
                  {k === "ruled" && <span className="stamp-mini court">{t.risk_level}</span>}
                  {k === "running" && <span className="stamp-mini live">IN SESSION</span>}
                  {k === "referred" && <span className="stamp-mini ref">REFERRED</span>}
                  {k === "cleared" && <span className="stamp-mini off">CLEARED</span>}
                </span>
              </Link>
            );
          })}
        </div>
        {tenders && rows.length > 0 && <p className="dk-foot">Showing {rows.length} of {tenders.length} notices.</p>}
      </article>
    </div>
  );
}
