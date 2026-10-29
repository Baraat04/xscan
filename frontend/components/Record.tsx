"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LINES_PER_PAGE, layout, paginate, type Block, type ExhibitMark, type Line } from "@/lib/transcript";

const CHARS_PER_SECOND = 1400;

/** Measures how many monospace columns fit the text column, so wrapping matches the page. */
function useColumns() {
  const probe = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(64);
  useLayoutEffect(() => {
    const el = probe.current;
    if (!el) return;
    const measure = () => {
      const t = el.querySelector(".t") as HTMLElement;
      const s = el.querySelector(".t > span") as HTMLElement;
      const cw = s.getBoundingClientRect().width / 20;
      if (cw > 0) setCols(Math.max(24, Math.min(68, Math.floor(t.getBoundingClientRect().width / cw))));
    };
    // Styles and fonts can land after mount (dev CSS injection, font swap), so re-measure on every signal.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(el.querySelector(".t > span") as HTMLElement);
    void document.fonts?.ready.then(measure);
    const late = setTimeout(measure, 600);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      clearTimeout(late);
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { probe, cols };
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function Record({
  blocks, animate, pending, pendingSince, onExhibit, firstPageHeader, overlay, follow: followCaret = true,
}: {
  blocks: Block[];
  animate: boolean;
  pending: string | null;
  pendingSince: number | null;
  onExhibit: (e: ExhibitMark) => void;
  firstPageHeader?: ReactNode;
  follow?: boolean;
  overlay?: ReactNode;
}) {
  const { probe, cols } = useColumns();
  const lines = useMemo(() => layout(blocks, cols), [blocks, cols]);
  const total = useMemo(() => lines.reduce((a, l) => a + l.chars + 1, 0), [lines]);

  // Typewriter: `shown` chases `total`. On first paint of an existing record, everything is shown at once.
  const [shown, setShown] = useState(animate ? 0 : Number.MAX_SAFE_INTEGER);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setShown(Number.MAX_SAFE_INTEGER);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(total, shownRef.current + ((now - last) / 1000) * CHARS_PER_SECOND);
      last = now;
      setShown(next);
      if (next < total) raf = requestAnimationFrame(tick);
    };
    if (shownRef.current < total) raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total, animate]);

  const typing = shown < total;
  const visible: (Line & { partial?: number })[] = [];
  let budget = shown;
  for (const l of lines) {
    if (budget <= 0) break;
    if (budget >= l.chars + 1) visible.push(l);
    else visible.push({ ...l, partial: Math.floor(budget) });
    budget -= l.chars + 1;
  }
  const showPending = Boolean(pending) && !typing;
  const all = showPending ? [...visible, { runs: [], chars: 0, pending: true } as Line & { pending: true }] : visible;
  const pages = paginate(all.length ? all : [{ runs: [], chars: 0 }]);

  // Follow the caret while the record is being entered, unless the reader scrolled away.
  const tail = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    const desk = document.getElementById("desk");
    if (!desk) return;
    const onScroll = () => {
      follow.current = desk.scrollHeight - desk.scrollTop - desk.clientHeight < 240;
    };
    desk.addEventListener("scroll", onScroll, { passive: true });
    return () => desk.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (followCaret && (typing || showPending) && follow.current) tail.current?.scrollIntoView({ block: "nearest" });
  }, [visible.length, typing, showPending, followCaret]);

  return (
    <>
      {pages.map((page) => (
        <article key={page.number} className="sheet" aria-label={`Transcript page ${page.number}`}>
          <div className="sheet-head">Page {page.number}</div>
          {page.number === 1 && firstPageHeader}
          {page.number === 1 && overlay}
          <div className="record">
            {page.number === 1 && (
              <div className="ln" ref={probe} aria-hidden style={{ position: "absolute", visibility: "hidden", left: 0, right: 0 }}>
                <span className="n" />
                <span className="t"><span>{"0".repeat(20)}</span></span>
              </div>
            )}
            {page.lines.map((l, i) => {
              const n = i + 1;
              const isPending = "pending" in l;
              const isLastTyped = typing && l === visible[visible.length - 1];
              return (
                <div key={i} className={`ln${l.center ? " center" : ""}${isPending ? " pending" : ""}${l.exhibit?.side === "d" ? " side-d" : ""}`} id={l.anchor} data-cite={`${page.number}:${n}`}>
                  <span className="n">{n}</span>
                  <span className="t">
                    {isPending ? (
                      <PendingText text={pending!} since={pendingSince} />
                    ) : (
                      l.href ? <Link href={l.href} className="t-link"><Runs line={l as Line & { partial?: number }} /></Link> : <Runs line={l as Line & { partial?: number }} />
                    )}
                    {isLastTyped && <span className="caret" aria-hidden />}
                  </span>
                  {l.exhibit && (l as { partial?: number }).partial === undefined && (
                    <button className={`sticker ${l.exhibit.side}${l.exhibit.status === "NOT_FOUND" ? " nf" : ""}`} onClick={() => onExhibit(l.exhibit!)} title={`Show exhibit ${l.exhibit.id} in the notice`}>
                      {l.exhibit.id}
                      {l.exhibit.status !== "VERIFIED" && <small>{l.exhibit.status === "APPROXIMATE" ? "APPROX" : "NOT FOUND"}</small>}
                    </button>
                  )}
                </div>
              );
            })}
            {page.number === pages.length && <div ref={tail} />}
          </div>
        </article>
      ))}
      <span className="sr-only" aria-live="polite">{typing ? "" : pending ?? ""}</span>
    </>
  );
}

function Runs({ line }: { line: Line & { partial?: number } }) {
  let left = line.partial ?? Number.MAX_SAFE_INTEGER;
  return (
    <>
      {line.runs.map((r, i) => {
        if (left <= 0) return null;
        const text = r.text.slice(0, left);
        left -= r.text.length;
        return r.tone ? <span key={i} className={r.tone}>{text}</span> : <span key={i}>{text}</span>;
      })}
    </>
  );
}

function PendingText({ text, since }: { text: string; since: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return (
    <>
      {text} <span className="elapsed">{`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`}</span>
    </>
  );
}

export { LINES_PER_PAGE };
