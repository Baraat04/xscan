const SOURCE_LABEL = { TED: "TED", SAM_GOV: "SAM.gov", USASPENDING: "USAspending", WEB: "Web" } as const;
export const sourceLabel = (s: keyof typeof SOURCE_LABEL) => SOURCE_LABEL[s];

const host = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www./, "") : null;
  } catch {
    return null;
  }
};

/** Where a tender came from, said plainly: which site, and whether it is an official API or a link someone added. */
export function origin(t: { source: keyof typeof SOURCE_LABEL; url: string | null }) {
  switch (t.source) {
    case "TED": return { site: "TED", kind: "Official EU tenders portal", official: true };
    case "USASPENDING": return { site: "USAspending.gov", kind: "Official US government spending data", official: true };
    case "SAM_GOV": return { site: "SAM.gov", kind: "Official US government tenders portal", official: true };
    default: return { site: host(t.url) ?? "Pasted text", kind: "Added by link", official: false };
  }
}

export function money(value: string | number | null, currency: string | null) {
  if (value === null || value === undefined || value === "") return "Not published";
  const n = Number(value);
  // An imported page may give an amount without saying the currency; never guess one.
  if (!currency) return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency ?? "EUR", maximumFractionDigits: 0, notation: n >= 1e8 ? "compact" : "standard" }).format(n);
  } catch {
    return `${n.toLocaleString("en-GB")} ${currency ?? ""}`;
  }
}

export function date(iso: string | null, withTime = false) {
  if (!iso) return "Not published";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" } : {}) });
}

export function daysUntil(iso: string | null) {
  if (!iso) return null;
  return Math.ceil((Date.parse(iso) - Date.now()) / 86400000);
}

export const humanCategory = (c: string) => c.toLowerCase().replaceAll("_", " ").replace(/^./, (m) => m.toUpperCase());

export const LANGUAGE: Record<string, string> = {
  en: "English", de: "German", fr: "French", pl: "Polish", es: "Spanish", it: "Italian", nl: "Dutch", pt: "Portuguese",
  cs: "Czech", da: "Danish", et: "Estonian", fi: "Finnish", el: "Greek", hu: "Hungarian", lv: "Latvian", lt: "Lithuanian",
  ro: "Romanian", sk: "Slovak", sl: "Slovenian", sv: "Swedish", bg: "Bulgarian", hr: "Croatian", ga: "Irish", mt: "Maltese",
  ru: "Russian", kk: "Kazakh", uk: "Ukrainian", tr: "Turkish", uz: "Uzbek", ky: "Kyrgyz", az: "Azerbaijani", ka: "Georgian",
  hy: "Armenian", be: "Belarusian", ar: "Arabic", zh: "Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi", no: "Norwegian",
};
