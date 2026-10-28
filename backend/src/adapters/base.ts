export type Source = "TED" | "SAM_GOV" | "USASPENDING";
export type Jurisdiction = "EU" | "US";

/** One block of verbatim source text. Labels follow the source's own section naming. */
export interface NoticeSection {
  key: string;
  label: string;
  text: string;
}

/** Canonical tender: source facts only. AI interpretations live on trials, never here. */
export interface CanonicalTender {
  source: Source;
  sourceId: string;
  isSample: boolean;
  jurisdiction: Jurisdiction;
  url: string | null;
  title: string;
  summary: string | null;
  language: string | null;
  buyerName: string | null;
  buyerCountry: string | null;
  noticeType: string | null;
  procedureType: string | null;
  cpv: string[];
  naics: string | null;
  psc: string | null;
  estimatedValue: number | null;
  currency: string | null;
  publishedAt: string | null;
  deadlineAt: string | null;
  sections: NoticeSection[];
  raw: unknown;
}

export interface FetchOptions {
  since?: Date;
  limit?: number;
}

export interface SourceStatus {
  source: Source;
  label: string;
  enabled: boolean;
  reason?: string;
  docs: string;
}

export abstract class BaseProcurementAdapter {
  abstract readonly source: Source;
  abstract status(): SourceStatus;
  abstract fetchRecords(opts: FetchOptions): AsyncIterable<Record<string, any>>;
  abstract normalize(raw: Record<string, any>): CanonicalTender | null;
  abstract getSourceIdentifier(raw: Record<string, any>): string;
  abstract getSourceUrl(raw: Record<string, any>): string | null;
}

export async function fetchJson(url: string, init: RequestInit & { timeoutMs?: number } = {}, attempts = 3): Promise<any> {
  let last: Error | null = null;
  for (let i = 0; i < attempts; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20000);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`), { fatal: true });
      return await res.json();
    } catch (e: any) {
      last = e;
      if (e.fatal) break;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    } finally {
      clearTimeout(t);
    }
  }
  throw last ?? new Error("fetch failed");
}
