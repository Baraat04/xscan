import { humanCategory } from "./format";
import type { Block, ExhibitMark, Run } from "./transcript";
import type { Examination, Tender, Trial } from "./types";

const STANCE = {
  contest: "the defense contests the count.",
  partially_concede: "the defense concedes in part.",
  concede: "the defense concedes the count.",
} as const;

const RULING_WORD = { SUSTAINED: "SUSTAINED", DISMISSED: "DISMISSED", REFER_FOR_CLARIFICATION: "REFERRED TO THE BUYER FOR CLARIFICATION" } as const;

const STATUS_NOTE = {
  VERIFIED: "Verified against the notice text.",
  APPROXIMATE: "Matches the notice text approximately.",
  NOT_FOUND: "Not found in the notice. Given no evidentiary weight.",
} as const;

const AGENT = { prosecutor: "THE PROSECUTOR", defense: "THE DEFENSE", court: "THE COURT" } as const;

const sec = (ms?: number) => (ms ? `${(ms / 1000).toFixed(1)} s` : "—");

export function buildRecord(tender: Tender, trial: Trial | null, exams: Examination[]): Block[] {
  const b: Block[] = [];
  const signals = tender.screen?.signals ?? [];

  b.push({ kind: "center", text: "PROCEEDINGS", tone: "spaced" }, { kind: "blank" });
  b.push({ kind: "paren", runs: [{ text: `(The matter of ${tender.source === "TED" ? "TED notice" : tender.source === "SAM_GOV" ? "SAM.gov notice" : "USAspending award"} ${tender.source_id} is called.)` }] });
  b.push({ kind: "blank" });
  b.push({
    kind: "speech", speaker: "THE CLERK", anchor: "screening",
    runs: [
      { text: `Preliminary screening scored this notice ` },
      { text: (tender.screen?.score ?? 0).toFixed(2), tone: "strong" },
      { text: signals.length ? ` on ${signals.length} signal${signals.length > 1 ? "s" : ""}: ` : ". No signals were recorded." },
      ...signals.flatMap((s, i) => [{ text: (i ? s.note.charAt(0).toLowerCase() + s.note.slice(1) : s.note).replace(/\.$/, "") }, { text: i === signals.length - 1 ? "." : "; " }]),
    ],
  });

  if (!trial) return b;
  const p = trial.prosecution;
  if (p) {
    b.push({ kind: "blank" }, { kind: "center", text: "OPENING STATEMENT BY THE PROSECUTION", anchor: "prosecution" }, { kind: "blank" });
    b.push({ kind: "speech", speaker: "THE PROSECUTOR", runs: [{ text: p.opening }] });
    if (p.injection_detected) {
      b.push({ kind: "blank" }, { kind: "paren", runs: [{ text: "(The Clerk notes that the notice contains text addressed to automated reviewers. It is entered into evidence and not obeyed.)", tone: "pencil" }] });
    }
    p.charges.forEach((c, i) => {
      const n = i + 1;
      const ex: ExhibitMark | undefined = c.quote
        ? { id: `P-${n}`, side: "p", quote: c.quote, status: c.quote_check.status, sectionKey: c.quote_check.sectionKey, start: c.quote_check.start, end: c.quote_check.end }
        : undefined;
      b.push({ kind: "blank" }, { kind: "center", text: `COUNT ${n} — ${c.title.toUpperCase()}`, anchor: `count-${c.id}` }, { kind: "blank" });
      b.push({ kind: "speech", speaker: "THE PROSECUTOR", runs: [{ text: `${humanCategory(c.category)}, ${c.severity} severity. ` , tone: "muted" }, { text: c.argument }] });
      if (ex) {
        b.push({ kind: "paren", exhibit: ex, anchor: `exhibit-${ex.id}`, runs: [
          { text: `(Exhibit ${ex.id} marked, from ${c.section}: ` },
          { text: `"${c.quote}"`, tone: ex.status === "NOT_FOUND" ? "struck" : "quote" },
          { text: ` ${STATUS_NOTE[ex.status]})`, tone: ex.status === "NOT_FOUND" ? "pencil" : "muted" },
        ] });
      } else {
        b.push({ kind: "paren", runs: [{ text: "(No exhibit. The count concerns information the notice does not publish.)", tone: "muted" }] });
      }
    });
  }

  const d = trial.defense;
  if (d) {
    b.push({ kind: "blank" }, { kind: "center", text: "RESPONSE BY THE DEFENSE", anchor: "defense" }, { kind: "blank" });
    b.push({ kind: "speech", speaker: "THE DEFENSE", runs: [{ text: d.opening }] });
    d.rebuttals.forEach((r, i) => {
      const n = (p?.charges.findIndex((c) => c.id === r.charge_id) ?? i) + 1 || i + 1;
      b.push({ kind: "blank" });
      b.push({ kind: "speech", speaker: "THE DEFENSE", anchor: `rebuttal-${r.charge_id}`, runs: [{ text: `As to Count ${n}, ${STANCE[r.stance]} `, tone: "strong" }, { text: r.explanation }] });
      if (r.counter_quote && r.quote_check) {
        const ex: ExhibitMark = { id: `D-${n}`, side: "d", quote: r.counter_quote, status: r.quote_check.status, sectionKey: r.quote_check.sectionKey, start: r.quote_check.start, end: r.quote_check.end };
        b.push({ kind: "paren", exhibit: ex, anchor: `exhibit-${ex.id}`, runs: [
          { text: `(Exhibit ${ex.id} marked: ` },
          { text: `"${r.counter_quote}"`, tone: ex.status === "NOT_FOUND" ? "struck" : "quote" },
          { text: ` ${STATUS_NOTE[ex.status]})`, tone: ex.status === "NOT_FOUND" ? "pencil" : "muted" },
        ] });
      }
      b.push({ kind: "paren", runs: [{ text: `(What would settle it: ${r.would_clear_it.replace(/\.$/, "")}.)`, tone: "muted" }] });
    });
  }

  const v = trial.verdict;
  if (v) {
    b.push({ kind: "blank" }, { kind: "center", text: "RULING OF THE COURT", anchor: "verdict" }, { kind: "blank" });
    v.rulings.forEach((r) => {
      const n = (p?.charges.findIndex((c) => c.id === r.charge_id) ?? -1) + 1 || r.charge_id.replace(/\D/g, "");
      const runs: Run[] = [{ text: `Count ${n} is ` }, { text: RULING_WORD[r.ruling], tone: "pencil" }, { text: `. ${r.reasoning}` }];
      b.push({ kind: "speech", speaker: "THE COURT", anchor: `ruling-${r.charge_id}`, runs }, { kind: "blank" });
    });
    b.push({ kind: "speech", speaker: "THE COURT", runs: [{ text: v.summary }] }, { kind: "blank" });
    b.push({ kind: "speech", speaker: "THE COURT", anchor: "risk", runs: [
      { text: "The court assesses the procurement risk as " }, { text: v.risk_level, tone: "pencil" },
      { text: `, ${v.risk_score.toFixed(2)} on the unit scale. ` },
      { text: v.human_review_required ? "Human review is required before any conclusion is drawn." : "No further human review is required at this stage." },
    ] });
    if (v.applicable_rules.length) {
      b.push({ kind: "blank" }, { kind: "speech", speaker: "THE COURT", runs: [{ text: "Provisions that may be relevant, subject to verification:" }] });
      v.applicable_rules.forEach((r) => b.push({ kind: "paren", runs: [
        { text: `${r.rule}`, tone: "strong" }, { text: ` — ${r.relevance.replace(/\.$/, "")}. ` },
        { text: r.verification === "LIKELY_APPLICABLE" ? "[likely applicable]" : "[needs legal verification]", tone: "muted" },
      ] }));
    }
    b.push({ kind: "blank" }, { kind: "speech", speaker: "THE COURT", runs: [{ text: "Recommendation: ", tone: "strong" }, { text: v.recommendation }] });

    b.push({ kind: "blank" }, { kind: "center", text: "INDEX OF RULINGS", anchor: "index" }, { kind: "blank" });
    v.rulings.forEach((r, i) => {
      const c = p?.charges.find((x) => x.id === r.charge_id);
      b.push({ kind: "leader", left: `Count ${i + 1}  ${c?.title ?? r.charge_id}`, right: r.ruling === "REFER_FOR_CLARIFICATION" ? "REFERRED" : r.ruling, tone: r.ruling === "DISMISSED" ? "struck" : "pencil" });
    });
  }

  if (trial.status === "complete" && v) {
    const m = trial.metrics ?? {};
    const exhibits = [...(p?.charges ?? []).filter((c) => c.quote).map((c) => c.quote_check.status), ...(d?.rebuttals ?? []).filter((r) => r.quote_check).map((r) => r.quote_check!.status)];
    const ok = exhibits.filter((s) => s !== "NOT_FOUND").length;
    const tokens = Object.values(m).reduce((a, x) => a + (x.completionTokens ?? 0), 0);
    b.push({ kind: "blank" }, { kind: "paren", runs: [{ text: `(Proceedings concluded ${new Date(trial.finished_at ?? Date.now()).toUTCString().replace("GMT", "UTC")}.)` }] });
    b.push({ kind: "blank" }, { kind: "center", text: "REPORTER'S CERTIFICATE", anchor: "certificate" }, { kind: "blank" });
    b.push({ kind: "speech", speaker: "CERTIFIED", runs: [
      { text: `The foregoing is a true record of proceedings generated by ${trial.model} on the Meta Model API under prompt ${trial.prompt_version}. ` },
      { text: `Prosecution ${sec(m.prosecution?.latencyMs)}, defense ${sec(m.defense?.latencyMs)}, court ${sec(m.verdict?.latencyMs)}${m.letter ? `, clerk ${sec(m.letter.latencyMs)}` : ""}; ${tokens.toLocaleString("en-GB")} output tokens. ` },
      { text: `${ok} of ${exhibits.length} exhibits were found in the notice text. ` , tone: "strong" },
      { text: "This record identifies indicators for human review. It makes no finding of wrongdoing." },
    ] });
  }

  if (exams.length) {
    b.push({ kind: "blank" }, { kind: "center", text: "EXAMINATION BY THE READER", anchor: "examination" });
    exams.forEach((e) => {
      b.push({ kind: "blank" }, { kind: "paren", runs: [{ text: `(Question put to ${AGENT[e.agent]}.)` }] });
      b.push({ kind: "qa", mark: "Q.", runs: [{ text: e.question }] });
      b.push({ kind: "qa", mark: "A.", runs: [{ text: e.answer.answer }] });
      e.answer.quote_checks?.forEach((q) =>
        b.push({ kind: "paren", runs: [{ text: `"${q.quote}"`, tone: q.status === "NOT_FOUND" ? "struck" : "quote" }, { text: ` ${STATUS_NOTE[q.status]}`, tone: "muted" }] }),
      );
    });
  }
  return b;
}

export const PENDING: Record<string, string> = {
  prosecution: "(Pause in the proceedings while the prosecution reads the notice.)",
  defense: "(Pause in the proceedings while counsel for the defense prepares a response.)",
  verdict: "(The court retires to consider the arguments.)",
  letter: "(The Clerk drafts a request for clarification.)",
};
