import { fetchJson, type CanonicalTender, type NoticeSection } from "../adapters/base.js";

// Site connectors: procurement portals that build their pages in the browser from a public JSON API.
// Their HTML is an empty shell, so reading the page finds nothing; reading the same API the page uses gives
// the exact official data. Each connector turns a page address into that API call.

export interface Connector {
  label: string;
  /** The canonical page address for a tender on this site, or null if the address is not a tender page. */
  key(url: URL): string | null;
  /** The tender behind a page address, or null if that page is not a tender. */
  one(url: URL): Promise<CanonicalTender | null>;
  /** Page addresses of the newest tenders on the site. */
  latest(max: number): Promise<string[]>;
}

// ---- zakup.gov.kz: Kazakhstan's unified public procurement platform ----

const ZK_SITE = "https://zakup.gov.kz";
const ZK_API = `${ZK_SITE}/api/core/api/public/`;

const zk = (path: string) => fetchJson(ZK_API + path, { headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; xscan/0.2)" }, timeoutMs: 20000 });

/** The portal sends Russian and Kazakh variants of most fields; the Russian one is the notice's own text. */
const ru = (o: any, k: string): string | null => o?.[`${k}_ru`] ?? o?.[k] ?? null;
const named = (v: any): string | null => (v == null ? null : typeof v === "string" ? v : v.full_name_ru ?? v.name_ru ?? v.name ?? null);
const iso = (v: number | string | null | undefined) => (v == null || v === "" ? null : new Date(typeof v === "number" ? v * 1000 : v).toISOString());
const when = (v: number | string | null | undefined) => {
  const d = iso(v);
  return d ? new Date(d).toLocaleString("ru-RU", { timeZone: "Asia/Almaty", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
};
const kzt = (n: number | string | null | undefined) => (n == null ? null : `${Number(n).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} тенге`);
const lines = (pairs: [string, unknown][]) =>
  pairs.filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false).map(([k, v]) => `${k}: ${v === true ? "да" : v}`).join("\n");

function planItemText(p: any) {
  return lines([
    ["Наименование", ru(p, "name")],
    ["Дополнительная характеристика", ru(p, "extra_description")],
    ["Описание", ru(p, "description")],
    ["Код ЕНС ТРУ", p.enstru?.code],
    ["Количество", p.count != null ? `${p.count} ${p.measure?.name ?? ""}`.trim() : null],
    ["Цена за единицу", kzt(p.unit_price)],
    ["Сумма", kzt(p.total_price)],
    ["Способ закупки", named(p.purchase_method)],
    ["Срок поставки", ru(p, "delivery_deadline")],
    ["Место поставки", named(p.delivery_address)],
    ["Условия поставки", named(p.delivery_condition)],
    ["Предоплата", p.prepayment != null ? `${p.prepayment}%` : null],
    ["Источник финансирования", named(p.funding_source)],
    ["Месяц закупки", p.month?.name ? `${p.month.name} ${p.year?.year ?? ""}`.trim() : null],
    ["Дополнительная информация", ru(p, "extra_info")],
  ]);
}

// The organizer is a public body; its director's personal details are left out on purpose.
const organizerText = (o: any) => {
  const a = o?.address;
  return lines([
    ["Организатор", o?.name ? `${o.name}${o.iin_bin ? ` (БИН ${o.iin_bin})` : ""}` : null],
    ["Адрес организатора", a ? [a.kato?.full_name_ru ?? a.city, a.street, a.house].filter(Boolean).join(", ") : null],
  ]);
};

const notFound = (e: unknown) => /HTTP 404/.test((e as Error).message);

async function zkAnnouncement(id: string): Promise<CanonicalTender | null> {
  let a: any;
  try {
    a = await zk(`announcements/${id}/`);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
  const lotsBody = await zk(`announcements/${id}/lots/`).catch(() => []);
  const lots: any[] = Array.isArray(lotsBody) ? lotsBody : lotsBody?.results ?? [];
  const filesBody = await zk(`announcements/${id}/general-files/`).catch(() => []);
  const docs = [...new Set<string>((Array.isArray(filesBody) ? filesBody : filesBody?.results ?? []).map((f: any) => f.group?.name).filter(Boolean))];

  const sections: NoticeSection[] = [{
    key: "announcement",
    label: "Объявление",
    text: [lines([
      ["Номер объявления", a.announcement_number],
      ["Наименование", ru(a, "name")],
      ["Статус", named(a.status)],
      ["Способ закупки", named(a.purchase_method)],
      ["Первоначальный способ закупки", named(a.os_purchase_method)],
      ["Тип закупки", named(a.purchase_type)],
      ["Предмет закупки", named(a.purchase_subject)],
      ["Дата публикации", when(a.publish_date)],
      ["Начало приема заявок", when(a.offer_start_date)],
      ["Окончание приема заявок", when(a.offer_end_date)],
      ["Обсуждение документации", a.discussion_start_date ? `${when(a.discussion_start_date)} – ${when(a.discussion_end_date)}` : null],
      ["Сумма закупки", kzt(a.total_price)],
      ["Количество лотов", a.lot_count],
      ["Закупка среди организаций инвалидов", a.is_among_disabled],
    ]), organizerText(a.organizer)].filter(Boolean).join("\n"),
  }];
  lots.forEach((l, i) => sections.push({
    key: `lot-${i + 1}`,
    label: `Лот ${l.lot_number ?? i + 1}`,
    text: [
      lines([["Наименование лота", ru(l, "name")], ["Описание лота", ru(l, "description")], ["Сумма лота", kzt(l.total_price)], ["Статус лота", named(l.status)], ["Консалтинговые услуги", l.is_consulting_service]]),
      ...(l.plan_items ?? []).map(planItemText),
    ].filter(Boolean).join("\n\n"),
  }));
  if (docs.length) sections.push({ key: "documents", label: "Документация", text: docs.map((d) => `• ${d}`).join("\n") });

  return {
    source: "WEB",
    sourceId: `${ZK_SITE}/announcement/${a.id}`,
    isSample: false,
    jurisdiction: "OTHER",
    url: `${ZK_SITE}/announcement/${a.id}`,
    title: ru(a, "name") ?? `Объявление ${a.announcement_number}`,
    summary: lots.map((l) => ru(l, "name")).filter(Boolean).join("; ").slice(0, 600) || null,
    language: "ru",
    buyerName: a.organizer?.name ?? null,
    buyerCountry: "KAZ",
    noticeType: "web",
    procedureType: named(a.purchase_method),
    cpv: [],
    naics: null,
    psc: null,
    estimatedValue: a.total_price != null ? Number(a.total_price) : null,
    currency: "KZT",
    publishedAt: iso(a.publish_date),
    deadlineAt: iso(a.offer_end_date),
    sections,
    raw: { connector: "zakup.gov.kz", announcement: { ...a, organizer: { ...a.organizer, director: undefined } }, lots },
  };
}

async function zkPlanItem(id: string): Promise<CanonicalTender | null> {
  let p: any;
  try {
    p = await zk(`plan-items/${id}/`);
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
  const org = p.organization;
  return {
    source: "WEB",
    sourceId: `${ZK_SITE}/plan-items/${p.id}`,
    isSample: false,
    jurisdiction: "OTHER",
    url: `${ZK_SITE}/plan-items/${p.id}`,
    title: ru(p, "name") ?? `Пункт плана ${p.id}`,
    summary: ru(p, "extra_description"),
    language: "ru",
    buyerName: named(org?.full_name_ru ? { name: org.full_name_ru } : org),
    buyerCountry: "KAZ",
    noticeType: "plan",
    procedureType: named(p.purchase_method),
    cpv: [],
    naics: null,
    psc: null,
    estimatedValue: p.total_price != null ? Number(p.total_price) : null,
    currency: "KZT",
    publishedAt: iso(p.plan?.act_date),
    deadlineAt: null,
    sections: [{
      key: "plan-item",
      label: "Пункт плана закупок",
      text: [
        planItemText(p),
        lines([
          ["Заказчик", org?.full_name_ru ?? org?.name ? `${org.full_name_ru ?? org.name}${org.iin_bin ? ` (БИН ${org.iin_bin})` : ""}` : null],
          ["Приказ об утверждении плана", p.plan?.act_number ? `№ ${p.plan.act_number} от ${p.plan.act_date ?? "?"}` : null],
          ["Цена по годам", [p.total_price_year_1, p.total_price_year_2, p.total_price_year_3].some((v) => v != null) ? [1, 2, 3, 4, 5].map((y) => p[`total_price_year_${y}`]).filter((v) => v != null).map(kzt).join(" / ") : null],
        ]),
      ].filter(Boolean).join("\n"),
    }],
    raw: { connector: "zakup.gov.kz", planItem: p },
  };
}

const zakupKz: Connector = {
  label: "zakup.gov.kz",
  key(url) {
    const m = url.pathname.match(/^\/(announcement|announcements|plan-items)\/(\d+)\/?$/);
    if (!m) return null;
    return `${ZK_SITE}/${m[1] === "plan-items" ? "plan-items" : "announcement"}/${m[2]}`;
  },
  async one(url) {
    const m = url.pathname.match(/^\/(announcement|announcements|plan-items)\/(\d+)\/?$/);
    if (!m) return null;
    return m[1] === "plan-items" ? zkPlanItem(m[2]) : zkAnnouncement(m[2]);
  },
  async latest(max) {
    const body = await zk(`announcements/?limit=${Math.min(max, 50)}&offset=0`);
    return (body.results ?? []).map((r: any) => `${ZK_SITE}/announcement/${r.id}`);
  },
};

const CONNECTORS: { host: RegExp; connector: Connector }[] = [{ host: /^(www\.)?zakup\.gov\.kz$/i, connector: zakupKz }];

export function connectorFor(url: string | URL): Connector | null {
  try {
    const host = (typeof url === "string" ? new URL(url) : url).hostname;
    return CONNECTORS.find((c) => c.host.test(host))?.connector ?? null;
  } catch {
    return null;
  }
}
