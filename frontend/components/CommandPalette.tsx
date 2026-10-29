"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { origin } from "@/lib/format";
import { Search } from "./Icons";
import { classify, useStore } from "./Store";

interface Item {
  id: string;
  label: string;
  hint: string;
  group: "Go to" | "Actions" | "Tenders";
  run: () => void;
}

/** ⌘K / Ctrl+K: jump to any page, run an action, or open a tender by typing part of its title. */
export function CommandPalette() {
  const router = useRouter();
  const { tenders, threshold, requireUser, setAddOpen, startUpdate } = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("xscan:palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("xscan:palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setAt(0);
    requestAnimationFrame(() => input.current?.focus());
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => router.push(href);
    const base: Item[] = [
      { id: "court", label: "Live court", hint: "Watch the prosecutor, defense and court argue", group: "Go to", run: go("/court") },
      { id: "docket", label: "Tenders", hint: "Every tender on file", group: "Go to", run: go("/docket") },
      { id: "check", label: "Tenders to check", hint: "Screening found warning signs", group: "Go to", run: go("/docket?status=referred") },
      { id: "saved", label: "Saved tenders", hint: "The ones you follow", group: "Go to", run: go("/saved") },
      { id: "how", label: "How it works", hint: "Sources, rules and the three agents", group: "Go to", run: go("/how") },
      { id: "add", label: "Add tenders", hint: "By count, by link or from a whole website", group: "Actions", run: () => requireUser(() => setAddOpen(true)) },
      { id: "update", label: "Update from official sources", hint: "Fetch the newest TED and USAspending tenders", group: "Actions", run: () => requireUser(() => void startUpdate(120)) },
    ];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? base.filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(needle)) : base;
    const found = needle.length >= 2
      ? (tenders ?? []).filter((t) => `${t.title} ${t.buyer_name ?? ""} ${t.source_id}`.toLowerCase().includes(needle)).slice(0, 8).map<Item>((t) => ({
          id: t.id,
          label: t.title,
          hint: `${origin(t).site} · ${classify(t, threshold) === "ruled" ? `${t.risk_level} risk` : (t.screen_score ?? 0).toFixed(2)}`,
          group: "Tenders",
          run: go(`/case/${t.id}`),
        }))
      : [];
    return [...filtered, ...found];
  }, [q, tenders, threshold, router, requireUser, setAddOpen, startUpdate]);

  useEffect(() => {
    setAt(0);
  }, [q]);
  if (!open) return null;

  const pick = (i: Item | undefined) => {
    if (!i) return;
    setOpen(false);
    i.run();
  };

  return (
    <div className="palette-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <label className="palette-input">
          <Search />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAt((a) => Math.min(items.length - 1, a + 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setAt((a) => Math.max(0, a - 1)); }
              if (e.key === "Enter") pick(items[at]);
            }}
            placeholder="Jump to a page, run an action, or search tenders"
            aria-label="Search commands and tenders"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={items[at] ? `pal-${items[at].id}` : undefined}
          />
          <kbd>esc</kbd>
        </label>
        <ul id="palette-list" role="listbox" className="palette-list">
          {items.length === 0 && <li className="palette-empty">Nothing matches “{q}”.</li>}
          {items.map((i, n) => (
            <li key={i.id} id={`pal-${i.id}`} role="option" aria-selected={n === at} onMouseEnter={() => setAt(n)} onMouseDown={(e) => { e.preventDefault(); pick(i); }}>
              {(n === 0 || items[n - 1].group !== i.group) && <span className="palette-group">{i.group}</span>}
              <span className="palette-row">
                <b>{i.label}</b>
                <small>{i.hint}</small>
              </span>
            </li>
          ))}
        </ul>
        <footer className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>⌘</kbd><kbd>K</kbd> toggle</span></footer>
      </div>
    </div>
  );
}
