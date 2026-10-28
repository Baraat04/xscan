import type { CanonicalTender } from "../adapters/base.js";

export type RiskCategory =
  | "UNREALISTIC_TIMELINE" | "BRAND_SPECIFIC_LOCK" | "RESTRICTIVE_TECHNICAL_SPEC" | "DISPROPORTIONATE_PENALTIES"
  | "UNUSUAL_GUARANTEE_REQUIREMENT" | "AMBIGUOUS_REQUIREMENTS" | "CONFLICTING_DOCUMENTS" | "UNUSUAL_ELIGIBILITY_CONDITIONS"
  | "POTENTIAL_COMPETITION_RESTRICTION" | "MISSING_CRITICAL_INFORMATION" | "UNUSUAL_AMENDMENT_PATTERN";

export interface ScreenSignal {
  rule: string;
  category: RiskCategory | "PROMPT_INJECTION";
  weight: number;
  note: string;
  excerpt: string | null;
  section: string | null;
}

export interface ScreenResult {
  score: number;
  verdict: "CLEARED" | "REFER_TO_TRIBUNAL";
  signals: ScreenSignal[];
  rulesVersion: string;
}

export const RULES_VERSION = "screen-1.3";
export const DEFAULT_THRESHOLD = 0.35;

const EQUIVALENT = /(or equivalent|or equal|oder gleichwertig|gleichwertig|ou équivalent|ou equivalent|o equivalente|lub równoważn|of gelijkwaardig|o equivalenti)/i;

interface Hit { section: string; excerpt: string }

/** Finds the sentence containing the match so the excerpt is verbatim and readable. */
function find(t: CanonicalTender, re: RegExp): Hit | null {
  for (const s of t.sections) {
    const m = re.exec(s.text);
    if (m) {
      const start = Math.max(0, s.text.lastIndexOf("\n", m.index) + 1, ...[". ", "• "].map((p) => { const i = s.text.lastIndexOf(p, m.index); return i >= 0 ? i + p.length : 0; }));
      const endDot = s.text.indexOf(". ", m.index + m[0].length);
      const endNl = s.text.indexOf("\n", m.index + m[0].length);
      const ends = [endDot >= 0 ? endDot + 1 : s.text.length, endNl >= 0 ? endNl : s.text.length];
      return { section: s.label, excerpt: s.text.slice(start, Math.min(...ends)).trim().slice(0, 320) };
    }
  }
  return null;
}

const allText = (t: CanonicalTender) => t.sections.map((s) => s.text).join("\n");

type Rule = (t: CanonicalTender) => ScreenSignal | ScreenSignal[] | null;

