"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API, api, ApiError } from "@/lib/api";
import { date, daysUntil, humanCategory, LANGUAGE, money, origin } from "@/lib/format";
import { buildRecord, PENDING } from "@/lib/record";
import type { ExhibitMark } from "@/lib/transcript";
import type { Charge, Examination, Rebuttal, Ruling, Tender, Trial } from "@/lib/types";
import { Close } from "./Icons";
import { LetterSheet } from "./LetterSheet";
import { Record } from "./Record";
import { classify, useStore } from "./Store";
import { ExaminationForm } from "./ExaminationForm";
import { RiskBoxes, SaveButton, SourceTag } from "./Bits";

type Stage = "prosecution" | "defense" | "verdict" | "letter";
type Tab = "summary" | "transcript" | "notice" | "letter";

const COUNTRY: Record<string, string> = {
  KAZ: "Kazakhstan", GBR: "United Kingdom", RUS: "Russia", UKR: "Ukraine", UZB: "Uzbekistan", KGZ: "Kyrgyzstan", TUR: "Turkey", GEO: "Georgia",
  ARM: "Armenia", AZE: "Azerbaijan", NOR: "Norway", CHE: "Switzerland", CAN: "Canada", AUS: "Australia", IND: "India", BLR: "Belarus",
};
const RULED: Record<Ruling["ruling"], string> = { SUSTAINED: "Sustained", DISMISSED: "Dismissed", REFER_FOR_CLARIFICATION: "Referred to the buyer" };
const STANCE: Record<Rebuttal["stance"], string> = { contest: "Contests", partially_concede: "Concedes in part", concede: "Concedes" };

