import { config } from "../config.js";
import { BaseProcurementAdapter, fetchJson, type CanonicalTender, type FetchOptions } from "./base.js";

const mdY = (d: Date) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

/** SAM.gov Contract Opportunities API v2. Requires a public API key. */
export class SamGovAdapter extends BaseProcurementAdapter {
  readonly source = "SAM_GOV" as const;

  status() {
    return {
      source: this.source,
      label: "SAM.gov — Contract Opportunities (US)",
      enabled: Boolean(config.samApiKey),
      reason: config.samApiKey ? undefined : "Set SAM_API_KEY to enable live ingestion",
      docs: "https://open.gsa.gov/api/get-opportunities-public-api/",
    };
  }

  async *fetchRecords({ since, limit = 40 }: FetchOptions) {
    if (!config.samApiKey) return;
    const to = new Date();
    const from = since ?? new Date(Date.now() - 3 * 86400000);
    const pageSize = Math.min(limit, 100);
    let offset = 0;
    while (offset < limit) {
      const qs = new URLSearchParams({
        api_key: config.samApiKey, postedFrom: mdY(from), postedTo: mdY(to),
        limit: String(pageSize), offset: String(offset), ptype: "o,k,p",
      });
      const body = await fetchJson(`https://api.sam.gov/opportunities/v2/search?${qs}`);
      const items: any[] = body.opportunitiesData ?? [];
      for (const it of items) yield it;
      if (items.length < pageSize) return;
      offset += pageSize;
    }
  }

  getSourceIdentifier(raw: Record<string, any>) {
    return String(raw.noticeId);
  }

  getSourceUrl(raw: Record<string, any>) {
    return raw.uiLink ?? `https://sam.gov/opp/${raw.noticeId}/view`;
  }

  normalize(raw: Record<string, any>): CanonicalTender | null {
    if (!raw.noticeId || !raw.title) return null;
    const pop = raw.placeOfPerformance;
    const sections = [
      { key: "overview", label: "Opportunity overview", text: [
        `Notice type: ${raw.type ?? "unknown"}`,
        raw.solicitationNumber ? `Solicitation number: ${raw.solicitationNumber}` : null,
        raw.typeOfSetAsideDescription ? `Set-aside: ${raw.typeOfSetAsideDescription}` : "Set-aside: none stated",
        raw.naicsCode ? `NAICS: ${raw.naicsCode}` : null,
        raw.classificationCode ? `PSC: ${raw.classificationCode}` : null,
        pop?.city?.name ? `Place of performance: ${pop.city.name}, ${pop.state?.code ?? ""}` : null,
      ].filter(Boolean).join("\n") },
    ];
    // SAM.gov returns the description as a URL that needs the API key; it is fetched lazily, never invented.
    return {
      source: "SAM_GOV",
      sourceId: this.getSourceIdentifier(raw),
      isSample: false,
      jurisdiction: "US",
      url: this.getSourceUrl(raw),
      title: raw.title,
      summary: null,
      language: "en",
      buyerName: raw.fullParentPathName?.split(".").pop() ?? raw.department ?? null,
      buyerCountry: "USA",
      noticeType: raw.type ?? null,
      procedureType: raw.typeOfSetAsideDescription ?? null,
      cpv: [],
      naics: raw.naicsCode ?? null,
      psc: raw.classificationCode ?? null,
      estimatedValue: raw.award?.amount ? Number(raw.award.amount) : null,
      currency: "USD",
      publishedAt: raw.postedDate ? new Date(raw.postedDate).toISOString() : null,
      deadlineAt: raw.responseDeadLine ? new Date(raw.responseDeadLine).toISOString() : null,
      sections,
      raw,
    };
  }
}

const COMPETITION: Record<string, string> = {
  B: "Not available for competition", C: "Not competed", G: "Not competed under simplified acquisition procedures",
  NDO: "Non-competitive delivery order", A: "Full and open competition", D: "Full and open competition after exclusion of sources",
};

/** USAspending.gov awards API. Post-award records: used to surface awards made without competition. */
export class UsaSpendingAdapter extends BaseProcurementAdapter {
  readonly source = "USASPENDING" as const;

  status() {
    return { source: this.source, label: "USAspending.gov — federal awards (US)", enabled: true, docs: "https://api.usaspending.gov/docs/endpoints" };
  }

  async *fetchRecords({ since, limit = 300 }: FetchOptions) {
    const from = since ?? new Date(Date.now() - 120 * 86400000);
    let page = 1;
    let yielded = 0;
    while (yielded < limit) {
      const body = await fetchJson("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: {
            award_type_codes: ["A", "B", "C", "D"],
            time_period: [{ start_date: from.toISOString().slice(0, 10), end_date: new Date().toISOString().slice(0, 10) }],
            extent_competed_type_codes: ["B", "C", "G", "NDO"],
          },
          fields: ["Award ID", "Recipient Name", "Award Amount", "Description", "Awarding Agency", "Awarding Sub Agency",
            "Start Date", "End Date", "NAICS", "PSC", "Place of Performance State Code", "generated_internal_id"],
          limit: 100, page, sort: "Start Date", order: "desc",
        }),
      });
      const results: any[] = body.results ?? [];
      for (const r of results) {
        if (yielded >= limit) return;
        yielded++;
        yield r;
      }
      if (!body.page_metadata?.hasNext || !results.length) return;
      page++;
    }
  }

  getSourceIdentifier(raw: Record<string, any>) {
    return String(raw.generated_internal_id ?? raw["Award ID"]);
  }

  getSourceUrl(raw: Record<string, any>) {
    return raw.generated_internal_id ? `https://www.usaspending.gov/award/${raw.generated_internal_id}` : null;
  }

  normalize(raw: Record<string, any>): CanonicalTender | null {
    const desc: string = raw.Description ?? "";
    if (!desc) return null;
    const title = desc.length > 110 ? `${desc.slice(0, 107).trim()}…` : desc;
    return {
      source: "USASPENDING",
      sourceId: this.getSourceIdentifier(raw),
      isSample: false,
      jurisdiction: "US",
      url: this.getSourceUrl(raw),
      title: title.charAt(0) + title.slice(1).toLowerCase(),
      summary: desc.slice(0, 600),
      language: "en",
      buyerName: raw["Awarding Sub Agency"] ?? raw["Awarding Agency"] ?? null,
      buyerCountry: "USA",
      noticeType: "award",
      procedureType: "Awarded without full and open competition (filtered)",
      cpv: [],
      naics: raw.NAICS?.code ?? null,
      psc: raw.PSC?.code ?? null,
      estimatedValue: raw["Award Amount"] ?? null,
      currency: "USD",
      publishedAt: raw["Start Date"] ? `${raw["Start Date"]}T12:00:00Z` : null,
      deadlineAt: null,
      sections: [
        { key: "description", label: "Award description", text: desc },
        { key: "award", label: "Award facts", text: [
          `Recipient: ${raw["Recipient Name"] ?? "unknown"}`,
          `Award amount: $${Number(raw["Award Amount"] ?? 0).toLocaleString("en-US")}`,
          `Competition: ${COMPETITION.C} or equivalent non-competitive basis (per USAspending filter)`,
          `Period: ${raw["Start Date"] ?? "?"} to ${raw["End Date"] ?? "?"}`,
          raw.NAICS ? `NAICS ${raw.NAICS.code}: ${raw.NAICS.description}` : null,
          raw.PSC ? `PSC ${raw.PSC.code}: ${raw.PSC.description}` : null,
        ].filter(Boolean).join("\n") },
      ],
      raw,
    };
  }
}
