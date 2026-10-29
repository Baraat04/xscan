"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API, api, ApiError } from "@/lib/api";
import { humanCategory, origin } from "@/lib/format";
import type { QuoteStatus, Trial } from "@/lib/types";
import { RiskBoxes, SourceTag } from "./Bits";
import { Tug } from "./Gauges";
import { classify, useStore } from "./Store";
import { Traces, type Channel } from "./Traces";

type AgentState = "idle" | "thinking" | "speaking" | "done";
type Mode = "replay" | "live";
interface Segment { text: string; extra?: ReactNode; chargeId?: string }
interface LogLine { at: number; ch: Channel | "sys"; text: string }

const AGENTS: { ch: Channel; name: string; role: string }[] = [
  { ch: "p", name: "Prosecutor", role: "Finds conditions that fit one supplier" },
  { ch: "c", name: "Court", role: "Weighs both sides and rules" },
  { ch: "d", name: "Defense", role: "Speaks for the buyer" },
];
const ORDER: Channel[] = ["p", "d", "c"];
const STAGE_TO_CH: Record<string, Channel> = { prosecution: "p", defense: "d", verdict: "c" };
const RULING = { SUSTAINED: "Sustained", DISMISSED: "Dismissed", REFER_FOR_CLARIFICATION: "Ask the buyer" } as const;
const STANCE = { contest: "Contests", partially_concede: "Concedes in part", concede: "Concedes" } as const;
const SPEEDS = [1, 3, 8] as const;

function QuoteChip({ quote, status, exhibit }: { quote: string; status: QuoteStatus; exhibit: string }) {
  const nf = status === "NOT_FOUND";
  return (
    <span className={`quote-chip${nf ? " nf" : ""}`}>
      <span className="q-mark"><span className={`sticker ${exhibit[0] === "D" ? "d" : "p"} inline${nf ? " nf" : ""}`}>{exhibit}</span>{nf ? "Not in the notice · no weight" : status === "APPROXIMATE" ? "Close match in the notice" : "Found in the notice"}</span>
      <q>{quote.length > 180 ? `${quote.slice(0, 180)}…` : quote}</q>
    </span>
  );
}

/** What each agent says, as typed segments, derived from whatever part of the trial exists so far. */
function scripts(trial: Trial | null): Record<Channel, Segment[]> {
  const out: Record<Channel, Segment[]> = { p: [], d: [], c: [] };
  const charges = trial?.prosecution?.charges ?? [];
  const num = (id: string) => charges.findIndex((c) => c.id === id) + 1;
  if (trial?.prosecution) {
    out.p.push({ text: trial.prosecution.opening });
    charges.forEach((c, i) => out.p.push({
      text: `Count ${i + 1} · ${c.title}. ${c.argument}`,
      chargeId: c.id,
      extra: (
        <>
          <span className="chip-mark">{humanCategory(c.category)} · {c.severity}</span>
          {c.quote && <QuoteChip quote={c.quote} status={c.quote_check.status} exhibit={`P-${i + 1}`} />}
        </>
      ),
    }));
    if (trial.prosecution.injection_detected) out.p.push({ text: "The notice contains instructions aimed at automated reviewers. They were entered as evidence, not obeyed." });
  }
  if (trial?.defense) {
    out.d.push({ text: trial.defense.opening });
    trial.defense.rebuttals.forEach((r) => out.d.push({
      text: `Count ${num(r.charge_id)} · ${STANCE[r.stance]}. ${r.explanation}`,
      extra: r.counter_quote && r.quote_check ? <QuoteChip quote={r.counter_quote} status={r.quote_check.status} exhibit={`D-${num(r.charge_id)}`} /> : undefined,
    }));
  }
  if (trial?.verdict) {
    const v = trial.verdict;
    v.rulings.forEach((r) => out.c.push({
      text: `Count ${num(r.charge_id)} · ${RULING[r.ruling]}. ${r.reasoning}`,
      chargeId: r.ruling === "DISMISSED" ? r.charge_id : undefined,
      extra: <Tug pros={r.prosecution_strength} def={r.defense_strength} />,
    }));
    out.c.push({ text: v.summary });
  }
  return out;
}

const total = (segs: Segment[]) => segs.reduce((n, s) => n + s.text.length, 0);

