export type Source = "TED" | "SAM_GOV" | "USASPENDING" | "WEB";
export type Jurisdiction = "EU" | "US" | "OTHER";

export interface User {
  id: string;
  email: string;
  name: string;
}
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type QuoteStatus = "VERIFIED" | "APPROXIMATE" | "NOT_FOUND";

export interface ScreenSignal {
  rule: string;
  category: string;
  weight: number;
  note: string;
  excerpt: string | null;
  section: string | null;
}

export interface TenderSummary {
  id: string;
  source: Source;
  source_id: string;
  is_sample: boolean;
  jurisdiction: Jurisdiction;
  url: string | null;
  title: string;
  language: string | null;
  buyer_name: string | null;
  buyer_country: string | null;
  notice_type: string | null;
  procedure_type: string | null;
  cpv: string[];
  naics: string | null;
  psc: string | null;
  estimated_value: string | null;
  currency: string | null;
  published_at: string | null;
  deadline_at: string | null;
  status: "new" | "cleared" | "flagged" | "tried";
  screen_score: number | null;
  screen: { score: number; verdict: string; signals: ScreenSignal[]; rulesVersion: string } | null;
  trial_id: string | null;
  trial_status: "running" | "complete" | "failed" | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  /** Added by a user from a link, not collected from an official API. */
  imported: boolean;
  /** Saved by the signed-in user. Always false when signed out. */
  saved: boolean;
}

export interface NoticeSection {
  key: string;
  label: string;
  text: string;
}

export interface Tender extends TenderSummary {
  summary: string | null;
  sections: NoticeSection[];
}

export interface QuoteCheck {
  status: QuoteStatus;
  sectionKey: string | null;
  start: number;
  end: number;
}

export interface Charge {
  id: string;
  category: string;
  title: string;
  quote: string;
  section: string;
  argument: string;
  severity: "low" | "medium" | "high";
  quote_check: QuoteCheck;
}

export interface Prosecution {
  opening: string;
  charges: Charge[];
  injection_detected: boolean;
}

export interface Rebuttal {
  charge_id: string;
  stance: "contest" | "partially_concede" | "concede";
  explanation: string;
  counter_quote: string;
  would_clear_it: string;
  quote_check: QuoteCheck | null;
}

export interface Defense {
  opening: string;
  rebuttals: Rebuttal[];
}

export interface Ruling {
  charge_id: string;
  ruling: "SUSTAINED" | "DISMISSED" | "REFER_FOR_CLARIFICATION";
  reasoning: string;
  prosecution_strength: number;
  defense_strength: number;
  evidence_status: "VERIFIED_FACT" | "ANALYTICAL_INFERENCE" | "UNVERIFIED_HYPOTHESIS";
}

export interface Verdict {
  summary: string;
  rulings: Ruling[];
  risk_score: number;
  risk_level: RiskLevel;
  applicable_rules: { rule: string; relevance: string; verification: "LIKELY_APPLICABLE" | "NEEDS_LEGAL_VERIFICATION" }[];
  recommendation: string;
  human_review_required: boolean;
}

export interface Letter {
  language: string;
  subject: string;
  body: string;
  subject_en: string;
  body_en: string;
}

export interface CallMetrics {
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  attempts: number;
}

export interface Trial {
  id: string;
  tender_id: string;
  status: "running" | "complete" | "failed";
  model: string;
  prompt_version: string;
  prosecution: Prosecution | null;
  defense: Defense | null;
  verdict: Verdict | null;
  letter: Letter | null;
  risk_score: number | null;
  risk_level: RiskLevel | null;
  metrics: Record<string, CallMetrics>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface Examination {
  id: string;
  agent: "prosecutor" | "defense" | "court";
  question: string;
  answer: { answer: string; quotes: string[]; quote_checks: (QuoteCheck & { quote: string })[] };
  created_at: string;
}

export interface SourceStatus {
  source: Source;
  label: string;
  enabled: boolean;
  reason?: string;
  docs: string;
  count: number;
  samples: number;
  lastJob: { status: string; fetched: number; cleared: number; flagged: number; finished_at: string | null; error: string | null } | null;
}

export interface Status {
  sources: SourceStatus[];
  database: "postgres" | "pglite";
  model: { provider: string; model: string; judge: string; configured: boolean };
  screening: { rulesVersion: string; defaultThreshold: number };
}
