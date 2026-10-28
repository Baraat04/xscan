import type { NoticeSection } from "../adapters/base.js";

export interface QuoteCheck {
  status: "VERIFIED" | "APPROXIMATE" | "NOT_FOUND";
  sectionKey: string | null;
  start: number;
  end: number;
}

const norm = (s: string) => s.toLowerCase().replace(/[“”„"«»]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();

/** Maps an index in the normalised string back to the original string. */
function mapIndex(original: string, normIndex: number): number {
  let n = 0;
  let prevSpace = true;
  for (let i = 0; i < original.length; i++) {
    const isSpace = /\s/.test(original[i]);
    if (isSpace && prevSpace) continue;
    if (n === normIndex) return i;
    n++;
    prevSpace = isSpace;
  }
  return original.length;
}

/**
 * Anti-hallucination check: every quote an agent cites must exist in the notice.
 * Exact (whitespace/case-insensitive) match is VERIFIED; a long shared word run is APPROXIMATE.
 */
export function verifyQuote(quote: string, sections: NoticeSection[]): QuoteCheck {
  const q = norm(quote.replace(/^[.…\s"]+|[.…\s"]+$/g, ""));
  if (q.length < 6) return { status: "NOT_FOUND", sectionKey: null, start: 0, end: 0 };
  for (const s of sections) {
    const text = norm(s.text);
    const i = text.indexOf(q);
    if (i >= 0) {
      const lead = s.text.length - s.text.trimStart().length;
      const start = mapIndex(s.text.trimStart(), i) + lead;
      const end = mapIndex(s.text.trimStart(), i + q.length - 1) + lead + 1;
      return { status: "VERIFIED", sectionKey: s.key, start, end };
    }
  }
  // Fallback: longest run of consecutive quote words found in a section.
  const words = q.split(" ");
  let best = { len: 0, key: null as string | null, start: 0, end: 0 };
  for (const s of sections) {
    const text = norm(s.text);
    for (let a = 0; a < words.length; a++) {
      for (let b = words.length; b > a + best.len; b--) {
        const frag = words.slice(a, b).join(" ");
        const i = text.indexOf(frag);
        if (i >= 0) {
          const lead = s.text.length - s.text.trimStart().length;
          best = { len: b - a, key: s.key, start: mapIndex(s.text.trimStart(), i) + lead, end: mapIndex(s.text.trimStart(), i + frag.length - 1) + lead + 1 };
          break;
        }
      }
    }
  }
  if (best.len >= Math.max(4, Math.ceil(words.length * 0.6))) {
    return { status: "APPROXIMATE", sectionKey: best.key, start: best.start, end: best.end };
  }
  return { status: "NOT_FOUND", sectionKey: null, start: 0, end: 0 };
}
