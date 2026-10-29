"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import type { Source } from "@/lib/types";
import { Close } from "./Icons";
import { useStore } from "./Store";

type Tab = "count" | "one" | "site";
type Official = Exclude<Source, "WEB">;

const TABS: { id: Tab; title: string; hint: string }[] = [
  { id: "count", title: "From official sources", hint: "TED and USAspending" },
  { id: "one", title: "One tender by link", hint: "Any website" },
  { id: "site", title: "All tenders from a website", hint: "A page that lists tenders" },
];

// Real public listing pages that read well, offered as one-click examples.
const EXAMPLES = [
  { label: "zakup.gov.kz (Kazakhstan)", url: "https://zakup.gov.kz/" },
  { label: "goszakup.gov.kz (Kazakhstan, old portal)", url: "https://goszakup.gov.kz/ru/search/announce" },
  { label: "find-tender.service.gov.uk (UK)", url: "https://www.find-tender.service.gov.uk/Search/Results" },
  { label: "sam.gov search “software” (US)", url: "https://sam.gov/search/?index=opp&page=1&pageSize=25&sort=-modifiedDate&sfm%5BsimpleSearch%5D%5BkeywordRadio%5D=ALL&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bkey%5D=software&sfm%5BsimpleSearch%5D%5BkeywordTags%5D%5B0%5D%5Bvalue%5D=software&sfm%5Bstatus%5D%5Bis_active%5D=true" },
];

const message = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong. Try again.");

export function AddTenders() {
  const { setAddOpen } = useStore();
  const [tab, setTab] = useState<Tab>("count");
  const box = useRef<HTMLDivElement>(null);
  const close = () => setAddOpen(false);

  useEffect(() => {
    box.current?.querySelector<HTMLElement>("input, textarea")?.focus();
  }, [tab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAddOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAddOpen]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" ref={box}>
        <header className="modal-head">
          <h2 id="add-title">Add tenders</h2>
          <button className="btn btn-ghost" onClick={close} aria-label="Close"><Close /></button>
        </header>
        <div className="add-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              <b>{t.title}</b>
              <small>{t.hint}</small>
            </button>
          ))}
        </div>
        <div className="modal-body" role="tabpanel">
          {tab === "count" && <ByCount />}
          {tab === "one" && <OneByLink />}
          {tab === "site" && <FromSite />}
        </div>
      </div>
    </div>
  );
}

function ByCount() {
  const { status, run, startUpdate } = useStore();
  const [count, setCount] = useState(100);
  const [sources, setSources] = useState<Official[]>(["TED", "USASPENDING"]);
  const busy = Boolean(run && !run.done);
  const official = (status?.sources ?? []).filter((s) => s.source !== "WEB");
  const toggle = (s: Official) => setSources((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!sources.length) return;
    void startUpdate(Math.max(1, Math.min(2000, Math.round(count))), sources);
  }

  return (
    <form onSubmit={submit} className="add-form">
      <p className="add-lead">Fetch the newest tenders that are not on file yet, straight from the official government APIs.</p>
      <label className="field">
        <span>How many new tenders?</span>
        <div className="count-row">
          <input type="number" min={1} max={2000} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          {[50, 100, 300, 1000].map((n) => (
            <button type="button" key={n} className={`chip${count === n ? " on" : ""}`} onClick={() => setCount(n)}>{n}</button>
          ))}
        </div>
      </label>
      <fieldset className="field">
        <span>From</span>
        <div className="checks">
          {official.map((s) => (
            <label key={s.source} className={`check${s.enabled ? "" : " off"}`}>
              <input type="checkbox" checked={s.enabled && sources.includes(s.source as Official)} disabled={!s.enabled} onChange={() => toggle(s.source as Official)} />
              <span><b>{s.label.split(" — ")[0]}</b><small>{s.enabled ? `${s.count} on file` : "Needs an API key (SAM_API_KEY)"}</small></span>
            </label>
          ))}
        </div>
      </fieldset>
      {run && run.kind === "update" && <Progress />}
      <div className="add-actions">
        <button className="btn btn-ink btn-lg" disabled={busy || !sources.length}>
          {busy ? "Fetching…" : `Fetch ${count || ""} tenders`}
        </button>
        <span className="add-fine">Usually under a minute. Each one is screened automatically.</span>
      </div>
    </form>
  );
}

