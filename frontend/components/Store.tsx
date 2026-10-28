"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { Status, TenderSummary } from "@/lib/types";

interface StoreValue {
  tenders: TenderSummary[] | null;
  status: Status | null;
  error: string | null;
  threshold: number;
  setThreshold: (n: number) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

const DEFAULT_THRESHOLD = 0.35;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [tenders, setTenders] = useState<TenderSummary[] | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Session-only on purpose: every visit starts from the documented default, and SSR markup always matches.
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);

  const refresh = useCallback(async () => {
    try {
      const [t, s] = await Promise.all([api.tenders(), api.status()]);
      setTenders(t.tenders);
      setStatus(s);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load the docket.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);

  const value = useMemo(() => ({ tenders, status, error, threshold, setThreshold, refresh }), [tenders, status, error, threshold, setThreshold, refresh]);
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