export function CaseView({ id, autoCall = false }: { id: string; autoCall?: boolean }) {
  const { refresh, threshold, tenders, user, requireUser } = useStore();
  const router = useRouter();
  const [tender, setTender] = useState<Tender | null>(null);
  const [buyerHistory, setBuyerHistory] = useState<{ id: string; title: string; risk_level: string | null }[]>([]);
  const [trial, setTrial] = useState<Trial | null>(null);
  const [exams, setExams] = useState<Examination[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<{ name: Stage; since: number } | null>(null);
  const [animate, setAnimate] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [exhibit, setExhibit] = useState<ExhibitMark | null>(null);
  const [calling, setCalling] = useState(false);
  const [stamped, setStamped] = useState(false);
  const [tab, setTabState] = useState<Tab>("summary");
  // Leaving the transcript ends any typewriter run, so coming back shows the record at once.
  const setTab = useCallback((t: Tab) => {
    if (t !== "transcript") setAnimate(false);
    setTabState(t);
  }, []);
  const [loaded, setLoaded] = useState(false);
  const es = useRef<EventSource | null>(null);
  const autoCalled = useRef(false);

  const listen = useCallback((trialId: string) => {
    es.current?.close();
    const src = new EventSource(`${API}/trials/${trialId}/events`);
    es.current = src;
    const patch = (k: keyof Trial) => (e: Event) => {
      const data = JSON.parse((e as MessageEvent).data);
      setTrial((t) => (t ? { ...t, [k]: data } : t));
    };
    src.addEventListener("stage", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStage({ name: d.stage, since: Date.now() });
    });
    src.addEventListener("prosecution", patch("prosecution"));
    src.addEventListener("defense", patch("defense"));
    src.addEventListener("verdict", (e) => {
      patch("verdict")(e);
      const v = JSON.parse((e as MessageEvent).data);
      setTrial((t) => (t ? { ...t, risk_level: v.risk_level, risk_score: v.risk_score } : t));
      setStamped(true);
    });
    src.addEventListener("letter", patch("letter"));
    src.addEventListener("done", async () => {
      src.close();
      setStage(null);
      const fresh = await api.trial(trialId);
      setTrial(fresh.trial);
      void refresh();
    });
    src.addEventListener("failed", (e) => {
      src.close();
      setStage(null);
      setError(JSON.parse((e as MessageEvent).data).message ?? "The hearing could not be completed.");
      setTrial((t) => (t ? { ...t, status: "failed" } : t));
      void refresh();
    });
  }, [refresh]);

  useEffect(() => {
    let alive = true;
    setTender(null); setTrial(null); setExams([]); setError(null); setStage(null); setExhibit(null); setAnimate(false); setStamped(false); setTab("summary"); setLoaded(false);
    (async () => {
      try {
        const r = await api.tender(id);
        if (!alive) return;
        setTender(r.tender);
        setBuyerHistory(r.buyerHistory);
        const latest = r.trials[0];
        if (latest) {
          const t = await api.trial(latest.id);
          if (!alive) return;
          setTrial(t.trial);
          setExams(t.examinations);
          if (t.trial.status === "running") {
            setAnimate(true);
            setTab("transcript");
            setStage({ name: !t.trial.prosecution ? "prosecution" : !t.trial.defense ? "defense" : !t.trial.verdict ? "verdict" : "letter", since: Date.parse(t.trial.started_at) });
            listen(latest.id);
          }
        }
        setLoaded(true);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not open this case.");
      }
    })();
    return () => {
      alive = false;
      es.current?.close();
    };
  }, [id, listen]);

  const callCase = useCallback(async () => {
    if (!tender) return;
    setCalling(true);
    setError(null);
    try {
      const { trialId } = await api.startTrial(tender.id);
      setTrial({ id: trialId, tender_id: tender.id, status: "running", model: "", prompt_version: "", prosecution: null, defense: null, verdict: null, letter: null, risk_level: null, risk_score: null, metrics: {}, error: null, started_at: new Date().toISOString(), finished_at: null });
      setExams([]);
      setAnimate(true);
      setStamped(false);
      setReplayKey((k) => k + 1);
      setStage({ name: "prosecution", since: Date.now() });
      setTab("transcript");
      listen(trialId);
      void refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The case could not be called.");
    } finally {
      setCalling(false);
    }
  }, [tender, listen, refresh]);

  // "?call=1" from the overview, the list or an import starts the check once, then leaves the URL clean.
  // Signed-out visitors just see the tender; the check button sends them to sign in.
  useEffect(() => {
    if (!autoCall || !loaded || autoCalled.current || user === undefined) return;
    autoCalled.current = true;
    router.replace(`/case/${id}`, { scroll: false });
    if (!trial && user) void callCase();
  }, [autoCall, loaded, trial, callCase, router, id, user]);

  const check = useCallback(() => requireUser(() => void callCase()), [requireUser, callCase]);

  const blocks = useMemo(() => (tender ? buildRecord(tender, trial, exams) : []), [tender, trial, exams]);

  // Neighbours in docket order, so a reviewer can work through cases without going back.
  const neighbours = useMemo(() => {
    const list = (tenders ?? []).filter((t) => classify(t, threshold) !== "cleared")
      .sort((a, b) => (b.risk_score ?? b.screen_score ?? 0) - (a.risk_score ?? a.screen_score ?? 0));
    const i = list.findIndex((t) => t.id === id);
    return i < 0 ? { prev: null, next: list[0] ?? null } : { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
  }, [tenders, threshold, id]);

  const jump = useCallback((anchor: string) => {
    setTab(anchor === "letter" ? "letter" : "transcript");
    setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start", behavior: "smooth" }), 60);
  }, [setTab]);

  if (error && !tender) {
    return (
      <div className="page case-page">
        <article className="sheet case-msg">
          <p className="error-line">{error}</p>
          <Link className="btn btn-paper" href="/docket">Back to tenders</Link>
        </article>
      </div>
    );
  }

  if (!tender) {
    return (
      <div className="page case-page">
        <div className="crumbs"><span className="dk-skel" style={{ width: 160, height: 14 }} /></div>
        <article className="sheet case-head" aria-busy="true"><p className="ch-court">Opening the case file…</p><div className="dk-skel" style={{ height: 28, width: "70%" }} /><div className="dk-skel" style={{ height: 14, width: "40%" }} /></article>
      </div>
    );
  }

  const running = trial?.status === "running";
  const complete = trial?.status === "complete";
  const failed = trial?.status === "failed";
  const days = daysUntil(tender.deadline_at);
  const referred = (tender.screen_score ?? 0) >= threshold;
  const v = trial?.verdict;
  const lang = LANGUAGE[tender.language ?? ""] ?? tender.language ?? "unknown language";
  const from = origin(tender);
  const region = tender.jurisdiction === "EU" ? "European Union" : tender.jurisdiction === "US" ? "United States" : COUNTRY[tender.buyer_country ?? ""] ?? tender.buyer_country ?? "Country not stated";
  // The list's flag moves the moment someone saves, so prefer it over the copy loaded with the page.
  const savedNow = tenders?.find((x) => x.id === tender.id)?.saved ?? tender.saved;

  const caption = (
    <header className="caption">
      <p className="caption-court">XSCAN TENDER TRIBUNAL · {region.toUpperCase()}</p>
      <div className="caption-grid">
        <div className="caption-parties">
          IN THE MATTER OF:
          <h2 lang={tender.language ?? undefined}>{tender.title}</h2>
          issued by {tender.buyer_name ?? "an unnamed buyer"},
          <br />Contracting Authority.
        </div>
        <div className="caption-bracket" aria-hidden>{")\n".repeat(6)}</div>
        <dl className="caption-case">
          <dt>Notice</dt>
          <dd>{tender.source === "WEB" ? from.site : `${from.site} ${tender.source_id}`}</dd>
          <dt>Language</dt>
          <dd>{lang}</dd>
        </dl>
      </div>
      <div style={{ height: 18 }} />
    </header>
  );

  return (
    <div className="page case-page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/docket" className="crumb-back">Tenders</Link>
        <span className="crumb-sep">/</span>
        <span className="crumb-here">{tender.source === "WEB" ? from.site : tender.source_id}</span>
        <span className="crumb-nav">
          {neighbours.prev && <Link href={`/case/${neighbours.prev.id}`} title={neighbours.prev.title}>Previous</Link>}
          {neighbours.next && <Link href={`/case/${neighbours.next.id}`} title={neighbours.next.title}>Next tender</Link>}
        </span>
      </nav>

      <article className="sheet case-head">
        <div className="ch-grid">
          <div className="ch-main">
            <h1 lang={tender.language ?? undefined}>{tender.title}</h1>
            <div className="ch-source">
              <SourceTag t={tender} link />
              <span>{region} · in {lang}</span>
            </div>
            <p className="ch-buyer">
              Issued by <b>{tender.buyer_name ?? "an unnamed buyer"}</b>
              {tender.is_sample && <span className="sample-note">Synthetic sample notice. The buyer is fictional.</span>}
            </p>
            <dl className="ch-facts">
              <div><dt>Value</dt><dd>{money(tender.estimated_value, tender.currency)}</dd></div>
              <div>
                <dt>{tender.notice_type === "award" ? "Awarded" : "Deadline"}</dt>
                <dd>{tender.notice_type === "award" ? date(tender.published_at) : <>{date(tender.deadline_at)}{days !== null && days >= 0 && <small> · {days === 1 ? "1 day" : `${days} days`} left</small>}</>}</dd>
              </div>
              <div>
                <dt>Classification</dt>
                <dd>{tender.cpv?.length ? `CPV ${tender.cpv.slice(0, 2).join(", ")}` : [tender.naics && `NAICS ${tender.naics}`, tender.psc && `PSC ${tender.psc}`].filter(Boolean).join(" · ") || "Not published"}</dd>
              </div>
              <div><dt>Screening</dt><dd>{(tender.screen_score ?? 0).toFixed(2)} <small>· {tender.screen?.signals.length ?? 0} signals</small></dd></div>
            </dl>
          </div>

          <div className="ch-side">
            {v ? (
              <RiskBoxes key={stamped ? "typed" : "still"} level={v.risk_level} score={v.risk_score} review={v.human_review_required} typed={stamped} />
            ) : running ? (
              <span className="state-mark live"><i /> Checking now</span>
            ) : (
              <span className={`state-mark ${referred ? "ref" : "off"}`}>{referred ? "Warning signs found" : "Looks normal"}</span>
            )}
            <div className="ch-actions">
              {!trial && <button className="btn btn-ink btn-lg" onClick={check} disabled={calling}>{calling ? "Starting…" : "Check with AI"}</button>}
              {failed && <button className="btn btn-ink btn-lg" onClick={check} disabled={calling}>Try the check again</button>}
              {complete && (
                <>
                  <button className="btn btn-paper" onClick={() => { setTab("transcript"); setAnimate(true); setStamped(true); setReplayKey((k) => k + 1); }}>Replay</button>
                  <button className="btn btn-ghost" onClick={check} disabled={calling}>Check again</button>
                </>
              )}
              <SaveButton id={tender.id} saved={savedNow} label />
            </div>
            {!trial && <p className="ch-note">{referred ? "A prosecutor, a defense and a court argue it. About a minute." : "Screening found nothing serious. You can still check it."}</p>}
          </div>
        </div>
        {error && <p className="error-line" role="alert" style={{ marginTop: 14 }}>{error}</p>}
        <Stepper tender={tender} trial={trial} stage={stage} onJump={jump} />
      </article>

      <div className="case-tabs" role="tablist" aria-label="Case views">
        {([
          ["summary", "Summary"],
          ["transcript", "Transcript"],
          ["notice", "Notice"],
          ["letter", "Letter"],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} disabled={k === "letter" && !trial?.letter}>
            {label}
            {k === "transcript" && running && <i className="tab-live" aria-label="live" />}
            {k === "letter" && trial?.letter && <em>{LANGUAGE[trial.letter.language] ?? trial.letter.language}</em>}
          </button>
        ))}
      </div>

      <div className="case-body">
        <div className="case-main" role="tabpanel">
          {tab === "summary" && (
            <Summary
              tender={tender} trial={trial} referred={referred} buyerHistory={buyerHistory}
              onCall={check} calling={calling} onExhibit={setExhibit} onJump={jump}
            />
          )}
          {tab === "transcript" && (
            <div className="sheets">
              <Record
                key={`${trial?.id ?? "none"}-${replayKey}`}
                blocks={blocks}
                animate={animate}
                pending={running && stage ? PENDING[stage.name] : null}
                pendingSince={stage?.since ?? null}
                onExhibit={setExhibit}
                firstPageHeader={caption}
              />
              {complete && trial && (
                <article className="sheet" style={{ padding: 0 }} id="examine">
                  <ExaminationForm trialId={trial.id} onAnswer={(e) => { setAnimate(false); setExams((x) => [...x, e]); }} />
                </article>
              )}
              {!trial && (
                <article className="sheet case-msg">
                  <p>The record opens when the case is called. Until then it holds only the clerk’s screening note.</p>
                  <button className="btn btn-ink" onClick={check} disabled={calling}>Check with AI</button>
                </article>
              )}
            </div>
          )}
          {tab === "notice" && <AnnotatedNotice tender={tender} trial={trial} onExhibit={setExhibit} />}
          {tab === "letter" && trial?.letter && <LetterSheet letter={trial.letter} tender={tender} />}
        </div>
        {exhibit && <ExhibitPanel tender={tender} exhibit={exhibit} onClose={() => setExhibit(null)} />}
      </div>
    </div>
  );
}

