"use client";
import { useState } from "react";
import { curvePoints } from "@/lib/issuer/terms";

const W = 520;
const H = 180;
const PAD = { l: 40, r: 12, t: 12, b: 28 };

/** Payout curve of the terms: loss of principal (%) against magnitude, every point from shared/ts lossBpsFor.
 *  One series, 2 px line, recessive grid, crosshair with the value on hover, and the values as a table below. */
export function CurvePreview({ floorMagX100, ceilMagX100 }: { floorMagX100: number; ceilMagX100: number }) {
  const pts = curvePoints({ floorMagX100, ceilMagX100 });
  const [hover, setHover] = useState<number | null>(null);
  const x0 = pts[0]!.magX100;
  const x1 = pts[pts.length - 1]!.magX100;
  const sx = (m: number) => PAD.l + ((m - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (bps: number) => PAD.t + (1 - bps / 10_000) * (H - PAD.t - PAD.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.magX100).toFixed(1)},${sy(p.lossBps).toFixed(1)}`).join(" ");
  const ticksX = pts.filter((p) => p.magX100 % 50 === 0);
  const h = hover === null ? null : pts[hover]!;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const m = x0 + ((((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r)) * (x1 - x0);
    let best = 0;
    pts.forEach((p, i) => {
      if (Math.abs(p.magX100 - m) < Math.abs(pts[best]!.magX100 - m)) best = i;
    });
    setHover(best);
  };
  return (
    <figure>
      <figcaption className="mb-1 text-xs font-medium text-neutral-800">Payout curve: loss of principal by magnitude</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Loss rises linearly from 0% at M${(floorMagX100 / 100).toFixed(2)} to 100% at M${(ceilMagX100 / 100).toFixed(2)}`} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
          {[0, 2500, 5000, 7500, 10000].map((b) => (
            <g key={b}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(b)} y2={sy(b)} stroke="var(--color-neutral-200)" strokeWidth={1} />
              <text x={PAD.l - 6} y={sy(b) + 3} textAnchor="end" className="fill-neutral-700 text-[10px]">
                {b / 100}%
              </text>
            </g>
          ))}
          {ticksX.map((p) => (
            <text key={p.magX100} x={sx(p.magX100)} y={H - 10} textAnchor="middle" className="fill-neutral-700 text-[10px]">
              M{(p.magX100 / 100).toFixed(1)}
            </text>
          ))}
          <path d={d} fill="none" stroke="var(--color-accent-600)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {h && (
            <g>
              <line x1={sx(h.magX100)} x2={sx(h.magX100)} y1={PAD.t} y2={H - PAD.b} stroke="var(--color-neutral-400)" strokeWidth={1} />
              <circle cx={sx(h.magX100)} cy={sy(h.lossBps)} r={4} fill="var(--color-accent-600)" stroke="var(--color-white)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && (
          <div className="num pointer-events-none absolute top-1 right-2 rounded-sm border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-900 shadow-card">
            M{(h.magX100 / 100).toFixed(2)}: {h.lossBps.toLocaleString("en-US")} bps ({(h.lossBps / 100).toFixed(2)}%)
          </div>
        )}
      </div>
      <details className="mt-1 text-xs text-neutral-700">
        <summary className="cursor-pointer">Values as a table</summary>
        <table className="num mt-1 w-full max-w-sm text-left">
          <thead>
            <tr className="text-neutral-800">
              <th className="py-0.5 font-medium">Magnitude</th>
              <th className="py-0.5 font-medium">Loss (bps)</th>
            </tr>
          </thead>
          <tbody>
            {pts.filter((p) => p.magX100 % 10 === 0).map((p) => (
              <tr key={p.magX100} className="border-t border-neutral-100">
                <td className="py-0.5">M{(p.magX100 / 100).toFixed(2)}</td>
                <td className="py-0.5">{p.lossBps.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
