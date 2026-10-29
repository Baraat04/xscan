import type { Examination, Source, Status, Tender, TenderSummary, Trial, User } from "./types";

export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1";

export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // The session is an httpOnly cookie, so every call carries credentials. Writes always send a JSON body.
    res = await fetch(`${API}${path}`, {
      ...init,
      credentials: "include",
      body: init?.body ?? (init?.method && init.method !== "GET" ? "{}" : undefined),
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
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
  ingest: (target: number, sources?: Exclude<Source, "WEB">[]) => call<{ started: boolean; target: number }>("/ingest", { method: "POST", body: JSON.stringify({ target, sources }) }),
  importOne: (body: { url?: string; text?: string }) => call<{ id: string; existing: boolean }>("/import/one", { method: "POST", body: JSON.stringify(body) }),
  importListing: (url: string, max: number) => call<{ jobId: string; found: number; importing: number; origin: string }>("/import/listing", { method: "POST", body: JSON.stringify({ url, max }) }),
  me: () => call<{ user: User | null }>("/auth/me"),
  signup: (name: string, email: string, password: string) => call<{ user: User }>("/auth/signup", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  login: (email: string, password: string) => call<{ user: User }>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => call<{ ok: true }>("/auth/logout", { method: "POST" }),
  save: (id: string) => call<{ saved: boolean }>(`/tenders/${id}/save`, { method: "PUT" }),
  unsave: (id: string) => call<{ saved: boolean }>(`/tenders/${id}/save`, { method: "DELETE" }),
};
