"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Gavel } from "@/components/Icons";
import { Record } from "@/components/Record";
import { classify, useStore } from "@/components/Store";
import { api } from "@/lib/api";
import { humanCategory, sourceLabel } from "@/lib/format";
import type { Block } from "@/lib/transcript";
import type { TenderSummary, Trial } from "@/lib/types";

const STEPS = [
  { who: "THE CLERK", what: "screens every notice", how: "Free rules catch short deadlines, brand names without “or equivalent”, outsized turnover demands and local-only eligibility. Plain notices are cleared." },
  { who: "THE PROSECUTOR", what: "brings the counts", how: "Reads a referred notice for conditions that fit one supplier, and must quote the notice word for word for each count." },
  { who: "THE DEFENSE", what: "answers for the buyer", how: "Gives the most honest legitimate reason a buyer could have, and concedes when there is none." },
  { who: "THE COURT", what: "rules count by count", how: "Weighs both sides, gives no weight to any quote missing from the notice, and sets a risk level." },
  { who: "THE CLERK", what: "writes to the buyer", how: "Drafts a request for clarification in the notice’s own language, ready to copy." },
];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);

/** A short page lifted from the latest ruling: one count, argued and decided. */
function excerpt(trial: Trial, tender: TenderSummary): Block[] {
  const v = trial.verdict!;
  const charges = trial.prosecution!.charges;
  const ruling = v.rulings.find((r) => r.ruling === "SUSTAINED") ?? v.rulings[0];
  const c = charges.find((x) => x.id === ruling.charge_id) ?? charges[0];
  const n = charges.indexOf(c) + 1;
  const reb = trial.defense?.rebuttals.find((r) => r.charge_id === c.id);
  const word = { SUSTAINED: "SUSTAINED", DISMISSED: "DISMISSED", REFER_FOR_CLARIFICATION: "REFERRED TO THE BUYER" }[ruling.ruling];
  const b: Block[] = [
    { kind: "center", text: `${sourceLabel(tender.source)} ${tender.source_id}`, tone: "muted" },
    { kind: "center", text: `COUNT ${n} — ${c.title.toUpperCase()}` },
    { kind: "blank" },
    { kind: "speech", speaker: "THE PROSECUTOR", runs: [{ text: clip(c.argument, 150) }] },
  ];
  if (c.quote) {
    b.push({ kind: "paren", exhibit: { id: `P-${n}`, side: "p", quote: c.quote, status: c.quote_check.status, sectionKey: c.quote_check.sectionKey, start: c.quote_check.start, end: c.quote_check.end },
      runs: [{ text: `(Exhibit P-${n}: ` }, { text: `"${clip(c.quote, 90)}"`, tone: "quote" }, { text: ")" }] });
  }
  if (reb) b.push({ kind: "blank" }, { kind: "speech", speaker: "THE DEFENSE", runs: [{ text: clip(reb.explanation, 140) }] });
  b.push({ kind: "blank" }, { kind: "speech", speaker: "THE COURT", runs: [{ text: `Count ${n} is ` }, { text: word, tone: "pencil" }, { text: `. ${clip(ruling.reasoning, 110)}` }] });
  return b;
}

