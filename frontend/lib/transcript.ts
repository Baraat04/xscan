// Layout engine for the stenographic record. Text is wrapped to a fixed column count
// so every visual line has a real line number and every exhibit a page:line citation.

export type Tone = "speaker" | "quote" | "pencil" | "muted" | "strong" | "struck" | "spaced";

export interface Run {
  text: string;
  tone?: Tone;
}

export interface ExhibitMark {
  id: string; // P-1, D-2, A
  side: "p" | "d";
  quote: string;
  status: "VERIFIED" | "APPROXIMATE" | "NOT_FOUND";
  sectionKey: string | null;
  start: number;
  end: number;
}

export type Block =
  | { kind: "center"; text: string; tone?: Tone; anchor?: string }
  | { kind: "speech"; speaker: string; runs: Run[]; anchor?: string }
  | { kind: "paren"; runs: Run[]; exhibit?: ExhibitMark; anchor?: string }
  | { kind: "qa"; mark: "Q." | "A."; runs: Run[]; anchor?: string }
  | { kind: "leader"; left: string; right: string; tone?: Tone; anchor?: string; href?: string }
  | { kind: "blank" };

export interface Line {
  runs: Run[];
  center?: boolean;
  exhibit?: ExhibitMark;
  anchor?: string;
  href?: string;
  chars: number;
}

export interface Page {
  number: number;
  lines: Line[];
}

export const LINES_PER_PAGE = 25;
const INDENT = 10;

type Cell = { ch: string; tone?: Tone };

function cells(runs: Run[]): Cell[] {
  const out: Cell[] = [];
  for (const r of runs) for (const ch of r.text) out.push({ ch, tone: r.tone });
  return out;
}

function toRuns(cs: Cell[]): Run[] {
  const runs: Run[] = [];
  for (const c of cs) {
    const last = runs[runs.length - 1];
    if (last && last.tone === c.tone) last.text += c.ch;
    else runs.push({ text: c.ch, tone: c.tone });
  }
  return runs;
}

/** Greedy word wrap over styled cells. `first` is the width of line one, `rest` the width after. */
function wrap(cs: Cell[], first: number, rest: number): Cell[][] {
  const lines: Cell[][] = [];
  const paragraphs: Cell[][] = [[]];
  for (const c of cs) {
    if (c.ch === "\n") paragraphs.push([]);
    else paragraphs[paragraphs.length - 1].push(c);
  }
  for (const para of paragraphs) {
    let line: Cell[] = [];
    let i = 0;
    const width = () => (lines.length === 0 ? first : rest);
    while (i < para.length) {
      // next word incl. trailing spaces
      let j = i;
      while (j < para.length && para[j].ch !== " ") j++;
      while (j < para.length && para[j].ch === " ") j++;
      const word = para.slice(i, j);
      const wordLen = word.filter((c) => c.ch !== " ").length + (line.length ? 0 : 0);
      const trimmedLineLen = line.length;
      if (trimmedLineLen + wordLen > width() && line.length) {
        lines.push(trimLine(line));
        line = [];
        continue;
      }
      if (wordLen > width()) {
        // hard-break a word longer than the line
        lines.push(word.slice(0, width()));
        i += width();
        continue;
      }
      line.push(...word);
      i = j;
    }
    lines.push(trimLine(line));
  }
  return lines;
}

const trimLine = (l: Cell[]) => {
  let e = l.length;
  while (e > 0 && l[e - 1].ch === " ") e--;
  return l.slice(0, e);
};

const pad = (n: number): Cell[] => Array.from({ length: n }, () => ({ ch: " " }));

export function layout(blocks: Block[], cols: number): Line[] {
  const out: Line[] = [];
  const push = (cs: Cell[], extra: Partial<Line> = {}) => out.push({ runs: toRuns(cs), chars: cs.length, ...extra });

  for (const b of blocks) {
    switch (b.kind) {
      case "blank":
        push([]);
        break;
      case "center": {
        const ls = wrap(cells([{ text: b.text, tone: b.tone }]), cols, cols);
        ls.forEach((l, i) => push(l, { center: true, anchor: i === 0 ? b.anchor : undefined }));
        break;
      }
      case "speech": {
        const head = cells([{ text: `${" ".repeat(INDENT)}${b.speaker}:`, tone: "speaker" }, { text: "  " }]);
        const ls = wrap(cells(b.runs), cols - head.length, cols);
        ls.forEach((l, i) => push(i === 0 ? [...head, ...l] : l, { anchor: i === 0 ? b.anchor : undefined }));
        break;
      }
      case "qa": {
        const head = cells([{ text: `${" ".repeat(INDENT - 5)}${b.mark}`, tone: "speaker" }, { text: "   " }]);
        const ls = wrap(cells(b.runs), cols - head.length, cols);
        ls.forEach((l, i) => push(i === 0 ? [...head, ...l] : l, { anchor: i === 0 ? b.anchor : undefined }));
        break;
      }
      case "paren": {
        const ls = wrap(cells(b.runs), cols - INDENT, cols - INDENT);
        ls.forEach((l, i) => push([...pad(INDENT), ...l], { exhibit: i === 0 ? b.exhibit : undefined, anchor: i === 0 ? b.anchor : undefined }));
        break;
      }
      case "leader": {
        const right = ` ${b.right}`;
        const room = cols - right.length - 2;
        const left = b.left.length > room ? `${b.left.slice(0, room - 1)}…` : b.left;
        const dots = Math.max(2, cols - left.length - right.length - 1);
        push(cells([{ text: `${left} ` }, { text: ".".repeat(dots), tone: "muted" }, { text: right, tone: b.tone ?? "strong" }]), { anchor: b.anchor, href: b.href });
        break;
      }
    }
  }
  return out;
}

export function paginate(lines: Line[]): Page[] {
  const pages: Page[] = [];
  lines.forEach((l, i) => {
    const p = Math.floor(i / LINES_PER_PAGE);
    (pages[p] ??= { number: p + 1, lines: [] }).lines.push(l);
  });
  return pages;
}

/** page:line citations for every anchored line. */
export function citations(lines: Line[]): Record<string, string> {
  const map: Record<string, string> = {};
  lines.forEach((l, i) => {
    if (l.anchor && !map[l.anchor]) map[l.anchor] = `${Math.floor(i / LINES_PER_PAGE) + 1}:${(i % LINES_PER_PAGE) + 1}`;
  });
  return map;
}
