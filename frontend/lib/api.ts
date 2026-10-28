import type { Examination, Status, Tender, TenderSummary, Trial } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("The xscan server is not reachable. Start the backend on port 4000.", "offline", 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.message ?? `Request failed (${res.status})`, body?.error?.code ?? "error", res.status);
  return body as T;
}

export const api = {
  status: () => call<Status>("/sources/status"),
  tenders: () => call<{ tenders: TenderSummary[] }>("/tenders"),
  tender: (id: string) => call<{ tender: Tender; trials: Pick<Trial, "id" | "status" | "risk_level" | "risk_score" | "started_at">[]; buyerHistory: { id: string; title: string; screen_score: number; status: string; risk_level: string | null }[] }>(`/tenders/${id}`),
  trial: (id: string) => call<{ trial: Trial; examinations: Examination[] }>(`/trials/${id}`),
  startTrial: (tenderId: string) => call<{ trialId: string; resumed: boolean }>(`/tenders/${tenderId}/trials`, { method: "POST" }),
  examine: (trialId: string, agent: Examination["agent"], question: string) =>
    call<Examination>(`/trials/${trialId}/examine`, { method: "POST", body: JSON.stringify({ agent, question }) }),
  ingest: () => call<{ started: boolean }>("/ingest", { method: "POST" }),
};
