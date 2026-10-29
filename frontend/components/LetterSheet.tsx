"use client";

import { useState } from "react";
import { LANGUAGE } from "@/lib/format";
import type { Letter, Tender } from "@/lib/types";

export function LetterSheet({ letter, tender }: { letter: Letter; tender: Tender }) {
  const bilingual = letter.language !== "en" && letter.body_en && letter.body_en !== letter.body;
  const [lang, setLang] = useState<"orig" | "en">("orig");
  const [copied, setCopied] = useState(false);
  const subject = lang === "orig" ? letter.subject : letter.subject_en;
  const body = lang === "orig" ? letter.body : letter.body_en;
  const full = `${subject}\n\n${body}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  }

  function download() {
    const blob = new Blob([full], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `clarification-${tender.source_id}-${lang === "orig" ? letter.language : "en"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <article className="sheet letter" id="letter" aria-label="Request for clarification">
      <div className="letter-head">
        <h2>REQUEST FOR CLARIFICATION · DRAFT</h2>
        {bilingual && (
          <div className="seg" role="group" aria-label="Letter language">
            <button aria-pressed={lang === "orig"} onClick={() => setLang("orig")}>{LANGUAGE[letter.language] ?? letter.language}</button>
            <button aria-pressed={lang === "en"} onClick={() => setLang("en")}>English</button>
          </div>
        )}
      </div>
      <p className="letter-subject" lang={lang === "orig" ? letter.language : "en"}>{subject}</p>
      <div className="letter-body" lang={lang === "orig" ? letter.language : "en"}>{body}</div>
      <div className="letter-foot">
        <button className="btn btn-ink" onClick={copy}>{copied ? "Copied" : "Copy letter"}</button>
        <button className="btn btn-paper" onClick={download}>Download .txt</button>
        <a className="btn btn-ghost" href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}>Open in mail</a>
        <p>Drafted by the Clerk. Send it through the channel the procurement documents name, before the deadline for questions.</p>
      </div>
    </article>
  );
}