export default function OverviewPage() {
  const { tenders, threshold, error } = useStore();
  const router = useRouter();
  const [latest, setLatest] = useState<{ tender: TenderSummary; trial: Trial } | null>(null);

  const groups = useMemo(() => {
    const all = tenders ?? [];
    const by = (k: ReturnType<typeof classify>) => all.filter((t) => classify(t, threshold) === k);
    return {
      all,
      cleared: by("cleared"),
      waiting: by("referred").sort((a, b) => (b.screen_score ?? 0) - (a.screen_score ?? 0)),
      running: by("running"),
      ruled: by("ruled"),
    };
  }, [tenders, threshold]);

  // Latest completed hearing feeds the excerpt. Its id is stable, so this refetches only when a new ruling lands.
  const latestRuled = groups.ruled[0];
  useEffect(() => {
    if (!latestRuled?.trial_id) return;
    let alive = true;
    api.trial(latestRuled.trial_id).then((r) => alive && r.trial.verdict && r.trial.prosecution && setLatest({ tender: latestRuled, trial: r.trial })).catch(() => {});
    return () => {
      alive = false;
    };
  }, [latestRuled?.trial_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const samples = groups.all.filter((t) => t.is_sample).sort((a, b) => (b.screen_score ?? 0) - (a.screen_score ?? 0));
  const fresh = samples.find((t) => !t.trial_id);
  const demo = fresh ?? samples[0];
  const demoHref = demo ? `/case/${demo.id}${fresh ? "?call=1" : ""}` : "/docket";
  const total = groups.all.length || 1;
  const share = (n: number) => `${(n / total) * 100}%`;

  const ledger = [
    { label: "Collected from the sources", n: groups.all.length, href: "/docket" },
    { label: `Cleared at screening (below ${threshold.toFixed(2)})`, n: groups.cleared.length, href: "/docket?status=cleared", tone: "off" },
    { label: "Referred to the tribunal", n: groups.waiting.length + groups.running.length, href: "/docket?status=referred" },
    { label: "Ruled on", n: groups.ruled.length, href: "/docket?status=ruled", tone: "court" },
  ];

  const excerptBlocks = useMemo(() => (latest ? excerpt(latest.trial, latest.tender) : null), [latest]);

  return (
    <div className="page">
      <section className="ov-hero">
        <div className="ov-intro">
          <p className="ov-court">XSCAN TENDER TRIBUNAL · EU AND US PUBLIC PROCUREMENT</p>
          <h1>Public tenders, put on trial.</h1>
          <p className="ov-lede">
            xscan reads new tenders from TED, SAM.gov and USAspending and clears the ordinary ones on its own. The suspicious ones are argued by a prosecutor, a defense and a court. Every quote is checked against the notice, and every case ends with a question you can send to the buyer.
          </p>
          <div className="ov-actions">
            <Link className="btn btn-ink btn-lg" href={demoHref}><Gavel /> {fresh ? "Watch a sample hearing" : "Open a sample case"}</Link>
            <Link className="btn btn-paper btn-lg" href="/docket?status=referred">See what awaits a hearing</Link>
          </div>
          <p className="ov-fine">{fresh ? "Starts a live hearing on a synthetic notice. It takes about a minute." : "Sample notices are synthetic and their buyers fictional."}</p>

          <div className="ledger" aria-label="The record so far">
            <h2>THE RECORD SO FAR</h2>
            <ul>
              {ledger.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className={l.tone ? `tone-${l.tone}` : undefined}>
                    <span>{l.label}</span>
                    <i aria-hidden />
                    <b>{tenders ? l.n : "…"}</b>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flowbar" aria-hidden>
              <span className="seg-off" style={{ width: share(groups.cleared.length) }} />
              <span className="seg-ref" style={{ width: share(groups.waiting.length + groups.running.length) }} />
              <span className="seg-court" style={{ width: share(groups.ruled.length) }} />
            </div>
            <p className="flowbar-key"><i className="seg-off" /> cleared <i className="seg-ref" /> referred <i className="seg-court" /> ruled</p>
            {error && <p className="error-line" role="alert">{error}</p>}
          </div>
        </div>

        <div className="ov-excerpt">
          {excerptBlocks && latest ? (
            <>
              <Record blocks={excerptBlocks} animate follow={false} pending={null} pendingSince={null} onExhibit={() => router.push(`/case/${latest.tender.id}`)} />
              <div className="ov-excerpt-foot">
                <span className="stamp-mini court">{latest.trial.verdict!.risk_level} · {latest.trial.verdict!.risk_score.toFixed(2)}</span>
                <Link href={`/case/${latest.tender.id}`}>Read the full record</Link>
              </div>
            </>
          ) : (
            <article className="sheet ov-excerpt-empty">
              <p>No ruling has been entered yet.</p>
              <p>Call a case and its record will appear here as the court’s latest page.</p>
              <Link className="btn btn-ink" href={demoHref}><Gavel /> Watch a sample hearing</Link>
            </article>
          )}
        </div>
      </section>

      <section className="ov-lists">
        <article className="sheet list-sheet">
          <header>
            <h2>AWAITING A HEARING</h2>
            <Link href="/docket?status=referred">All {groups.waiting.length}</Link>
          </header>
          {!tenders && <p className="list-empty">Reading the docket…</p>}
          {tenders && groups.waiting.length === 0 && <p className="list-empty">Nothing awaits a hearing at this threshold.</p>}
          <ol>
            {groups.waiting.slice(0, 6).map((t) => (
              <li key={t.id} className="case-row">
                <div className="case-row-main">
                  <span className="case-no">{t.source_id}{t.is_sample && <span className="sample">SAMPLE</span>}</span>
                  <Link href={`/case/${t.id}`} className="case-title">{t.title}</Link>
                  <span className="case-meta">{sourceLabel(t.source)} · {t.buyer_name ?? "Buyer not published"}</span>
                  {t.screen?.signals[0] && <span className="case-why">Flagged for: {[...new Set(t.screen.signals.map((s) => humanCategory(s.category).toLowerCase()))].slice(0, 2).join(", ")}</span>}
                </div>
                <div className="case-row-side">
                  <span className="score-chip" title="Screening score">{(t.screen_score ?? 0).toFixed(2)}</span>
                  <Link className="btn btn-ghost btn-sm" href={`/case/${t.id}?call=1`}><Gavel /> Call</Link>
                </div>
              </li>
            ))}
          </ol>
        </article>

        <article className="sheet list-sheet">
          <header>
            <h2>RULINGS ENTERED</h2>
            <Link href="/docket?status=ruled">All {groups.ruled.length}</Link>
          </header>
          {tenders && groups.ruled.length === 0 && <p className="list-empty">No rulings yet. The first hearing you call will be entered here.</p>}
          <ol>
            {groups.ruled.slice(0, 6).map((t) => (
              <li key={t.id} className="case-row">
                <div className="case-row-main">
                  <span className="case-no">{t.source_id}{t.is_sample && <span className="sample">SAMPLE</span>}</span>
                  <Link href={`/case/${t.id}`} className="case-title">{t.title}</Link>
                  <span className="case-meta">{sourceLabel(t.source)} · {t.buyer_name ?? "Buyer not published"}</span>
                </div>
                <div className="case-row-side">
                  <span className="stamp-mini court">{t.risk_level}</span>
                  <span className="score-chip">{t.risk_score?.toFixed(2)}</span>
                </div>
              </li>
            ))}
          </ol>
        </article>
      </section>

      <section className="ov-steps" aria-labelledby="how">
        <h2 id="how">HOW A HEARING RUNS</h2>
        <ol>
          {STEPS.map((s, i) => (
            <li key={i}>
              <span className="step-n">{i + 1}</span>
              <b>{s.who}</b>
              <em>{s.what}</em>
              <p>{s.how}</p>
            </li>
          ))}
        </ol>
        <p className="ov-fine">The tribunal identifies indicators for human review. It never finds a buyer guilty of anything.</p>
      </section>
    </div>
  );
}
