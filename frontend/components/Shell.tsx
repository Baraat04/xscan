"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { AddTenders } from "./AddTenders";
import { CommandPalette } from "./CommandPalette";
import { Close } from "./Icons";
import { classify, useStore } from "./Store";

/** False on the server and during hydration, so parts that depend on the session render the same on both. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

// The Update button asks for this many new tenders, split between the official sources.
const UPDATE_TARGET = 120;

export function Shell({ children }: { children: ReactNode }) {
  const { addOpen } = useStore();
  return (
    <div className="app">
      <TopBar />
      <main className="desk" id="desk">{children}</main>
      {addOpen && <AddTenders />}
      <CommandPalette />
    </div>
  );
}

function TopBar() {
  const { run, startUpdate, requireUser, setAddOpen } = useStore();
  const busy = Boolean(run && !run.done);
  return (
    <header className="bar">
      <Link href="/" className="wordmark" aria-label="xscan, home">
        <b>xscan</b>
        <span>Tender inspection bureau</span>
      </Link>
      <Nav />
      <div className="bar-right">
        <RunPill />
        <button className="search-hint" onClick={() => window.dispatchEvent(new Event("xscan:palette"))} title="Search pages and tenders (Ctrl K)">
          Search
        </button>
        <button
          className="btn btn-ghost-bar hide-sm"
          onClick={() => requireUser(() => void startUpdate(UPDATE_TARGET))}
          disabled={busy}
          title="Fetch the newest tenders from TED and USAspending"
        >
          Update
        </button>
        <button className="btn" onClick={() => requireUser(() => setAddOpen(true))}>
          <span className="hide-sm">Add tenders</span><span className="show-sm">Add</span>
        </button>
        <Account />
      </div>
    </header>
  );
}

function Nav() {
  const path = usePathname();
  const { tenders: loaded, threshold, user: sessionUser } = useStore();
  const mounted = useMounted();
  const tenders = mounted ? loaded : null;
  const user = mounted ? sessionUser : null;
  const toCheck = useMemo(() => (tenders ?? []).filter((t) => classify(t, threshold) === "referred").length, [tenders, threshold]);
  const saved = useMemo(() => (tenders ?? []).filter((t) => t.saved).length, [tenders]);
  const tendersActive = path.startsWith("/docket") || path.startsWith("/case/");
  return (
    <nav className="nav" aria-label="Main">
      <Link href="/" aria-current={path === "/" ? "page" : undefined}>Overview</Link>
      <Link href="/court" aria-current={path.startsWith("/court") ? "page" : undefined}>Live court</Link>
      <Link href="/docket" aria-current={tendersActive ? "page" : undefined}>
        Tenders
        {tenders && toCheck > 0 && <em title={`${toCheck} tenders to check`}>{toCheck}</em>}
      </Link>
      <Link href="/saved" aria-current={path === "/saved" ? "page" : undefined}>
        Saved
        {user && saved > 0 && <em>{saved}</em>}
      </Link>
      <Link href="/how" aria-current={path === "/how" ? "page" : undefined}>How it works</Link>
    </nav>
  );
}

function RunPill() {
  const { run, clearRun } = useStore();
  useEffect(() => {
    if (!run?.done || run.error) return;
    const t = setTimeout(clearRun, 8000);
    return () => clearTimeout(t);
  }, [run, clearRun]);
  if (!run) return null;
  const pct = Math.min(100, (run.inserted / Math.max(1, run.target)) * 100);
  const label = run.error
    ? run.error
    : run.done
      ? run.inserted
        ? `${run.inserted} new tender${run.inserted === 1 ? "" : "s"} added`
        : "No new tenders right now"
      : run.kind === "update"
        ? `Updating${run.scanning ? ` from ${run.scanning === "USASPENDING" ? "USAspending" : run.scanning === "SAM_GOV" ? "SAM.gov" : run.scanning}` : ""}… ${run.inserted} of ${run.target} new`
        : `Importing from ${run.origin}… ${run.inserted} of ${run.target}`;
  return (
    <div className={`run-pill${run.error ? " err" : ""}${run.done ? " done" : ""}`} role="status" aria-live="polite">
      {!run.done && <i style={{ width: `${pct}%` }} aria-hidden />}
      <span>{label}</span>
      {run.done && <button onClick={clearRun} aria-label="Dismiss"><Close /></button>}
    </div>
  );
}

function Account() {
  const { user: sessionUser, setUser } = useStore();
  const mounted = useMounted();
  const user = mounted ? sessionUser : undefined;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const path = usePathname();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (user === undefined) return <span className="account-slot" aria-hidden />;
  if (!user) return <Link className="btn btn-ghost-bar" href={`/login?next=${encodeURIComponent(path)}`}>Sign in</Link>;
  return (
    <div className="account" ref={ref}>
      <button className="avatar" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Account: ${user.name}`}>
        {user.name.trim().charAt(0).toUpperCase() || "?"}
      </button>
      {open && (
        <div className="menu" role="menu">
          <p><b>{user.name}</b><span>{user.email}</span></p>
          <Link href="/saved" role="menuitem" onClick={() => setOpen(false)}>Saved tenders</Link>
          <button
            role="menuitem"
            onClick={async () => {
              await api.logout().catch(() => {});
              setOpen(false);
              setUser(null);
              router.push("/");
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