function OneByLink() {
  const router = useRouter();
  const { setAddOpen, refresh } = useStore();
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [paste, setPaste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.importOne({ url: url.trim() || undefined, text: paste ? text : undefined });
      await refresh();
      setAddOpen(false);
      router.push(`/case/${r.id}${r.existing ? "" : "?call=1"}`);
    } catch (err) {
      setError(message(err));
      if (err instanceof ApiError && ["no_text", "http_error", "unsupported_type"].includes(err.code)) setPaste(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="add-form">
      <p className="add-lead">Paste a link to one tender from any website: a national procurement portal, SAM.gov, zakup.gov.kz. Pages built with JavaScript are opened in a browser first. The AI reads the page, then the prosecutor, defense and court check it.</p>
      <label className="field">
        <span>Link to the tender</span>
        <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required={!paste} />
      </label>
      {paste ? (
        <label className="field">
          <span>Tender text <small>(copy it from the page)</small></span>
          <textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the full text of the tender here" required />
        </label>
      ) : (
        <button type="button" className="link-btn" onClick={() => setPaste(true)}>The page needs a login or won’t load? Paste the text instead</button>
      )}
      {error && <p className="error-line" role="alert">{error}</p>}
      <div className="add-actions">
        <button className="btn btn-ink btn-lg" disabled={busy}>{busy ? "Reading the page…" : "Check this tender"}</button>
        <span className="add-fine">{busy ? "This takes about 30 seconds." : "Reading the page takes about 30 seconds; the check itself about a minute."}</span>
      </div>
    </form>
  );
}

function FromSite() {
  const { run, startListing, setAddOpen } = useStore();
  const [url, setUrl] = useState("");
  const [max, setMax] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const importing = Boolean(run && run.kind === "listing" && !run.done);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await startListing(url.trim(), Math.max(1, Math.min(30, Math.round(max))));
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="add-form">
      <p className="add-lead">Paste a link to a page that lists tenders, like a search results page on a procurement portal. xscan finds every tender on it and opens each one.</p>
      <label className="field">
        <span>Link to the page with tenders</span>
        <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} required />
      </label>
      <div className="examples">
        <span>Try:</span>
        {EXAMPLES.map((x) => <button type="button" key={x.url} className="chip" onClick={() => setUrl(x.url)}>{x.label}</button>)}
      </div>
      <label className="field narrow">
        <span>How many tenders to import? <small>(up to 30)</small></span>
        <input type="number" min={1} max={30} value={max} onChange={(e) => setMax(Number(e.target.value))} />
      </label>
      {error && <p className="error-line" role="alert">{error}</p>}
      {run && run.kind === "listing" && <Progress />}
      {run?.kind === "listing" && run.done && run.inserted > 0 && (
        <Link className="btn btn-paper" href="/docket?source=WEB" onClick={() => setAddOpen(false)}>Show imported tenders</Link>
      )}
      <div className="add-actions">
        <button className="btn btn-ink btn-lg" disabled={busy || importing}>{busy ? "Reading the page…" : importing ? "Importing…" : "Import tenders"}</button>
        <span className="add-fine">{busy ? "Finding the tenders on the page, about 20 seconds." : "Each tender is shown with the site it came from."}</span>
      </div>
    </form>
  );
}

function Progress() {
  const { run } = useStore();
  if (!run) return null;
  const pct = Math.min(100, (run.inserted / Math.max(1, run.target)) * 100);
  return (
    <div className={`progress${run.error ? " err" : ""}`} role="status" aria-live="polite">
      <div className="bar-track"><i style={{ width: `${run.done ? 100 : pct}%` }} /></div>
      <p>
        {run.error
          ? run.error
          : run.done
            ? run.kind === "listing"
              ? `Done: ${run.inserted} tender${run.inserted === 1 ? "" : "s"} imported from ${run.origin}${run.skipped ? `, ${run.skipped} could not be read` : ""}.`
              : run.inserted ? `Done: ${run.inserted} new tenders added.` : "Done: no new tenders right now. Everything recent is already on file."
            : run.kind === "listing"
              ? `Found ${run.found} on the page. Importing ${run.inserted} of ${run.target}…`
              : `${run.inserted} of ${run.target} new tenders…`}
      </p>
    </div>
  );
}
