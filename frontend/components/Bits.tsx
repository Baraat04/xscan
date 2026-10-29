"use client";

import { origin } from "@/lib/format";
import type { TenderSummary } from "@/lib/types";
import { Bookmark } from "./Icons";
import { classify, useStore } from "./Store";

type Kind = ReturnType<typeof classify>;

/** Status in plain words. The court's risk level once checked, otherwise what screening concluded. */
export const STATUS_LABEL: Record<Exclude<Kind, "ruled">, string> = { referred: "TO CHECK", running: "CHECKING", cleared: "LOOKS NORMAL" };

export function StatusMark({ t, kind }: { t: TenderSummary; kind: Kind }) {
  if (kind === "ruled") return <span className="mark-typed court"><i aria-hidden>X</i>{t.risk_level} risk</span>;
  if (kind === "running") return <span className="mark-typed live">{STATUS_LABEL.running}</span>;
  if (kind === "referred") return <span className="mark-typed ref">{STATUS_LABEL.referred}</span>;
  return <span className="mark-typed off">{STATUS_LABEL.cleared}</span>;
}

const LEVELS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

/** The court's risk level as the form records it: four printed boxes, the typed X in one. */
export function RiskBoxes({ level, score, review = false, typed = false }: { level: string; score: number; review?: boolean; typed?: boolean }) {
  return (
    <div className={`risk-boxes${typed ? " typed" : ""}`} role="img" aria-label={`Risk ${level}, ${score.toFixed(2)}${review ? ", human review" : ""}`}>
      {LEVELS.map((l) => (
        <span key={l} className={l === level ? "on" : undefined}>
          <i aria-hidden>{l === level ? "X" : ""}</i>
          {l[0] + l.slice(1).toLowerCase()}
          {l === level && <b>{score.toFixed(2)}</b>}
        </span>
      ))}
      {review && <em>Human review</em>}
    </div>
  );
}

/** Where the tender came from: the site, and whether it is an official API or a link a user added. */
export function SourceTag({ t, link = false }: { t: Pick<TenderSummary, "source" | "url">; link?: boolean }) {
  const o = origin(t);
  const body = (
    <>
      
      <b>{o.site}</b>
      <span>{o.kind}</span>
      
    </>
  );
  return link && t.url ? (
    <a className={`source-tag${o.official ? " official" : " web"}`} href={t.url} target="_blank" rel="noreferrer" title="Open the original page">{body}</a>
  ) : (
    <span className={`source-tag${o.official ? " official" : " web"}`}>{body}</span>
  );
}

export function SaveButton({ id, saved, label = false }: { id: string; saved: boolean; label?: boolean }) {
  const { requireUser, toggleSave } = useStore();
  return (
    <button
      className={`save-btn${saved ? " on" : ""}${label ? " labelled" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        requireUser(() => void toggleSave(id));
      }}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved" : "Save this tender"}
      title={saved ? "Saved. Click to remove" : "Save this tender"}
    >
      <Bookmark />
      {label && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
