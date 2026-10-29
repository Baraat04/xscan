"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { Examination } from "@/lib/types";

const PROMPTS: Record<Examination["agent"], string[]> = {
  defense: ["What document would prove the brand requirement is justified?", "Is there any legitimate reason for the short deadline?"],
  prosecutor: ["Which count is the weakest, and why?", "Would 'or equivalent' wording cure the main count?"],
  court: ["Which single question to the buyer would settle most of the case?", "How would the ruling change if the buyer proves compatibility needs?"],
};

export function ExaminationForm({ trialId, onAnswer }: { trialId: string; onAnswer: (e: Examination) => void }) {
  const [agent, setAgent] = useState<Examination["agent"]>("defense");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(question: string) {
    if (question.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      onAnswer(await api.examine(trialId, agent, question.trim()));
      setQ("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The witness could not answer. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="exam" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
      <h3>EXAMINATION BY THE READER</h3>
      <p>Put a question to any party. The answer is entered into the record and its quotes are checked against the notice.</p>
      <div className="exam-row">
        <select value={agent} onChange={(e) => setAgent(e.target.value as Examination["agent"])} aria-label="Witness">
          <option value="defense">The Defense</option>
          <option value="prosecutor">The Prosecutor</option>
          <option value="court">The Court</option>
        </select>
        <textarea
          rows={1}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(q); } }}
          placeholder="Q. Type your question"
          aria-label="Question"
          maxLength={600}
        />
        <button className="btn btn-ink" type="submit" disabled={busy || q.trim().length < 3}>{busy ? "The witness is answering…" : "Put the question"}</button>
      </div>
      <div className="suggest">
        {PROMPTS[agent].map((p) => <button type="button" key={p} onClick={() => void ask(p)} disabled={busy}>{p}</button>)}
      </div>
      {error && <p className="error-line" role="alert">{error}</p>}
    </form>
  );
}
