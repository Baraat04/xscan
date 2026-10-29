"use client";

import { useEffect, useRef } from "react";

export type Channel = "p" | "d" | "c";
const CHANNELS: Channel[] = ["p", "d", "c"];
const N = 120;

/**
 * Three recorder channels, one per agent. A channel swings while its agent is speaking (level near 1),
 * murmurs while it thinks, and lies flat when idle. Drawn on canvas so it can run all the time cheaply.
 */
export function Traces({ levels, height = 72, label = true }: { levels: Record<Channel, number>; height?: number | string; label?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef(levels);
  live.current = levels;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const css = getComputedStyle(el);
    const ink: Record<Channel, string> = { p: css.getPropertyValue("--ch-p").trim(), d: css.getPropertyValue("--ch-d").trim(), c: css.getPropertyValue("--ch-c").trim() };
    const data: Record<Channel, number[]> = { p: Array(N).fill(0), d: Array(N).fill(0), c: Array(N).fill(0) };
    const phase: Record<Channel, number> = { p: 0, d: 1.7, c: 3.1 };
    let raf = 0;
    let last = 0;

    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 40) return; // ~25 fps is plenty for a pen trace
      last = t;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const lane = h / 3;
      CHANNELS.forEach((ch, i) => {
        const lvl = Math.max(0, Math.min(1, live.current[ch]));
        phase[ch] += 0.35 + lvl * 0.6;
        const noise = (Math.sin(phase[ch]) * 0.6 + Math.sin(phase[ch] * 2.3) * 0.3 + (Math.random() - 0.5) * 0.8) * lvl;
        data[ch].push(reduce ? 0 : noise);
        data[ch].shift();
        const mid = lane * i + lane / 2;
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, mid);
        ctx.lineTo(w, mid);
        ctx.stroke();
        ctx.strokeStyle = ink[ch];
        ctx.globalAlpha = 0.35 + lvl * 0.65;
        ctx.lineWidth = 1.6;
        ctx.lineJoin = "round";
        ctx.beginPath();
        data[ch].forEach((v, x) => {
          const px = (x / (N - 1)) * w;
          const py = mid - v * (lane * 0.42);
          if (x === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="traces" style={{ height }}>
      {label && (
        <ol className="traces-key" aria-hidden>
          <li className="p">PROS</li>
          <li className="d">DEF</li>
          <li className="c">COURT</li>
        </ol>
      )}
      <canvas ref={canvas} role="img" aria-label="Activity of the prosecutor, defense and court channels" />
    </div>
  );
}
