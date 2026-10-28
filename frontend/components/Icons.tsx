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