export function Courtroom() {
  const params = useSearchParams();
  const router = useRouter();
  const { tenders, threshold, requireUser, refresh } = useStore();
  const caseId = params.get("case");

  const [trial, setTrial] = useState<Trial | null>(null);
  const [mode, setMode] = useState<Mode>("replay");
  const [state, setState] = useState<Record<Channel, AgentState>>({ p: "idle", d: "idle", c: "idle" });
  const [since, setSince] = useState<Record<Channel, number>>({ p: 0, d: 0, c: 0 });
  const [shown, setShown] = useState<Record<Channel, number>>({ p: 0, d: 0, c: 0 });
  const [log, setLog] = useState<LogLine[]>([]);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const t0 = useRef(Date.now());
  const es = useRef<EventSource | null>(null);
  const logBox = useRef<HTMLDivElement>(null);

  const ruled = useMemo(() => (tenders ?? []).filter((t) => classify(t, threshold) === "ruled"), [tenders, threshold]);
  const waiting = useMemo(() => (tenders ?? []).filter((t) => classify(t, threshold) === "referred").slice(0, 40), [tenders, threshold]);
  const current = useMemo(() => (tenders ?? []).find((t) => t.id === caseId) ?? null, [tenders, caseId]);
  const segs = useMemo(() => scripts(trial), [trial]);

  const say = useCallback((ch: LogLine["ch"], text: string) => setLog((l) => [...l, { at: Date.now() - t0.current, ch, text }]), []);
  const set = (ch: Channel, s: AgentState) => {
    setState((x) => ({ ...x, [ch]: s }));
    if (s === "thinking") setSince((x) => ({ ...x, [ch]: Date.now() }));
  };

  const reset = useCallback(() => {
    es.current?.close();
    t0.current = Date.now();
    setState({ p: "idle", d: "idle", c: "idle" });
    setShown({ p: 0, d: 0, c: 0 });
    setLog([]);
    setError(null);
  }, []);

  // Default case: the strongest ruling on file, so the page is never empty on arrival.
  useEffect(() => {
    if (!caseId && ruled[0]) router.replace(`/court?case=${ruled[0].id}`, { scroll: false });
  }, [caseId, ruled, router]);

  // Load the chosen case: a complete trial replays, anything else waits for a live hearing.
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    reset();
    setTrial(null);
    (async () => {
      try {
        const r = await api.tender(caseId);
        if (!alive) return;
        const last = r.trials.find((t) => t.status === "complete");
        if (last) {
          const t = await api.trial(last.id);
          if (!alive) return;
          setMode("replay");
          setTrial(t.trial);
          say("sys", `case loaded · ${r.tender.source} ${r.tender.source === "WEB" ? origin(r.tender).site : r.tender.source_id}`);
          say("sys", `replaying the recorded hearing · ${t.trial.model} · prompt ${t.trial.prompt_version}`);
          set("p", "thinking");
        } else {
          setMode("live");
          say("sys", `case loaded · no hearing yet · screening ${(r.tender.screen_score ?? 0).toFixed(2)}`);
        }
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? e.message : "Could not load this case.");
      }
    })();
    return () => { alive = false; };
  }, [caseId, reset, say]);

  useEffect(() => () => es.current?.close(), []);

  // One clock drives typing, the thinking timers and the replay hand-offs.
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      setShown((cur) => {
        const next = { ...cur };
        for (const ch of ORDER) if (state[ch] === "speaking") next[ch] = Math.min(total(segs[ch]), cur[ch] + 9 * speed);
        return next;
      });
    }, 30);
    return () => clearInterval(tick);
  }, [state, segs, speed]);

  // Finished typing: the agent is done; in a replay the next one starts thinking.
  useEffect(() => {
    for (const [i, ch] of ORDER.entries()) {
      if (state[ch] === "speaking" && total(segs[ch]) > 0 && shown[ch] >= total(segs[ch])) {
        set(ch, "done");
        if (ch === "p") say("p", `${trial?.prosecution?.charges.length ?? 0} counts brought · ${trial?.prosecution?.charges.filter((c) => c.quote_check.status !== "NOT_FOUND").length ?? 0} quotes verified`);
        if (ch === "d") say("d", `${trial?.defense?.rebuttals.filter((r) => r.stance !== "contest").length ?? 0} of ${trial?.defense?.rebuttals.length ?? 0} counts conceded`);
        if (ch === "c" && trial?.verdict) say("c", `ruling entered · ${trial.verdict.risk_level} ${trial.verdict.risk_score.toFixed(2)}`);
        if (mode === "replay" && ORDER[i + 1]) set(ORDER[i + 1], "thinking");
      }
    }
  }, [shown, state, segs, mode, trial, say]);

  // Replay: thinking lasts a beat, then the recorded output is spoken.
  useEffect(() => {
    if (mode !== "replay" || !trial) return;
    const ch = ORDER.find((c) => state[c] === "thinking");
    if (!ch) return;
    const t = setTimeout(() => {
      set(ch, "speaking");
      say(ch, ch === "p" ? "prosecution filed" : ch === "d" ? "defense filed" : "court is ruling");
    }, 1400 / speed);
    return () => clearTimeout(t);
  }, [state, mode, trial, speed, say]);

  const startLive = () => requireUser(async () => {
    if (!caseId) return;
    setStarting(true);
    reset();
    try {
      const { trialId } = await api.startTrial(caseId);
      setMode("live");
      setTrial({ id: trialId, tender_id: caseId, status: "running", model: "", prompt_version: "", prosecution: null, defense: null, verdict: null, letter: null, risk_level: null, risk_score: null, metrics: {}, error: null, started_at: new Date().toISOString(), finished_at: null });
      say("sys", `hearing opened · trial ${trialId.slice(0, 8)}`);
      const src = new EventSource(`${API}/trials/${trialId}/events`);
      es.current = src;
      src.addEventListener("stage", (e) => {
        const d = JSON.parse((e as MessageEvent).data);
        const ch = STAGE_TO_CH[d.stage];
        if (ch) {
          set(ch, "thinking");
          say(ch, `${d.stage} started · waiting for Muse`);
        } else if (d.stage === "letter") say("sys", "clerk is drafting the letter");
      });
      const land = (k: "prosecution" | "defense" | "verdict", ch: Channel) => (e: Event) => {
        const data = JSON.parse((e as MessageEvent).data);
        setTrial((t) => (t ? { ...t, [k]: data, ...(k === "verdict" ? { risk_level: data.risk_level, risk_score: data.risk_score } : {}) } : t));
        set(ch, "speaking");
        say(ch, `${k} received`);
      };
      src.addEventListener("prosecution", land("prosecution", "p"));
      src.addEventListener("defense", land("defense", "d"));
      src.addEventListener("verdict", land("verdict", "c"));
      src.addEventListener("letter", (e) => {
        const data = JSON.parse((e as MessageEvent).data);
        setTrial((t) => (t ? { ...t, letter: data } : t));
        say("sys", `letter drafted · ${String(data.language).toUpperCase()}`);
      });
      src.addEventListener("done", () => {
        src.close();
        say("sys", "hearing closed");
        void refresh();
      });
      src.addEventListener("failed", (e) => {
        src.close();
        const m = JSON.parse((e as MessageEvent).data).message ?? "The hearing could not be completed.";
        setError(m);
        say("sys", `failed · ${m}`);
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The hearing could not start.");
    } finally {
      setStarting(false);
    }
  });

  const replay = () => {
    if (!trial) return;
    reset();
    setMode("replay");
    say("sys", "replaying the recorded hearing");
    set("p", "thinking");
  };

  // Keep the newest log line in view by scrolling the log itself, never the page.
  useEffect(() => {
    const box = logBox.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [log.length]);

  const levels: Record<Channel, number> = {
    p: state.p === "speaking" ? 1 : state.p === "thinking" ? 0.35 : 0.04,
    d: state.d === "speaking" ? 1 : state.d === "thinking" ? 0.35 : 0.04,
    c: state.c === "speaking" ? 1 : state.c === "thinking" ? 0.35 : 0.04,
  };
  const v = trial?.verdict;
  const ruledDone = state.c === "done" && v;
  const charges = trial?.prosecution?.charges ?? [];
  const tally = v ? (["SUSTAINED", "DISMISSED", "REFER_FOR_CLARIFICATION"] as const).map((k) => [k, v.rulings.filter((r) => r.ruling === k).length] as const) : [];
  const dismissed = new Set(v?.rulings.filter((r) => r.ruling === "DISMISSED").map((r) => r.charge_id) ?? []);
  const quotesOk = charges.filter((c) => c.quote && c.quote_check.status !== "NOT_FOUND").length;
  const busy = ORDER.some((c) => state[c] === "thinking" || state[c] === "speaking");

  return (
    <div className="page court-page">
      <header className="court-head">
        <div>
          <h1>Live court</h1>
          <p>Pick a tender and watch the prosecutor, the defense and the court argue it. Recorded hearings replay; new ones run live on Meta Muse.</p>
        </div>
        <label className="case-picker">
          <span>Case</span>
          <select value={caseId ?? ""} onChange={(e) => router.replace(`/court?case=${e.target.value}`, { scroll: false })}>
            {!caseId && <option value="">Choose a tender</option>}
            {ruled.length > 0 && (
              <optgroup label="Recorded hearings (replay)">
                {ruled.map((t) => <option key={t.id} value={t.id}>{t.risk_level} · {t.title.slice(0, 70)}</option>)}
              </optgroup>
            )}
            {waiting.length > 0 && (
              <optgroup label="Warning signs, no hearing yet (live)">
                {waiting.map((t) => <option key={t.id} value={t.id}>{(t.screen_score ?? 0).toFixed(2)} · {t.title.slice(0, 70)}</option>)}
              </optgroup>
            )}
          </select>
        </label>
      </header>

      {current && (
        <div className="court-case">
          <SourceTag t={current} link />
          <Link href={`/case/${current.id}`} className="court-case-title" lang={current.language ?? undefined}>{current.title}</Link>
          <span className="court-case-buyer">{current.buyer_name ?? "Buyer not published"}</span>
        </div>
      )}

      <div className="scoreboard" aria-live="polite">
        <div className="sb-cell"><span>Counts</span><b>{charges.length || "—"}</b></div>
        {tally.map(([k, n]) => <div key={k} className={`sb-cell ${k === "SUSTAINED" ? "hot" : k === "DISMISSED" ? "cold" : "warm"}`}><span>{RULING[k]}</span><b>{ruledDone ? n : "–"}</b></div>)}
        <div className="sb-cell ok"><span>Quotes verified</span><b>{charges.length ? `${quotesOk}/${charges.filter((c) => c.quote).length}` : "—"}</b></div>
        <div className="sb-actions">
          {mode === "replay" && trial && <button className="btn btn-quiet" onClick={replay} disabled={busy}>Replay</button>}
          {mode === "replay" && <div className="speed" role="group" aria-label="Replay speed">{SPEEDS.map((s) => <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>)}</div>}
          {(mode === "live" && !trial) || (mode === "replay" && trial && !busy) ? (
            <button className="btn btn-primary" onClick={startLive} disabled={starting || busy}>{starting ? "Opening…" : trial ? "Rehear live" : "Start the hearing"}</button>
          ) : null}
        </div>
      </div>

      <div className="court-traces"><Traces levels={levels} height={54} /></div>

      {error && <p className="error-line" role="alert">{error}</p>}

      <div className="arena">
        {AGENTS.map((a) => {
          const st = state[a.ch];
          let left = shown[a.ch];
          return (
            <section key={a.ch} className={`agent ch-${a.ch} is-${st}`} aria-label={a.name} aria-busy={st === "thinking" || st === "speaking"}>
              <header className="agent-head">
                <span className="agent-name"><b>{a.name}</b><small>{a.role}</small></span>
                <span className="agent-state">
                  {st === "idle" && "Waiting"}
                  {st === "thinking" && <>Thinking <time>{Math.max(0, (now - since[a.ch]) / 1000).toFixed(1)}s</time></>}
                  {st === "speaking" && <><i className="live-dot" /> Speaking</>}
                  {st === "done" && <>Done</>}
                </span>
              </header>
              <div className="agent-body">
                {st === "idle" && <p className="agent-idle">{a.ch === "p" ? "Opens the case." : a.ch === "d" ? "Answers after the prosecutor." : "Rules after both sides have spoken."}</p>}
                {st === "thinking" && <div className="thinking" aria-label="Thinking"><i /><i /><i /></div>}
                {segs[a.ch].map((s, i) => {
                  if (left <= 0) return null;
                  const visible = s.text.slice(0, left);
                  const complete = left >= s.text.length;
                  left -= s.text.length;
                  // Once the court rules, a dismissed count is struck in the prosecutor's pane and marked in the court's.
                  const struck = Boolean(ruledDone && s.chargeId && dismissed.has(s.chargeId));
                  return (
                    <div key={i} className={`speech${struck ? " is-struck" : ""}`}>
                      <p>{visible}{!complete && <span className="caret" />}</p>
                      {complete && s.extra}
                    </div>
                  );
                })}
                {a.ch === "c" && ruledDone && v && (
                  <div className="verdict-seal">
                    <RiskBoxes level={v.risk_level} score={v.risk_score} review={v.human_review_required} typed />
                    <p>Entered by the court of xscan. Indicators for human review, not a finding of wrongdoing.</p>
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      <div className="recorder">
        <div className="console-log" role="log" aria-label="Hearing log" ref={logBox}>
          <header>hearing.log</header>
          <ol>
            {log.map((l, i) => (
              <li key={i} className={`log-${l.ch}`}>
                <time>{(l.at / 1000).toFixed(2).padStart(6, " ")}s</time>
                <span className="log-ch">{l.ch === "sys" ? "sys" : l.ch === "p" ? "pros" : l.ch === "d" ? "def" : "court"}</span>
                <span>{l.text}</span>
              </li>
            ))}
            {!log.length && <li className="log-sys"><time>  0.00s</time><span className="log-ch">sys</span><span>choose a case to begin</span></li>}
          </ol>
        </div>
      </div>

      {ruledDone && trial?.letter && (
        <div className="court-after">
          <p><b>The clerk drafted a letter to the buyer</b> in {trial.letter.language.toUpperCase()}, asking about the counts that were not dismissed.</p>
          <Link className="btn btn-quiet" href={`/case/${trial.tender_id}`}>Open the full case and letter</Link>
        </div>
      )}
    </div>
  );
}
