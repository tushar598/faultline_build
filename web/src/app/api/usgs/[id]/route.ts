// The USGS record behind an event, for the map and the dataHash check. Real ids: the live USGS ComCat API, with the
// saved real fixture (oracle/fixtures/real-usgs-<id>-detail.geojson) as the offline fallback. Synthetic ids
// (synthetic-*): only the SYNTHETIC fixtures, always labelled as such. Several versions may exist (a revision keeps the
// id), so every candidate is returned and the client picks the one whose dataHash matches the chain.
import path from "node:path";
import type { NextRequest } from "next/server";
import { ORACLE_DIR, SAFE_ID, listDir, localApiEnabled, readJson } from "@/lib/server/repo";
import type { UsgsFeature } from "@/lib/shared";
import type { UsgsRecord } from "@/lib/types";

const FIXTURES = path.join(ORACLE_DIR, "fixtures");
const USGS = "https://earthquake.usgs.gov/fdsnws/event/1/query";

async function live(id: string): Promise<UsgsFeature | null> {
  try {
    const res = await fetch(`${USGS}?eventid=${encodeURIComponent(id)}&format=geojson`, { signal: AbortSignal.timeout(6_000), cache: "no-store" });
    if (res.status !== 200) return null; // FDSN "nodata" is 204
    const f = (await res.json()) as UsgsFeature;
    return f?.type === "Feature" && f.id ? f : null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/usgs/[id]">) {
  const { id } = await ctx.params;
  if (!SAFE_ID.test(id)) return Response.json({ error: "Invalid event id." }, { status: 400 });
  const records: UsgsRecord[] = [];
  // Saved fixtures come from the local checkout, so they are read only where the local routes are enabled (SEC-10).
  const local = localApiEnabled();
  if (id.startsWith("synthetic-")) {
    if (!local) return Response.json({ error: "SYNTHETIC records exist only on the local network." }, { status: 404 });
    for (const file of (await listDir(FIXTURES)).filter((f) => /^synthetic-[\w.-]+\.geojson$/.test(f)).sort()) {
      const f = await readJson<UsgsFeature>(path.join(FIXTURES, file));
      if (f && f.id === id) records.push({ source: "synthetic", file, feature: f });
    }
  } else {
    const l = await live(id);
    if (l) records.push({ source: "live", file: null, feature: l });
    const file = `real-usgs-${id}-detail.geojson`;
    const saved = local ? await readJson<UsgsFeature>(path.join(FIXTURES, file)) : null;
    if (saved && saved.id === id) records.push({ source: "saved", file, feature: saved });
  }
  if (records.length === 0) return Response.json({ error: `No USGS record found for ${id}.` }, { status: 404 });
  return Response.json({ id, records });
}
