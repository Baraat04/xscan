import type { SVGProps } from "react";

// One stroke family: 1.6px, round caps, 20px grid.
const base = { width: 20, height: 20, viewBox: "0 0 20 20", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export const Search = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>);
export const Collect = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M3 12v4h14v-4" /><path d="M10 3v9" /><path d="m6.5 8.5 3.5 3.5 3.5-3.5" /></svg>);
export const External = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M11 3h6v6" /><path d="M17 3 9 11" /><path d="M14 12v4H4V6h4" /></svg>);
export const Copy = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><rect x="7" y="7" width="10" height="10" rx="1" /><path d="M13 4H4v9" /></svg>);
export const Download = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M10 3v10" /><path d="m6 9 4 4 4-4" /><path d="M4 17h12" /></svg>);
export const Mail = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><rect x="3" y="5" width="14" height="10" rx="1" /><path d="m3.5 5.5 6.5 5 6.5-5" /></svg>);
export const Close = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="m5 5 10 10M15 5 5 15" /></svg>);
export const Check = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="m4 10.5 4 4 8-9" /></svg>);
export const Alert = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M10 3 2.5 16.5h15z" /><path d="M10 8v4" /><path d="M10 14.5v.01" /></svg>);
export const Back = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M12 4 6 10l6 6" /></svg>);
export const Gavel = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="m7.5 4.5 5 5" /><path d="m5.5 6.5 5-5 3 3-5 5z" /><path d="m10 10 6.5 6.5" /><path d="M3 17h7" /></svg>);
export const Replay = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M4 10a6 6 0 1 0 2-4.5" /><path d="M4 3v3h3" /></svg>);
export const Doc = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M5 2.5h7l3 3v12H5z" /><path d="M8 9h5M8 12h5M8 15h3" /></svg>);
export const Bookmark = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M5.5 3h9v14l-4.5-3.5L5.5 17z" /></svg>);
export const Plus = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M10 4v12M4 10h12" /></svg>);
export const Refresh = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M16 10a6 6 0 1 1-2-4.5" /><path d="M16 3v3.5h-3.5" /></svg>);
export const LinkIcon = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M8.5 11.5a3 3 0 0 0 4.2 0l2.6-2.6a3 3 0 0 0-4.2-4.2l-1 1" /><path d="M11.5 8.5a3 3 0 0 0-4.2 0l-2.6 2.6a3 3 0 0 0 4.2 4.2l1-1" /></svg>);
export const Globe = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><circle cx="10" cy="10" r="7" /><path d="M3 10h14M10 3c2.2 2.2 2.2 11.8 0 14M10 3c-2.2 2.2-2.2 11.8 0 14" /></svg>);
export const Person = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><circle cx="10" cy="7" r="3.2" /><path d="M3.5 17c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" /></svg>);
/** The xscan mark: three channel bars of different heights, prosecution, defense and court, on one baseline. */
export const Mark = (p: SVGProps<SVGSVGElement>) => (
  <svg width={22} height={22} viewBox="0 0 22 22" aria-hidden {...p}>
    <rect x="2" y="7" width="4.5" height="13" rx="1.5" fill="var(--ch-p)" />
    <rect x="8.75" y="2" width="4.5" height="18" rx="1.5" fill="var(--ch-c)" />
    <rect x="15.5" y="10" width="4.5" height="10" rx="1.5" fill="var(--ch-d)" />
  </svg>
);
export const Bolt = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M11 2 4 11.5h5L8 18l7-9.5h-5z" /></svg>);
export const Shield = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M10 2.5 4 5v4.5c0 4 2.6 6.9 6 8 3.4-1.1 6-4 6-8V5z" /></svg>);
export const Scale = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M10 3v14M6 17h8M4 6h12" /><path d="m4 6-2.5 5.5a2.5 2.5 0 0 0 5 0zM16 6l-2.5 5.5a2.5 2.5 0 0 0 5 0z" /></svg>);
export const Play = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M6 4.5v11l9-5.5z" /></svg>);
export const Terminal = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><rect x="2.5" y="3.5" width="15" height="13" rx="2" /><path d="m6 8 2.5 2L6 12M10.5 12.5H14" /></svg>);
export const ArrowRight = (p: SVGProps<SVGSVGElement>) => (<svg {...base} {...p}><path d="M4 10h12M11 5l5 5-5 5" /></svg>);
