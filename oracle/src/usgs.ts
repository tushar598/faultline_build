// USGS ComCat client (FDSN event service, https://earthquake.usgs.gov/fdsnws/event/1/; docs/reference/usgs.md):
//   detail(id)  GET query?eventid=<id>&format=geojson — any associated id works and returns the PREFERRED feature (U11)
//   search(...) GET query?format=geojson&starttime&endtime&minlatitude&maxlatitude&minlongitude&maxlongitude
//               &minmagnitude&eventtype=earthquake&orderby=time
// Answers used: 200 + GeoJSON; 409 = deleted event (by eventid); 404 or 204 = no data (FDSN `nodata`, default 204).
// Every response is checked with zod before use. Network errors, timeouts, 429 and 5xx are retried with exponential
// backoff; 4xx answers are not.
import { z } from "zod";
import type { UsgsFeature } from "../../shared/ts/attestation.js";
import { log } from "./log.js";

export const USER_AGENT = "faultline-oracle/0.1.0 (parametric catastrophe bond prototype; read-only ComCat client)";

/** The fields Faultline reads (ARCHITECTURE §6.2, §6.4); everything else is kept but not trusted. */
export const FeatureSchema = z.looseObject({
  type: z.literal("Feature"),
  id: z.string().min(1),
  properties: z.looseObject({
    time: z.number().int(),
    updated: z.number().int(),
    mag: z.number().nullable(),
    magType: z.string().nullable(),
    status: z.string(),
    type: z.string(),
    ids: z.string(),
    net: z.string(),
    code: z.string(),
  }),
  geometry: z.looseObject({
    type: z.literal("Point"),
    coordinates: z.tuple([z.number(), z.number(), z.number()]),
  }),
});
export const FeatureCollectionSchema = z.looseObject({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

/** A parsed USGS feature. `mag` / `magType` may be null in ComCat; rule.ts rejects such records. */
export type Feature = z.infer<typeof FeatureSchema>;

/** Every id of a record: the preferred `id` plus `properties.ids` (which has leading and trailing commas). */
export function idsOf(f: Pick<Feature, "id" | "properties">): string[] {
  const list = f.properties.ids.split(",").map((s) => s.trim()).filter(Boolean);
  return [...new Set([f.id, ...list])];
}

/** The shape shared/ts expects (mag and magType non-null); null when the record cannot be scored. */
export function asUsgsFeature(f: Feature): UsgsFeature | null {
  if (f.properties.mag === null || f.properties.magType === null) return null;
  return f as unknown as UsgsFeature;
}

export function parseFeature(json: unknown): Feature {
  const r = FeatureSchema.safeParse(json);
  if (!r.success) throw new Error(`malformed USGS feature: ${z.prettifyError(r.error)}`);
  return r.data;
}

export type DetailResult = { kind: "ok"; feature: Feature } | { kind: "deleted" } | { kind: "not-found" };
export type SearchArgs = { start: Date; end: Date; box: { minLat: number; maxLat: number; minLon: number; maxLon: number }; minMagnitude: number };

export type UsgsClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  retries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export class UsgsClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(private readonly o: UsgsClientOptions) {
    this.fetchImpl = o.fetchImpl ?? fetch;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One event by any of its ids. */
  async detail(id: string): Promise<DetailResult> {
    const url = `${this.o.baseUrl}?${new URLSearchParams({ eventid: id, format: "geojson" })}`;
    const res = await this.get(url);
    if (res.status === 409) return { kind: "deleted" };
    if (res.status === 404 || res.status === 204) return { kind: "not-found" };
    return { kind: "ok", feature: parseFeature(res.json) };
  }

  /** Earthquakes in a box and time window at or above a magnitude, newest first. Malformed features are skipped
   *  with a warning (one bad record must not hide the others). */
  async search(a: SearchArgs): Promise<Feature[]> {
    const q = new URLSearchParams({
      format: "geojson",
      starttime: a.start.toISOString(),
      endtime: a.end.toISOString(),
      minlatitude: String(a.box.minLat),
      maxlatitude: String(a.box.maxLat),
      minlongitude: String(a.box.minLon),
      maxlongitude: String(a.box.maxLon),
      minmagnitude: String(a.minMagnitude),
      eventtype: "earthquake",
      orderby: "time",
    });
    const res = await this.get(`${this.o.baseUrl}?${q}`);
    if (res.status === 204 || res.status === 404) return [];
    const fc = FeatureCollectionSchema.safeParse(res.json);
    if (!fc.success) throw new Error(`malformed USGS search result: ${z.prettifyError(fc.error)}`);
    const out: Feature[] = [];
    for (const raw of fc.data.features) {
      const r = FeatureSchema.safeParse(raw);
      if (r.success) out.push(r.data);
      else log.warn("USGS search: skipping a malformed feature", { id: (raw as { id?: unknown })?.id, issues: r.error.issues.length });
    }
    return out;
  }

  private async get(url: string): Promise<{ status: number; json?: unknown }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.o.retries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 2 ** (attempt - 1));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      try {
        const res = await this.fetchImpl(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: ctl.signal });
        if (res.status === 200) return { status: 200, json: await res.json() };
        if ([204, 404, 409].includes(res.status)) return { status: res.status };
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`USGS HTTP ${res.status}`);
          log.warn("USGS request failed, retrying", { status: res.status, attempt: attempt + 1 });
          continue;
        }
        throw new NonRetryable(`USGS HTTP ${res.status} for ${url}`);
      } catch (e) {
        if (e instanceof NonRetryable) throw e;
        lastErr = e;
        log.warn("USGS request error, retrying", { error: (e as Error).name === "AbortError" ? `timeout after ${this.o.timeoutMs} ms` : (e as Error).message, attempt: attempt + 1 });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`USGS request failed after ${this.o.retries + 1} attempts: ${(lastErr as Error)?.message ?? lastErr}`);
  }
}

class NonRetryable extends Error {}