/* ───────── stepper ───────── */

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}</>;
}

function Stepper({ tender, trial, stage, onJump }: { tender: Tender; trial: Trial | null; stage: { name: Stage; since: number } | null; onJump: (a: string) => void }) {
  const m = trial?.metrics ?? {};
  const secs = (k: string) => (m[k]?.latencyMs ? `${(m[k].latencyMs / 1000).toFixed(0)} s` : null);
  const p = trial?.prosecution;
  const d = trial?.defense;
  const v = trial?.verdict;
  const conceded = d?.rebuttals.filter((r) => r.stance !== "contest").length ?? 0;
  const failedAt: Stage | null = trial?.status === "failed" ? (!p ? "prosecution" : !d ? "defense" : !v ? "verdict" : "letter") : null;

  const steps: { key: string; who: string; label: string; done: boolean; detail: string | null; time: string | null; anchor: string | null }[] = [
    { key: "screen", who: "Clerk", label: "Screening", done: true, detail: `${(tender.screen?.score ?? 0).toFixed(2)} · ${tender.screen?.signals.length ?? 0} signals`, time: null, anchor: null },
    { key: "prosecution", who: "Prosecutor", label: "Charges", done: Boolean(p), detail: p ? `${p.charges.length} counts` : null, time: secs("prosecution"), anchor: "prosecution" },
    { key: "defense", who: "Defense", label: "Response", done: Boolean(d), detail: d ? `${conceded} of ${d.rebuttals.length} conceded` : null, time: secs("defense"), anchor: "defense" },
    { key: "verdict", who: "Court", label: "Ruling", done: Boolean(v), detail: v ? `${v.risk_level} ${v.risk_score.toFixed(2)}` : null, time: secs("verdict"), anchor: "verdict" },
    { key: "letter", who: "Clerk", label: "Letter", done: Boolean(trial?.letter) || (trial?.status === "complete"), detail: trial?.letter ? LANGUAGE[trial.letter.language] ?? trial.letter.language : trial?.status === "complete" ? "Not needed" : null, time: secs("letter"), anchor: trial?.letter ? "letter" : null },
  ];

  return (
    <ol className="stepper" aria-label="Hearing progress">
      {steps.map((s) => {
        const active = stage?.name === s.key && !s.done;
        const failed = failedAt === s.key;
        const state = failed ? "failed" : s.done ? "done" : active ? "active" : "todo";
        const body: ReactNode = (
          <>
            <span className="st-mark" aria-hidden />
            <span className="st-text">
              <b>{s.label}</b>
              <small>
                {state === "active" && stage ? <>The {s.who.toLowerCase()} is working · <Elapsed since={stage.since} /></> :
                  state === "failed" ? "Stopped here" :
                  s.detail ?? (trial ? "Waiting" : "Not called yet")}
                {state === "done" && s.time && <> · {s.time}</>}
              </small>
            </span>
          </>
        );
        return (
          <li key={s.key} className={`st ${state}`} aria-current={active ? "step" : undefined}>
            {s.done && s.anchor ? <button onClick={() => onJump(s.anchor!)} title={`Jump to the ${s.label.toLowerCase()}`}>{body}</button> : <div>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

/* ───────── summary ───────── */

function Summary({ tender, trial, referred, buyerHistory, onCall, calling, onExhibit, onJump }: {
  tender: Tender; trial: Trial | null; referred: boolean; buyerHistory: { id: string; title: string; risk_level: string | null }[];
  onCall: () => void; calling: boolean; onExhibit: (e: ExhibitMark) => void; onJump: (a: string) => void;
}) {
  const v = trial?.verdict;
  const p = trial?.prosecution;

  if (!trial || trial.status === "failed") {
    const s = tender.screen?.signals ?? [];
    return (
      <div className="sum">
        <article className="sheet sum-sheet">
          <h2 className="sum-h">What screening found</h2>
          {s.length === 0 ? (
            <p className="sum-p">No screening rule matched. Nothing in the published text points to a tailored condition.</p>
          ) : (
            <ol className="signals">
              {s.map((x, i) => (
                <li key={i}>
                  <span className="sig-cat">{humanCategory(x.category)}</span>
                  <p>{x.note}</p>
                  {x.excerpt && <q lang={tender.language ?? undefined}>{x.excerpt}</q>}
                </li>
              ))}
            </ol>
          )}
          <p className="sum-fine">Screening is a set of fixed rules ({tender.screen?.rulesVersion ?? "current"}). It can be wrong in both directions; that is what the AI check is for.</p>
        </article>
        <aside className="sheet sum-sheet sum-side">
          <h2 className="sum-h">What the AI check does</h2>
          <ol className="mini-steps">
            <li><b>The prosecutor</b> reads the notice and brings counts, each quoting the notice word for word.</li>
            <li><b>The defense</b> answers each count for the buyer, and concedes when there is no good reason.</li>
            <li><b>The court</b> rules count by count and sets a risk level. The clerk drafts a letter to the buyer.</li>
          </ol>
          <button className="btn btn-ink btn-lg" onClick={onCall} disabled={calling}>{calling ? "Starting…" : "Check with AI"}</button>
          <p className="sum-fine">{referred ? "Screening found warning signs." : "Screening found nothing serious, but you can still check it."} About a minute.</p>
          {buyerHistory.length > 0 && (
            <>
              <h3 className="sum-h3">Other notices from this buyer</h3>
              <ul className="buyer-list">
                {buyerHistory.map((b) => <li key={b.id}><Link href={`/case/${b.id}`}>{b.title}</Link>{b.risk_level && <span className="mark-typed court"><i aria-hidden>X</i>{b.risk_level}</span>}</li>)}
              </ul>
            </>
          )}
        </aside>
      </div>
    );
  }

  if (!v || !p) {
    return (
      <article className="sheet case-msg">
        <p><span className="state-mark live"><i /> In session</span></p>
        <p>The hearing is under way. The summary is written once the court rules; the transcript shows each turn as it is entered.</p>
        <button className="btn btn-paper" onClick={() => onJump("prosecution")}>Follow it in the transcript</button>
      </article>
    );
  }

  const d = trial.defense;
  const exhibits = [...p.charges.filter((c) => c.quote).map((c) => c.quote_check.status), ...(d?.rebuttals ?? []).filter((r) => r.quote_check).map((r) => r.quote_check!.status)];
  const found = exhibits.filter((s) => s !== "NOT_FOUND").length;
  const tally = (Object.keys(RULED) as Ruling["ruling"][]).map((k) => [k, v.rulings.filter((r) => r.ruling === k).length] as const).filter(([, n]) => n);

  return (
    <div className="sum">
      <div className="sum-col">
        <article className="sheet sum-sheet ruling">
          <h2 className="sum-h">The court’s ruling</h2>
          <p className="ruling-text">{v.summary}</p>
          <p className="ruling-tally">
            {p.charges.length} counts: {tally.map(([k, n], i) => <span key={k} className={k === "DISMISSED" ? "t-off" : "t-on"}>{i ? ", " : ""}{n} {RULED[k].toLowerCase()}</span>)}
            <span className="t-sep"> · </span>{found} of {exhibits.length} quotes found in the notice
          </p>
          <div className="recommend">
            <b>Next step</b>
            <p>{v.recommendation}</p>
          </div>
          {p.injection_detected && (
            <p className="inject-note">The notice contains text addressed to automated reviewers. It was entered as evidence and not obeyed.</p>
          )}
        </article>

        <article className="sheet sum-sheet">
          <h2 className="sum-h">Count by count</h2>
          <ol className="counts">
            {p.charges.map((c, i) => (
              <CountRow
                key={c.id} n={i + 1} charge={c}
                rebuttal={d?.rebuttals.find((r) => r.charge_id === c.id)}
                ruling={v.rulings.find((r) => r.charge_id === c.id)}
                onExhibit={onExhibit} onJump={onJump}
              />
            ))}
          </ol>
        </article>
      </div>

      <aside className="sum-col sum-side-col">
        {trial.letter && (
          <article className="sheet sum-sheet letter-cta">
            <h2 className="sum-h">Letter to the buyer</h2>
            <p className="sum-p">A request for clarification is drafted in {LANGUAGE[trial.letter.language] ?? trial.letter.language}{trial.letter.language !== "en" ? ", with an English version" : ""}. It asks the questions that would settle the open counts.</p>
            <button className="btn btn-ink" onClick={() => onJump("letter")}>Read and copy the letter</button>
          </article>
        )}
        {v.applicable_rules.length > 0 && (
          <article className="sheet sum-sheet">
            <h2 className="sum-h">Rules that may apply</h2>
            <ul className="rules">
              {v.applicable_rules.map((r, i) => (
                <li key={i}>
                  <b>{r.rule}</b>
                  <p>{r.relevance}</p>
                  <span className={`verify ${r.verification === "LIKELY_APPLICABLE" ? "likely" : "check"}`}>{r.verification === "LIKELY_APPLICABLE" ? "Likely applicable" : "Needs legal verification"}</span>
                </li>
              ))}
            </ul>
          </article>
        )}
        <article className="sheet sum-sheet">
          <h2 className="sum-h">Ask a question</h2>
          <p className="sum-p">Put a follow-up to the prosecutor, the defense or the court. The answer is entered into the record.</p>
          <button className="btn btn-paper" onClick={() => onJump("examine")}>Examine a party</button>
          <p className="sum-fine cert">
            Recorded by {trial.model} on the Meta Model API, prompt {trial.prompt_version}. Indicators for human review, not a finding of wrongdoing.
          </p>
        </article>
      </aside>
    </div>
  );
}

function CountRow({ n, charge, rebuttal, ruling, onExhibit, onJump }: {
  n: number; charge: Charge; rebuttal?: Rebuttal; ruling?: Ruling; onExhibit: (e: ExhibitMark) => void; onJump: (a: string) => void;
}) {
  const dismissed = ruling?.ruling === "DISMISSED";
  const ex: ExhibitMark | null = charge.quote
    ? { id: `P-${n}`, side: "p", quote: charge.quote, status: charge.quote_check.status, sectionKey: charge.quote_check.sectionKey, start: charge.quote_check.start, end: charge.quote_check.end }
    : null;
  return (
    <li className={`count${dismissed ? " dismissed" : ""}`}>
      <div className="count-head">
        <span className="count-n">Count {n}</span>
        <h3>{charge.title}</h3>
        {ruling && <span className={`count-ruling ${ruling.ruling.toLowerCase()}`}>{RULED[ruling.ruling]}</span>}
      </div>
      <p className="count-cat">{humanCategory(charge.category)} · {charge.severity} severity{ruling && <> · {ruling.evidence_status.toLowerCase().replaceAll("_", " ")}</>}</p>
      {ex && (
        <button className={`count-quote${ex.status === "NOT_FOUND" ? " nf" : ""}`} onClick={() => onExhibit(ex)} title="Show where this is in the notice">
          <span className="sticker p">{ex.id}</span>
          <q>{charge.quote}</q>
          <small>{ex.status === "VERIFIED" ? "Found in the notice" : ex.status === "APPROXIMATE" ? "Close match in the notice" : "Not in the notice, given no weight"}</small>
        </button>
      )}
      {ruling && (
        <div className="weigh" aria-label={`Prosecution ${ruling.prosecution_strength.toFixed(2)}, defense ${ruling.defense_strength.toFixed(2)}`}>
          <span>Prosecution</span><i><b style={{ width: `${ruling.prosecution_strength * 100}%` }} /></i><em>{ruling.prosecution_strength.toFixed(2)}</em>
          <span>Defense</span><i className="def"><b style={{ width: `${ruling.defense_strength * 100}%` }} /></i><em>{ruling.defense_strength.toFixed(2)}</em>
        </div>
      )}
      <details>
        <summary>Read the arguments</summary>
        <dl className="args">
          <dt>Prosecutor</dt><dd>{charge.argument}</dd>
          {rebuttal && <><dt>Defense · {STANCE[rebuttal.stance].toLowerCase()}</dt><dd>{rebuttal.explanation}<small>Would settle it: {rebuttal.would_clear_it}</small></dd></>}
          {ruling && <><dt>Court</dt><dd>{ruling.reasoning}</dd></>}
        </dl>
        <button className="link-btn" onClick={() => onJump(`count-${charge.id}`)}>See it in the transcript</button>
      </details>
    </li>
  );
}

/* ───────── notice, annotated ───────── */

function AnnotatedNotice({ tender, trial, onExhibit }: { tender: Tender; trial: Trial | null; onExhibit: (e: ExhibitMark) => void }) {
  const marks = useMemo(() => {
    const out: ExhibitMark[] = [];
    trial?.prosecution?.charges.forEach((c, i) => {
      if (c.quote && c.quote_check.status !== "NOT_FOUND") out.push({ id: `P-${i + 1}`, side: "p", quote: c.quote, status: c.quote_check.status, sectionKey: c.quote_check.sectionKey, start: c.quote_check.start, end: c.quote_check.end });
    });
    trial?.defense?.rebuttals.forEach((r) => {
      const n = (trial.prosecution?.charges.findIndex((c) => c.id === r.charge_id) ?? 0) + 1;
      if (r.quote_check && r.quote_check.status !== "NOT_FOUND") out.push({ id: `D-${n}`, side: "d", quote: r.counter_quote, status: r.quote_check.status, sectionKey: r.quote_check.sectionKey, start: r.quote_check.start, end: r.quote_check.end });
    });
    return out;
  }, [trial]);

  return (
    <article className="sheet notice-sheet">
      <header className="notice-head">
        <h2 className="sum-h">The notice, as published</h2>
        <p className="sum-p">
          {marks.length ? <>Passages quoted in the hearing are marked: <span className="sticker p inline">P</span> prosecution, <span className="sticker d inline">D</span> defense.</> : "Passages quoted in the hearing will be marked here once the case is heard."}
          {" "}The text stays in its original language.
        </p>
        {tender.url && <a className="btn btn-paper" href={tender.url} target="_blank" rel="noreferrer">Open on {origin(tender).site}</a>}
      </header>
      {tender.sections.map((s) => {
        const here = marks.filter((m) => m.sectionKey === s.key && m.end > m.start).sort((a, b) => a.start - b.start);
        const parts: ReactNode[] = [];
        let at = 0;
        for (const m of here) {
          if (m.start < at) continue; // overlapping quotes: keep the first
          parts.push(s.text.slice(at, m.start));
          parts.push(
            <mark key={m.id} className={m.side}>
              <button className={`sticker ${m.side} inline`} onClick={() => onExhibit(m)} aria-label={`Exhibit ${m.id}`}>{m.id}</button>
              {s.text.slice(m.start, m.end)}
            </mark>,
          );
          at = m.end;
        }
        parts.push(s.text.slice(at));
        return (
          <section key={s.key} className="notice-sec">
            <h4>{s.label}</h4>
            <p lang={tender.language ?? undefined}>{parts}</p>
          </section>
        );
      })}
      {!tender.sections.length && <p className="sum-p">The source published no descriptive text for this notice.</p>}
    </article>
  );
}

/* ───────── exhibit panel ───────── */

function ExhibitPanel({ tender, exhibit: ex, onClose }: { tender: Tender; exhibit: ExhibitMark; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("mark")?.scrollIntoView({ block: "center", behavior: "smooth" });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ex, onClose]);
  return (
    <aside className="panel" aria-label={`Exhibit ${ex.id}`}>
      <div className="panel-head">
        <span className={`sticker ${ex.side}`}>{ex.id}</span>
        <h3>Marked in the notice</h3>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close exhibit"><Close /></button>
      </div>
      <div className={`verif ${ex.status === "NOT_FOUND" ? "nf" : "ok"}`}>
        
        {ex.status === "VERIFIED" && "Quoted text found verbatim in the notice."}
        {ex.status === "APPROXIMATE" && "Close match in the notice; wording differs slightly."}
        {ex.status === "NOT_FOUND" && "This quote does not appear in the notice. The court gave it no weight."}
      </div>
      <div className="panel-body" ref={ref}>
        {tender.sections.map((s) => {
          const hit = ex.sectionKey === s.key && ex.end > ex.start;
          return (
            <section key={s.key} className="notice-sec">
              <h4>{s.label}</h4>
              <p lang={tender.language ?? undefined}>
                {hit ? <>{s.text.slice(0, ex.start)}<mark className={ex.side}>{s.text.slice(ex.start, ex.end)}</mark>{s.text.slice(ex.end)}</> : s.text}
              </p>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
