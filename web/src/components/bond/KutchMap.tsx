import type { Terms } from "@/lib/shared";

const LON = { min: 67.5, max: 72.5 };
const LAT = { min: 21.5, max: 25.5 };
const W = 500;
const H = 400;
const x = (lon: number) => ((lon - LON.min) / (LON.max - LON.min)) * W;
const y = (lat: number) => H - ((lat - LAT.min) / (LAT.max - LAT.min)) * H;

/** Schematic of the insured box with the epicentre: coordinates only, no basemap (nothing drawn that we do not have). */
export function KutchMap({ box, epicentre, label }: { box: Terms["box"]; epicentre: { lat: number; lon: number } | null; label?: string }) {
  const inside = epicentre ? epicentre.lat >= box.minLat && epicentre.lat <= box.maxLat && epicentre.lon >= box.minLon && epicentre.lon <= box.maxLon : null;
  return (
    <figure>
      <svg viewBox={`-50 -12 ${W + 80} ${H + 40}`} className="w-full" role="img" aria-label={`Insured box ${box.minLat} to ${box.maxLat} N, ${box.minLon} to ${box.maxLon} E${epicentre ? `; epicentre ${epicentre.lat} N ${epicentre.lon} E, ${inside ? "inside" : "outside"} the box` : ""}`}>
        <rect x={0} y={0} width={W} height={H} className="fill-neutral-50 stroke-neutral-200" />
        {Array.from({ length: LON.max - LON.min + 1 }, (_, i) => LON.min + i).map((lon) => (
          <g key={`lon${lon}`}>
            <line x1={x(lon)} x2={x(lon)} y1={0} y2={H} className="stroke-neutral-200" strokeDasharray="2 4" />
            <text x={x(lon)} y={H + 16} textAnchor="middle" className="num fill-neutral-700 text-[11px]">
              {lon.toFixed(1)} E
            </text>
          </g>
        ))}
        {Array.from({ length: LAT.max - LAT.min + 1 }, (_, i) => LAT.min + i).map((lat) => (
          <g key={`lat${lat}`}>
            <line x1={0} x2={W} y1={y(lat)} y2={y(lat)} className="stroke-neutral-200" strokeDasharray="2 4" />
            <text x={-6} y={y(lat) + 4} textAnchor="end" className="num fill-neutral-700 text-[11px]">
              {lat.toFixed(1)} N
            </text>
          </g>
        ))}
        <rect x={x(box.minLon)} y={y(box.maxLat)} width={x(box.maxLon) - x(box.minLon)} height={y(box.minLat) - y(box.maxLat)} className="fill-accent-50 stroke-accent-600" strokeWidth={1.5} />
        <text x={x(box.minLon) + 8} y={y(box.maxLat) + 18} className="fill-accent-800 text-[12px] font-semibold">
          Insured box (Kutch, Gujarat)
        </text>
        {epicentre && (
          <g transform={`translate(${x(epicentre.lon)} ${y(epicentre.lat)})`}>
            <circle r={18} className="fill-none stroke-error-500" strokeWidth={1} opacity={0.5} />
            <circle r={9} className="fill-none stroke-error-500" strokeWidth={1.25} />
            <circle r={3.5} className="fill-error-500" />
            {label && (
              <text x={14} y={-14} className="fill-neutral-900 text-[12px] font-medium">
                {label}
              </text>
            )}
          </g>
        )}
      </svg>
      <figcaption className="mt-1 text-xs text-neutral-700">Schematic: box and epicentre plotted from coordinates only, no basemap. The box is an approximate rectangle, not an official boundary.</figcaption>
    </figure>
  );
}
