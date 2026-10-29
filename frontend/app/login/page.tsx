"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { useStore } from "@/components/Store";
import { api, ApiError } from "@/lib/api";

function LoginForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { setUser } = useStore();
  const [mode, setMode] = useState<"login" | "signup">(params.get("mode") === "signup" ? "signup" : "login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only same-site paths, so the redirect can't be pointed at another website.
  const raw = params.get("next") ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") && !raw.startsWith("/login") ? raw : "/";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = mode === "signup" ? await api.signup(name, email, password) : await api.login(email, password);
      setUser(r.user);
      router.replace(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page auth-page">
      <article className="sheet auth-card">
        <h1>{mode === "signup" ? "Create your account" : "Sign in"}</h1>
        <p className="auth-lead">
          {mode === "signup"
            ? "Free. You can then check tenders with AI, add tenders from any website and save the ones you follow."
            : "Welcome back. Sign in to check tenders and see your saved ones."}
        </p>
        <div className="seg auth-seg" role="group" aria-label="Account">
          <button type="button" aria-pressed={mode === "login"} onClick={() => setMode("login")}>Sign in</button>
          <button type="button" aria-pressed={mode === "signup"} onClick={() => setMode("signup")}>Create account</button>
        </div>
        <form onSubmit={submit} className="add-form">
          {mode === "signup" && (
            <label className="field">
              <span>Your name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required maxLength={80} />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <label className="field">
            <span>Password {mode === "signup" && <small>(at least 8 characters)</small>}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : 1} />
          </label>
          {error && <p className="error-line" role="alert">{error}</p>}
          <button className="btn btn-ink btn-lg" disabled={busy}>{busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        <p className="auth-foot">You can browse tenders without an account. <Link href="/docket">See the tenders</Link></p>
      </article>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="page auth-page" />}>
      <LoginForm />
    </Suspense>
  );
}