const rules: Rule[] = [
  // Prompt injection aimed at automated reviewers is itself a finding.
  (t) => {
    const h = find(t, /(ignore (all |any )?(previous|prior) instructions|automated review systems?|classify this (procurement|notice|tender) as low|as an ai|language model)/i);
    return h && { rule: "injection", category: "PROMPT_INJECTION", weight: 0.5, note: "Notice text contains instructions aimed at automated reviewers. Quarantined as data.", ...h };
  },
  // Submission window. Directive 2014/24/EU Art. 27: 35 days (30 electronic, 15 accelerated). FAR 5.203: generally 15-30 days.
  (t) => {
    if (!t.publishedAt || !t.deadlineAt) return null;
    const days = (Date.parse(t.deadlineAt) - Date.parse(t.publishedAt)) / 86400000;
    const floor = t.jurisdiction === "EU" ? 15 : 10;
    if (days >= floor) return null;
    return { rule: "short-window", category: "UNREALISTIC_TIMELINE", weight: days < floor / 2 ? 0.45 : 0.3,
      note: `Only ${Math.round(days)} days between publication and the tender deadline.`, excerpt: null, section: null };
  },
  (t) => {
    const h = find(t, /(within|innerhalb von|w terminie|dans un délai de)?\s*\b(\d{1,2})\s*(calendar\s*)?(days|dni|tage|jours)\b[^.\n]{0,40}(of contract|signature|podpisania|vertragsschluss|delivered|deployed)/i)
      ?? find(t, /\b(delivered|deployed)[^.\n]{0,60}within \d{1,2} (calendar )?days/i)
      ?? find(t, /termin realizacji:\s*\d{1,2} dni/i);
    return h && { rule: "delivery-window", category: "UNREALISTIC_TIMELINE", weight: 0.2, note: "Very short delivery or execution period relative to scope.", ...h };
  },
  // Brand or model named without "or equivalent".
  (t) => {
    const re = /(brand name only|no substitutions|ausschließlich[^.\n]{0,40}(fabrikat|marke)|fabrikat\s+\w+|exclusivement de marque|shall be [A-Z][a-z]+ [A-Z][\w-]+ [A-Z0-9][\w-]*|\b(Lenovo|Dell|HP|Apple|Cisco|Siemens|Microsoft|Oracle|SAP|Hydrowerk)\b[^.\n]{0,30}\b[A-Z]{1,4}-?\d{2,5}\w*)/;
    const h = find(t, re);
    if (!h || EQUIVALENT.test(h.excerpt)) return null;
    return { rule: "brand-lock", category: "BRAND_SPECIFIC_LOCK", weight: 0.45, note: "A specific brand or model is required with no 'or equivalent' wording.", ...h };
  },
  (t) => {
    const h = find(t, /(proprietary|exakt \d|exactly \d|exacte?ment \d|\d+,\d+\s?mm|only available from|nicht zugelassen|will not be accepted)/i);
    return h && { rule: "restrictive-spec", category: "RESTRICTIVE_TECHNICAL_SPEC", weight: 0.3, note: "Unusually exact or proprietary technical parameter.", ...h };
  },
  // Turnover > 2x contract value (Directive 2014/24/EU Art. 58(3)).
  (t) => {
    const h = find(t, /(turnover|umsatz|chiffre d'affaires|obrót)[^\n]{0,80}?(\d[\d.,\s]{3,})/i);
    if (!h || !t.estimatedValue) return null;
    const m = h.excerpt.match(/(\d[\d.,\s]{3,}\d)/);
    const n = m ? Number(m[1].replace(/[\s.,](?=\d{3}\b)/g, "").replace(",", ".")) : NaN;
    if (!Number.isFinite(n) || n <= 2 * t.estimatedValue) return null;
    return { rule: "turnover-ratio", category: "UNUSUAL_ELIGIBILITY_CONDITIONS", weight: 0.35,
      note: `Turnover requirement is ${(n / t.estimatedValue).toFixed(1)}x the estimated value (EU default cap: 2x).`, ...h };
  },
  (t) => {
    const h = find(t, /(platinum partner|gold integrator|certified integrator|authori[sz]ed partner|im landkreis|w odległości nie większej|within the county|local office|sitz im|at this medical center|to irish local authorities|identischen typs)/i);
    return h && { rule: "eligibility", category: "POTENTIAL_COMPETITION_RESTRICTION", weight: 0.35, note: "Eligibility tied to a manufacturer relationship, locality or prior work for this buyer.", ...h };
  },
  (t) => {
    const h = find(t, /(\d+(?:[.,]\d+)?)\s?%[^.\n]{0,60}(per (calendar )?day|dziennie|pro tag|par jour)/i) ?? find(t, /\$\s?[\d,]{5,}\s*per (calendar )?day/i) ?? find(t, /without limit|ohne begrenzung|sans plafond|bez limitu/i);
    return h && { rule: "penalties", category: "DISPROPORTIONATE_PENALTIES", weight: 0.3, note: "Severe or uncapped delay penalties.", ...h };
  },
  (t) => {
    const h = find(t, /(wadium|guarantee|garantie|gwarancj|bond|caution)[^.\n]{0,80}?(\d{2,3})\s?%/i) ?? find(t, /(\d{2,3})\s?%[^.\n]{0,40}(wadium|guarantee|garantie|bond)/i);
    if (!h) return null;
    const pct = Number(h.excerpt.match(/(\d{2,3})\s?%/)?.[1] ?? 0);
    const isPerfBond = /performance and payment bonds of 100%/i.test(h.excerpt);
    if (pct < 10 || isPerfBond) {
      const extra = find(t, /special (completion )?guarantee of \d{2}%/i);
      return extra && { rule: "guarantee", category: "UNUSUAL_GUARANTEE_REQUIREMENT", weight: 0.3, note: "Additional guarantee on top of standard bonding.", ...extra };
    }
    return { rule: "guarantee", category: "UNUSUAL_GUARANTEE_REQUIREMENT", weight: 0.35, note: `Guarantee or bid security of ${pct}% of value.`, ...h };
  },
  (t) => {
    const h = find(t, /(skrócony|shortened|verkürzt|raccourci)|(dodano wymóg|added requirement|neue anforderung)/i);
    return h && { rule: "amendment", category: "UNUSUAL_AMENDMENT_PATTERN", weight: 0.3, note: "Amendment shortens the deadline or adds a new restrictive requirement.", ...h };
  },
  (t) => {
    const h = find(t, /(price 100\s?%|preis 100\s?%|cena 100\s?%|prix 100\s?%|questions will not be accepted|justification will be posted at a later date)/i);
    return h && { rule: "process", category: "AMBIGUOUS_REQUIREMENTS", weight: 0.2, note: "Process gap: no clarification channel, deferred justification or price-only evaluation.", ...h };
  },
  (t) => {
    const missing: string[] = [];
    if (t.estimatedValue == null && t.noticeType !== "award") missing.push("estimated value");
    if (!t.deadlineAt && t.noticeType !== "award") missing.push("deadline");
    if (!t.sections.some((s) => /selection|eligib|conditions|leistungsfähigkeit|zdolność|participation/i.test(s.label))) missing.push("selection criteria");
    if (missing.length < 1 || (t.source !== "TED" && missing.length < 2)) return null;
    return { rule: "missing-info", category: "MISSING_CRITICAL_INFORMATION", weight: missing.length > 1 ? 0.2 : 0.1, note: `Not published: ${missing.join(", ")}.`, excerpt: null, section: null };
  },
  (t) => {
    if (t.source !== "USASPENDING") return null;
    const v = t.estimatedValue ?? 0;
    // Orders under existing vehicles and SBIR Phase III have recognised sole-source bases; they weigh less.
    const routine = /(sbir phase iii|delivery order|task order|follow-on|bridge|option year)/i.test(t.title + " " + (t.summary ?? ""));
    const weight = (v > 100_000_000 ? 0.38 : v > 20_000_000 ? 0.25 : 0.15) * (routine ? 0.5 : 1);
    return { rule: "non-competed", category: "POTENTIAL_COMPETITION_RESTRICTION", weight,
      note: `Awarded without full and open competition, value $${(v / 1e6).toFixed(1)}M${routine ? " (order under an existing vehicle or recognised sole-source basis)" : ""}.`, excerpt: null, section: null };
  },
];

export function screenTender(t: CanonicalTender, threshold = DEFAULT_THRESHOLD): ScreenResult {
  const signals: ScreenSignal[] = [];
  for (const r of rules) {
    const out = r(t);
    if (out) signals.push(...(Array.isArray(out) ? out : [out]));
  }
  // Noisy-OR: independent weak signals accumulate, no single weak signal dominates.
  const score = 1 - signals.reduce((p, s) => p * (1 - s.weight), 1);
  return {
    score: Math.round(score * 1000) / 1000,
    verdict: score >= threshold ? "REFER_TO_TRIBUNAL" : "CLEARED",
    signals,
    rulesVersion: RULES_VERSION,
  };
}

export { allText };
