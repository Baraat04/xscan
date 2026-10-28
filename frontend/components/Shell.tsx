"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API, api } from "@/lib/api";
import { sourceLabel } from "@/lib/format";
import { classify, useStore } from "./Store";
import { Check, Collect } from "./Icons";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <TopBar />
      <main className="desk" id="desk">{children}</main>
    </div>
  );
}

function TopBar() {
  const { status, refresh } = useStore();
  const [collecting, setCollecting] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);

  useEffect(() => () => es.current?.close(), []);

  async function collect() {
    setCollecting("Contacting sources…");
    es.current?.close();
    const src = new EventSource(`${API}/ingest/events`);
    es.current = src;
    let count = 0;
    src.addEventListener("record", () => {
      count++;
      setCollecting(`${count} notice${count > 1 ? "s" : ""} received`);
    });
    src.addEventListener("job", (e) => {
      const j = JSON.parse((e as MessageEvent).data);
      if (j.status === "running") setCollecting(`Reading ${sourceLabel(j.source)}…`);
      if (j.source === "USASPENDING" && j.status !== "running") {
        src.close();
        setCollecting(null);
        void refresh();
      }
    });
    try {
      await api.ingest();
    } catch {
      src.close();
      setCollecting(null);
    }
    setTimeout(() => {
      if (es.current === src && src.readyState !== 2) {
        src.close();
        setCollecting(null);
        void refresh();
      }
    }, 60000);
  }

  return (
    <header className="bar">
      <Link href="/" className="wordmark" aria-label="xscan, home">
        <b>xscan</b>
        <span>Tender Tribunal</span>
      </Link>
      <Suspense fallback={<nav className="nav" aria-label="Main" />}>
        <Nav />
      </Suspense>
      <div className="bar-sources" aria-label="Source status">
        {status?.sources.map((s) => (
          <span key={s.source} className={`src${s.enabled ? "" : " off"}`} title={s.enabled ? `${s.count} notices on file` : s.reason}>
            {s.enabled && <Check className="src-tick" />}
            {sourceLabel(s.source)}
            {s.enabled ? ` · ${s.count}` : " · key needed"}
          </span>
        ))}
        {status && (
          <span className={`src${status.model.configured ? "" : " off"}`} title={status.model.provider}>
            {status.model.configured && <Check className="src-tick" />}
            {status.model.model}
          </span>
        )}
      </div>
      <button className="btn btn-binder collect" onClick={collect} disabled={Boolean(collecting)} aria-live="polite">
        <Collect />
        <span>{collecting ?? "Collect new notices"}</span>
      </button>
    </header>
  );
}

function Nav() {
  const path = usePathname();
  const { tenders, threshold } = useStore();
  const waiting = useMemo(() => (tenders ?? []).filter((t) => classify(t, threshold) === "referred").length, [tenders, threshold]);
  const docketActive = path.startsWith("/docket") || path.startsWith("/case/");
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" aria-current={path === "/" ? "page" : undefined}>Overview</Link>
      <Link href="/docket" aria-current={docketActive ? "page" : undefined}>
        Docket
        {tenders && waiting > 0 && <em title={`${waiting} notices await a hearing`}>{waiting}</em>}
      </Link>
    </nav>
  );
}
