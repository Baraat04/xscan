import { BaseProcurementAdapter, fetchJson, type CanonicalTender, type FetchOptions, type NoticeSection } from "./base.js";

const API = "https://api.ted.europa.eu/v3/notices/search";
const FIELDS = [
  "publication-number", "notice-title", "title-proc", "buyer-name", "buyer-country", "buyer-city",
  "classification-cpv", "deadline-receipt-tender-date-lot", "description-proc", "description-lot",
  "estimated-value-lot", "estimated-value-cur-lot", "procedure-type", "notice-type", "publication-date",
  "links", "official-language", "selection-criterion-description-lot", "award-criterion-name-lot",
  "duration-period-value-lot", "duration-period-unit-lot", "contract-nature",
];

// ISO 639-3 (TED) to ISO 639-1
const LANG: Record<string, string> = {
  ENG: "en", DEU: "de", FRA: "fr", SPA: "es", ITA: "it", NLD: "nl", POL: "pl", POR: "pt", CES: "cs", DAN: "da",
  EST: "et", FIN: "fi", ELL: "el", HUN: "hu", LAV: "lv", LIT: "lt", RON: "ro", SLK: "sk", SLV: "sl", SWE: "sv",
  BUL: "bg", HRV: "hr", GLE: "ga", MLT: "mt",
};

type Multi = Record<string, string | string[]> | undefined;

/** Pick the notice's own language first so quotes stay verbatim; English only as fallback. */
function pick(m: Multi, lang3: string | undefined): string[] {
  if (!m) return [];
  const key = (lang3 && m[lang3.toLowerCase()] ? lang3.toLowerCase() : null) ?? (m.eng ? "eng" : Object.keys(m)[0]);
  const v = key ? m[key] : undefined;
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function dateOnly(s: string | undefined): string | null {
  if (!s) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? `${m[1]}T23:59:00Z` : null;
}

export class TedAdapter extends BaseProcurementAdapter {
  readonly source = "TED" as const;

  status() {
    return { source: this.source, label: "TED — Tenders Electronic Daily (EU)", enabled: true, docs: "https://docs.ted.europa.eu/api/latest/index.html" };
  }

  async *fetchRecords({ since, limit = 40 }: FetchOptions) {
    const from = since ?? new Date(Date.now() - 4 * 86400000);
    const ymd = from.toISOString().slice(0, 10).replaceAll("-", "");
    const pageSize = Math.min(limit, 50);
    let page = 1;
    let yielded = 0;
    while (yielded < limit) {
      const body = await fetchJson(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `publication-date>=${ymd} AND notice-type IN (cn-standard cn-social cn-desg)`,
          fields: FIELDS, page, limit: pageSize, scope: "ACTIVE", paginationMode: "PAGE_NUMBER",
        }),
      });
      const notices: any[] = body.notices ?? [];
      for (const n of notices) {
        if (yielded >= limit) return;
        yielded++;
        yield n;
      }
      if (notices.length < pageSize) return;
      page++;
    }
  }

  getSourceIdentifier(raw: Record<string, any>) {
    return String(raw["publication-number"]);
  }

  getSourceUrl(raw: Record<string, any>) {
    return `https://ted.europa.eu/en/notice/-/detail/${this.getSourceIdentifier(raw)}`;
  }

  normalize(raw: Record<string, any>): CanonicalTender | null {
    const lang3: string | undefined = raw["official-language"]?.[0];
    const title = pick(raw["title-proc"] ?? raw["notice-title"], lang3)[0];
    if (!title) return null;
    const sections: NoticeSection[] = [];
    const proc = pick(raw["description-proc"], lang3);
    if (proc.length) sections.push({ key: "description", label: "Description of the procurement", text: proc.join("\n\n") });
    pick(raw["description-lot"], lang3).forEach((t, i, all) =>
      sections.push({ key: `lot-${i + 1}`, label: all.length > 1 ? `Lot ${i + 1} — description` : "Lot description", text: t }),
    );
    const sel = pick(raw["selection-criterion-description-lot"], lang3);
    if (sel.length) sections.push({ key: "selection", label: "Selection criteria", text: sel.map((s) => `• ${s}`).join("\n") });
    const award = pick(raw["award-criterion-name-lot"], lang3);
    if (award.length) sections.push({ key: "award", label: "Award criteria", text: [...new Set(award)].map((s) => `• ${s}`).join("\n") });
    const dur = raw["duration-period-value-lot"]?.[0];
    if (dur) sections.push({ key: "duration", label: "Duration", text: `${dur} ${String(raw["duration-period-unit-lot"]?.[0] ?? "").toLowerCase()}` });

    const values: number[] = (raw["estimated-value-lot"] ?? []).map(Number).filter((n: number) => Number.isFinite(n));
    return {
      source: "TED",
      sourceId: this.getSourceIdentifier(raw),
      isSample: false,
      jurisdiction: "EU",
      url: this.getSourceUrl(raw),
      title,
      summary: (proc[0] ?? sections[0]?.text ?? "").slice(0, 600) || null,
      language: lang3 ? LANG[lang3] ?? lang3.toLowerCase() : null,
      buyerName: pick(raw["buyer-name"], lang3)[0] ?? null,
      buyerCountry: raw["buyer-country"]?.[0] ?? null,
      noticeType: raw["notice-type"] ?? null,
      procedureType: raw["procedure-type"] ?? null,
      cpv: [...new Set<string>(raw["classification-cpv"] ?? [])],
      naics: null,
      psc: null,
      estimatedValue: values.length ? values.reduce((a, b) => a + b, 0) : null,
      currency: raw["estimated-value-cur-lot"]?.[0] ?? null,
      publishedAt: dateOnly(raw["publication-date"])?.replace("T23:59:00Z", "T09:00:00Z") ?? null,
      deadlineAt: dateOnly(raw["deadline-receipt-tender-date-lot"]?.[0]),
      sections,
      raw,
    };
  }
}
