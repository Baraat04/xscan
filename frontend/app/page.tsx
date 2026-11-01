"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RiskBoxes, SourceTag } from "@/components/Bits";
import { classify, useStore } from "@/components/Store";
import { api } from "@/lib/api";
import type { TenderSummary, Trial } from "@/lib/types";

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "")}…` : s);
const RULING_WORD = { SUSTAINED: "sustained", DISMISSED: "dismissed", REFER_FOR_CLARIFICATION: "ask the buyer" } as const;
const STANCE_WORD = { contest: "Contests", partially_concede: "Concedes in part", concede: "Concedes" } as const;
const NOT_HEARD = "Not heard yet";
const DECK_SIZE = 12;
const DECK_MS = 8000;

/**
 * The counts the three plies carry. The canary copy shows the count the court sustained (the prosecution's strongest),
 * the original shows a quote the court could verify, and the pink copy shows the defense answering that same quote.
 */
function plies(trial: Trial) {
  const charges = trial.prosecution!.charges;
  const rulings = trial.verdict!.rulings;
  const ruling = (id: string) => rulings.find((r) => r.charge_id === id);
  const lead = charges.find((c) => ruling(c.id)?.ruling === "SUSTAINED") ?? charges[0];
  const exhibit =
    charges.find((c) => c.quote && c.quote_check.status !== "NOT_FOUND" && ruling(c.id)?.ruling !== "DISMISSED" && c.id !== lead.id) ??
    charges.find((c) => c.quote && c.quote_check.status !== "NOT_FOUND") ??
    lead;
  const missing = charges.find((c) => c.quote && c.quote_check.status === "NOT_FOUND");
  const answer = trial.defense?.rebuttals.find((r) => r.charge_id === exhibit.id) ?? trial.defense?.rebuttals[0];
  const quoted = charges.filter((c) => c.quote);
  const found = quoted.filter((c) => c.quote_check.status !== "NOT_FOUND").length;
  const ruled = [lead, exhibit].filter((c, i, a) => a.indexOf(c) === i).map((c) => `${c.id} ${RULING_WORD[ruling(c.id)?.ruling ?? "REFER_FOR_CLARIFICATION"]}`);
  return { lead, exhibit, missing, answer, found, quoted: quoted.length, ruled: ruled.join(" · "), n: (c: typeof lead) => charges.indexOf(c) + 1 };
}

/** The hearing as the fanfold printer logged it, one line per filing. */
function hearingLines(trial: Trial) {
  const lines: { ch: "p" | "d" | "c"; who: string; text: string }[] = [];
  for (const c of trial.prosecution?.charges ?? []) lines.push({ ch: "p", who: "PROS", text: `${c.id} ${c.title}` });
  for (const r of trial.defense?.rebuttals ?? []) lines.push({ ch: "d", who: "DEF", text: `${r.charge_id} ${STANCE_WORD[r.stance].toLowerCase()}` });
  for (const r of trial.verdict?.rulings ?? []) lines.push({ ch: "c", who: "COURT", text: `${r.charge_id} ${RULING_WORD[r.ruling]}` });
  if (trial.verdict) lines.push({ ch: "c", who: "COURT", text: `risk ${trial.verdict.risk_level} ${trial.verdict.risk_score.toFixed(2)}` });
  return lines;
}

/** Types a line once, the way the court's typewriter fills the ruling field. */
function useTyped(text: string) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!text) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setN(text.length);
    setN(0);
    let i = 0;
    const t = setInterval(() => { i += 1; setN(i); if (i >= text.length) clearInterval(t); }, 42);
    return () => clearInterval(t);
  }, [text]);
  return { shown: text.slice(0, n), done: n >= text.length };
}

export default function OverviewPage() {
  const { tenders, threshold, requireUser, setAddOpen } = useStore();
  const [trials, setTrials] = useState<Record<string, Trial>>({});
  const [caseId, setCaseId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [fanned, setFanned] = useState(false);

  const groups = useMemo(() => {
    const all = tenders ?? [];
    const by = (k: ReturnType<typeof classify>) => all.filter((t) => classify(t, threshold) === k);
    return { all, cleared: by("cleared"), waiting: by("referred"), ruled: by("ruled") };
  }, [tenders, threshold]);

  // The deck deals real tenders in turn: the highest-risk rulings, then what the screening flagged, then the rest.
  const ruledByRisk = useMemo(() => [...groups.ruled].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0)), [groups.ruled]);
  const deck = useMemo(() => {
    const flagged = [...groups.waiting].sort((a, b) => (b.screen_score ?? 0) - (a.screen_score ?? 0));
    return [...ruledByRisk.slice(0, DECK_SIZE / 2), ...flagged.slice(0, DECK_SIZE / 2), ...flagged.slice(DECK_SIZE / 2), ...groups.cleared].slice(0, DECK_SIZE);
  }, [ruledByRisk, groups.waiting, groups.cleared]);
  const at = Math.max(0, deck.findIndex((x) => x.id === caseId));
  const t: TenderSummary | undefined = deck[at];
  const next = useCallback(() => setCaseId((id) => {
    const i = deck.findIndex((x) => x.id === id);
    return deck[(Math.max(0, i) + 1) % deck.length]?.id ?? null;
  }), [deck]);

  useEffect(() => {
    if (deck.length < 2 || paused || fanned || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = setInterval(() => { if (!document.hidden) next(); }, DECK_MS);
    return () => clearInterval(timer);
  }, [deck.length, paused, fanned, next]);

  const trialId = t?.trial_status === "complete" ? t.trial_id : null;
  useEffect(() => {
    if (!trialId) return;
    let alive = true;
    api.trial(trialId).then((r) => alive && setTrials((all) => ({ ...all, [trialId]: r.trial }))).catch(() => {});
    return () => { alive = false; };
  }, [trialId]);

  const loaded = trialId ? trials[trialId] : undefined;
  const trial = loaded?.verdict && loaded.prosecution?.charges.length ? loaded : undefined;
  const v = trial?.verdict;
  const p = trial ? plies(trial) : null;
  // Until the court hears a tender, the forms carry what the free screening found and nothing more.
  const signals = [...(t?.screen?.signals ?? [])].sort((a, b) => b.weight - a.weight);
  const top = signals[0];
  const caseNo = t ? (t.source === "WEB" ? `WEB ${t.source_id.slice(0, 10)}` : `${t.source === "USASPENDING" ? "USA" : t.source} ${t.source_id}`) : "—";
  const typed = useTyped(p?.ruled ?? (t ? NOT_HEARD : ""));
  const log = trial ? hearingLines(trial) : [];

  const funnel = [
    { label: "On file", n: groups.all.length, href: "/docket", tone: "all" },
    { label: "Look normal", n: groups.cleared.length, href: "/docket?status=cleared", tone: "off" },
    { label: "To check", n: groups.waiting.length, href: "/docket?status=referred", tone: "p" },
    { label: "Ruled by the court", n: groups.ruled.length, href: "/docket?status=ruled", tone: "c" },
  ];
  const max = Math.max(1, groups.all.length);
  // Per-source counts for the sources strip, from the tenders on file.
  const bySource = (s: string) => groups.all.filter((x) => x.source === s).length;
  const byHost = (h: string) => groups.all.filter((x) => x.source === "WEB" && (x.url ?? "").includes(h)).length;

  return (
    <div className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Every tender, filed in <em>triplicate</em></h1>
          <p className="hero-lede">One copy goes to the prosecutor, one to the defense, and the original stays with the court. Every quote they use is checked against the notice.</p>
          <div className="hero-actions">
            <Link className="btn btn-primary btn-lg" href={ruledByRisk[0] ? `/court?case=${ruledByRisk[0].id}` : "/court"}>Watch the live court</Link>
            <button className="btn btn-lg" onClick={() => requireUser(() => setAddOpen(true))}>Add a tender</button>
          </div>
          <ul className="ply-key" aria-label="Which copy is whose">
            <li><i className="k-c" aria-hidden />Original: the court</li>
            <li><i className="k-p" aria-hidden />Canary copy: the prosecution</li>
            <li><i className="k-d" aria-hidden />Pink copy: the defense</li>
          </ul>
          <p className="hero-keys">{tenders ? <b>{groups.all.length.toLocaleString("en-GB")}</b> : "…"} real tenders on file, from official APIs and the websites people add.</p>
        </div>

        <div
          className="triplicate-wrap"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onTouchStart={() => setPaused(true)}
        >
          {/* Clicking the stack fans it; the button below does the same from the keyboard. */}
          <div className={`triplicate${fanned ? " fan" : ""}`} onClick={(e) => !(e.target as HTMLElement).closest("a") && setFanned((f) => !f)}>
            <div className="ply ply-d" aria-hidden={!fanned}>
              <div className="f-head"><span>Form XS-3 · Copy 3</span><span>{caseNo}</span></div>
              <div className="ply-body" key={t?.id}>
                <div className="f-row"><span className="f-label">Count</span><span className="f-val carbon">{p ? `${p.exhibit.id} · ${p.exhibit.title}` : top ? top.category : "—"}</span></div>
                <div className="f-row"><span className="f-label">Defense answer</span><span className="f-val carbon"><span className="clamp">{p?.answer ? p.answer.explanation : "Gives the most honest good reason the buyer could have."}</span></span></div>
                <div className="f-row"><span className="f-label">Position</span><span className="f-val carbon">{p?.answer ? STANCE_WORD[p.answer.stance] : t ? NOT_HEARD : "—"}</span></div>
              </div>
              <span className="f-copy">Copy 3 · Defense</span>
            </div>
            <div className="ply ply-p" aria-hidden={!fanned}>
              <div className="f-head"><span>Form XS-3 · Copy 2</span><span>{caseNo}</span></div>
              <div className="ply-body" key={t?.id}>
                <div className="f-row"><span className="f-label">Count</span><span className="f-val carbon">{p ? `${p.lead.id} · ${p.lead.title}` : top ? top.category : "—"}</span></div>
                <div className="f-row"><span className="f-label">Argument</span><span className="f-val carbon"><span className="clamp">{p ? p.lead.argument : top ? top.note : "Finds conditions that fit only one supplier, and quotes the notice for each."}</span></span></div>
                <div className="f-row"><span className="f-label">Severity</span><span className="f-val carbon">{p ? p.lead.severity[0].toUpperCase() + p.lead.severity.slice(1) : t ? NOT_HEARD : "—"}</span></div>
              </div>
              <span className="f-copy">Copy 2 · Prosecution</span>
            </div>
            <div className="ply ply-c">
              <div className="f-head"><span>Form XS-3 · Original</span><span>{caseNo}</span></div>
              <div className="ply-body" key={t?.id}>
                <div className="f-row"><span className="f-label">Buyer</span><span className="f-val">{t ? clip(t.buyer_name ?? "Not published", 70) : "—"}</span></div>
                <div className="f-row"><span className="f-label">Subject</span><span className="f-val" lang={t?.language ?? undefined}><span className="clamp">{t ? t.title : "Waiting for the first tender"}</span></span></div>
                <div className="f-row">
                  <span className="f-label">Exhibit</span>
                  <span className="f-val" lang={t?.language ?? undefined}>
                    {p?.exhibit.quote
                      ? <><span className="sticker p inline">P-{p.n(p.exhibit)}</span>“{clip(p.exhibit.quote, 120)}”</>
                      : top?.excerpt ? <>“{clip(top.excerpt, 120)}”</> : top ? clip(top.note, 120) : "—"}
                  </span>
                </div>
                <div className="f-row">
                  <span className="f-label">Not in notice</span>
                  {p?.missing
                    ? <span className="f-val ghost" lang={t?.language ?? undefined}>“{clip(p.missing.quote, 60)}” · no weight</span>
                    : <span className="f-val">{p ? `None · ${p.found} of ${p.quoted} quotes found in the notice` : t ? NOT_HEARD : "—"}</span>}
                </div>
                <div className="f-row"><span className="f-label">Ruling</span><span className="f-val typing">{t ? <>{typed.shown}{!typed.done && <span className="caret" />}</> : "—"}</span></div>
                <div className="f-row">
                  <span className="f-label">Risk</span>
                  {v
                    ? <RiskBoxes level={v.risk_level} score={v.risk_score} typed />
                    : <span className="f-val">{t?.screen ? `Screening ${t.screen.score.toFixed(2)} · ${signals.length} ${signals.length === 1 ? "signal" : "signals"}` : "Awaiting the court"}</span>}
                </div>
                {trial?.letter && t && (
                  <Link className="tear" href={`/case/${t.id}`}>
                    <small>Tear off here · letter to the buyer ({trial.letter.language.toUpperCase()})</small>
                    <p lang={trial.letter.language}>{trial.letter.subject}</p>
                  </Link>
                )}
              </div>
            </div>
          </div>
          <div className="deck-bar">
            {t && <span className="deck-count" aria-live="off">Case {at + 1} of {deck.length}</span>}
            {deck.length > 1 && <button type="button" className="fan-toggle" onClick={next}>Next case</button>}
            {t && <Link className="fan-toggle" href={`/case/${t.id}`}>Open this case</Link>}
            <button type="button" className="fan-toggle fan-only" onClick={() => setFanned((f) => !f)} aria-pressed={fanned}>{fanned ? "Stack the copies" : "Fan out the copies"}</button>
          </div>
          {log.length > 0 && (
            <div className="fanfold-slip" aria-label="Hearing log">
              <ol className="fanfold">
                {log.map((l, i) => <li key={i} className={l.ch}>{String(i + 1).padStart(3, "0")} {l.who.padEnd(5, " ")} {l.text}</li>)}
              </ol>
            </div>
          )}
        </div>
      </section>

      <section className="band channels">
        <div className="band-head">
          <h2>Three copies. One record.</h2>
          <p>Each party works on its own copy, with one job and one rule it cannot break. They file in this order, every time.</p>
        </div>
        <ol className="lanes">
          {[
            { ply: "p", copy: "Copy 2", name: "The prosecutor", job: "Finds conditions that fit only one supplier.", rule: "Must quote the notice word for word for every count." },
            { ply: "d", copy: "Copy 3", name: "The defense", job: "Answers each count for the buyer.", rule: "Gives the most honest good reason, and concedes when there is none." },
            { ply: "c", copy: "Original", name: "The court", job: "Weighs both copies and rules count by count.", rule: "Gives no weight to a quote that is not really in the notice." },
          ].map((a) => (
            <li key={a.ply} className={`lane ply-${a.ply}`}>
              <div className="f-head"><span>Form XS-3</span><span>{a.copy}</span></div>
              <h3>{a.name}</h3>
              <p>{a.job}</p>
              <p className="lane-rule"><b className="f-label">Rule</b>{a.rule}</p>
            </li>
          ))}
        </ol>
        <Link className="band-link" href="/court">Watch them argue a real tender</Link>
      </section>

      <section className="band funnel-band">
        <div className="band-head">
          <h2>Cheap first. The court only when it matters.</h2>
          <p>Free rules screen every tender. Only the ones with warning signs are worth an AI hearing.</p>
        </div>
        <div className="intake">
          <div className="f-head" style={{ marginTop: 14 }}><span>Intake register</span><span>Tenders on file</span></div>
          <ul className="funnel" aria-label="Tenders by stage">
            {funnel.map((f) => (
              <li key={f.label}>
                <Link href={f.href} className={`funnel-row tone-${f.tone}`}>
                  <span className="funnel-label">{f.label}</span>
                  <span className="funnel-bar"><i style={{ width: `${Math.max(1.5, (f.n / max) * 100)}%` }} /></span>
                  <b>{tenders ? f.n.toLocaleString("en-GB") : "…"}</b>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="band verdicts-band">
        <div className="band-head">
          <h2>Latest rulings</h2>
          <p>Real tenders, real rulings. Open any one to read the full argument.</p>
        </div>
        {tenders && groups.ruled.length === 0 && <p className="list-empty">No tender has been checked yet. The first one you check appears here.</p>}
        {groups.ruled.length > 0 && (
          <ul className="verdict-list ledger">
            {groups.ruled.slice(0, 6).map((x) => (
              <li key={x.id}>
                <Link href={`/case/${x.id}`} className="verdict-row">
                  <span className="mark-typed court"><i aria-hidden>X</i>{x.risk_level}</span>
                  <span className="verdict-main">
                    <b lang={x.language ?? undefined}>{x.title}</b>
                    <small>{x.buyer_name ?? "Buyer not published"}</small>
                  </span>
                  <SourceTag t={x} />
                  <span className="verdict-score">{x.risk_score?.toFixed(2)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="band sources-band">
        <ul className="source-strip" aria-label="Where the tenders come from">
          {[
            { name: "TED", n: bySource("TED"), kind: "EU, official API" },
            { name: "USAspending", n: bySource("USASPENDING"), kind: "US, official API" },
            { name: "SAM.gov", n: bySource("SAM_GOV") + byHost("sam.gov"), kind: "US, by link" },
            { name: "zakup.gov.kz", n: byHost("zakup.gov.kz"), kind: "Kazakhstan, public API" },
            { name: "Other websites", n: bySource("WEB") - byHost("sam.gov") - byHost("zakup.gov.kz"), kind: "by link, read by AI", web: true },
          ].map((s) => (
            <li key={s.name} className={s.web ? "web" : undefined}><b>{s.name}</b><span>{tenders ? s.n.toLocaleString("en-GB") : "…"}</span><small>{s.kind}</small></li>
          ))}
        </ul>
        <Link className="band-link" href="/how">How sources are read</Link>
      </section>

      <section className="close">
        <h2>Open a case.</h2>
        <p>Paste a link from any procurement site, or pick one the screening already flagged.</p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => requireUser(() => setAddOpen(true))}>Add a tender</button>
          <Link className="btn btn-lg" href="/docket?status=referred">See what to check</Link>
        </div>
        <p className="close-fine">xscan points out warning signs for a person to review. It never says anyone is guilty.</p>
      </section>
    </div>
  );
}
