"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { API, api, ApiError } from "@/lib/api";
import type { Source, Status, TenderSummary, User } from "@/lib/types";

interface StoreValue {
  tenders: TenderSummary[] | null;
  status: Status | null;
  error: string | null;
  threshold: number;
  setThreshold: (n: number) => void;
  refresh: () => Promise<void>;
  /** undefined while the session is being checked, null when signed out. */
  user: User | null | undefined;
  setUser: (u: User | null) => void;
  /** Runs fn when signed in; otherwise sends the visitor to sign in and back here afterwards. */
  requireUser: (fn: () => void) => void;
  toggleSave: (id: string) => Promise<void>;
  addOpen: boolean;
  setAddOpen: (open: boolean) => void;
  run: Run | null;
  startUpdate: (target: number, sources?: Exclude<Source, "WEB">[]) => Promise<void>;
  startListing: (url: string, max: number) => Promise<void>;
  clearRun: () => void;
}

/** One live collection run: an update from the official APIs, or an import from a listing page. */
export interface Run {
  kind: "update" | "listing";
  target: number;
  inserted: number;
  skipped: number;
  done: boolean;
  error: string | null;
  origin?: string;
  found?: number;
  /** The source an update is reading right now. */
  scanning?: string;
}

const Ctx = createContext<StoreValue | null>(null);

const DEFAULT_THRESHOLD = 0.35;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [tenders, setTenders] = useState<TenderSummary[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Session-only on purpose: every visit starts from the documented default, and SSR markup always matches.
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [user, setUserState] = useState<User | null | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.tenders(), api.status()]);
      setTenders(t.tenders);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the tenders.");
    }
  }, []);

  useEffect(() => {
    api.me().then((r) => setUserState(r.user)).catch(() => setUserState(null));
    void refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  // Saved flags come from the server per user, so reload the list whenever the account changes.
  const setUser = useCallback((u: User | null) => {
    setUserState(u);
    void refresh();
  }, [refresh]);

  const requireUser = useCallback((fn: () => void) => {
    if (user) fn();
    // Read the path at call time: the provider wraps every route, and a path hook here would make each one dynamic.
    else router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [user, router]);

  const toggleSave = useCallback(async (id: string) => {
    const current = tenders?.find((t) => t.id === id)?.saved ?? false;
    setTenders((list) => list?.map((t) => (t.id === id ? { ...t, saved: !current } : t)) ?? list);
    try {
      await (current ? api.unsave(id) : api.save(id));
    } catch {
      setTenders((list) => list?.map((t) => (t.id === id ? { ...t, saved: current } : t)) ?? list);
    }
  }, [tenders]);

  const [run, setRun] = useState<Run | null>(null);
  const es = useRef<EventSource | null>(null);
  useEffect(() => () => es.current?.close(), []);

  /** Opens the ingest stream before the request starts, so no early event is missed. Events for other runs are ignored. */
  const follow = useCallback((initial: Run, knownId: string | null) => {
    es.current?.close();
    const src = new EventSource(`${API}/ingest/events`);
    es.current = src;
    let id = knownId;
    const finish = (patch: Partial<Run>) => {
      src.close();
      setRun((r) => (r ? { ...r, ...patch, done: true } : r));
      void refresh();
    };
    // Only one update runs at a time on the server, so when the start event was missed, adopt the first run id seen.
    const ours = (runId: string) => {
      if (!id) id = runId;
      return runId === id;
    };
    src.addEventListener("run", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (!ours(d.id)) return;
      if (d.status === "complete") finish({ inserted: d.inserted });
      if (d.status === "failed") finish({ error: d.error ?? "The update failed." });
    });
    src.addEventListener("record", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (ours(d.runId) && initial.kind === "update") setRun((r) => (r ? { ...r, inserted: r.inserted + 1 } : r));
    });
    src.addEventListener("job", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      if (!ours(d.runId)) return;
      if (initial.kind === "listing") setRun((r) => (r ? { ...r, inserted: d.inserted + d.updated, skipped: d.skipped ?? 0 } : r));
      else setRun((r) => (r ? { ...r, scanning: d.source } : r));
    });
    setRun(initial);
    return src;
  }, [refresh]);

  const startUpdate = useCallback(async (target: number, sources?: Exclude<Source, "WEB">[]) => {
    const src = follow({ kind: "update", target, inserted: 0, skipped: 0, done: false, error: null }, null);
    // Wait for the stream to connect (bounded), so the run's first events reach this page.
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, 3000);
      src.addEventListener("open", () => { clearTimeout(t); resolve(); }, { once: true });
    });
    try {
      await api.ingest(target, sources);
    } catch (e) {
      src.close();
      setRun((r) => (r ? { ...r, done: true, error: e instanceof ApiError ? e.message : "The update could not start." } : r));
    }
  }, [follow]);

  // The listing is read before the request returns, so its job id is known up front.
  const startListing = useCallback(async (url: string, max: number) => {
    const r = await api.importListing(url, max);
    follow({ kind: "listing", target: r.importing, found: r.found, origin: r.origin, inserted: 0, skipped: 0, done: false, error: null }, r.jobId);
  }, [follow]);

  const clearRun = useCallback(() => setRun(null), []);

  const value = useMemo(
    () => ({ tenders, status, error, threshold, setThreshold, refresh, user, setUser, requireUser, toggleSave, addOpen, setAddOpen, run, startUpdate, startListing, clearRun }),
    [tenders, status, error, threshold, refresh, user, setUser, requireUser, toggleSave, addOpen, run, startUpdate, startListing, clearRun],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore outside StoreProvider");
  return v;
}

/** A notice is referred when it was tried, or its screening score clears the current threshold. */
export function classify(t: TenderSummary, threshold: number): "ruled" | "running" | "referred" | "cleared" {
  if (t.trial_status === "complete" && t.risk_level) return "ruled";
  if (t.trial_status === "running") return "running";
  return (t.screen_score ?? 0) >= threshold ? "referred" : "cleared";
}
