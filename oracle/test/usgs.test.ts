// USGS client: zod parsing of the REAL saved records, malformed input, and the HTTP behaviour (retries, 204/404/409).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dataHash } from "../../shared/ts/attestation.js";
import { FeatureCollectionSchema, USER_AGENT, UsgsClient, idsOf, parseFeature } from "../src/usgs.js";

const fx = (f: string) => JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures", f), "utf8"));
const OPTS = { baseUrl: "https://example.test/query", timeoutMs: 1000, retries: 3 };
const resp = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status });

describe("zod parsing", () => {
  it("parses the real usp000a8ds detail record and keeps every field dataHash needs", () => {
    const f = parseFeature(fx("real-usgs-usp000a8ds-detail.geojson"));
    expect(f.id).toBe("usp000a8ds");
    expect(f.properties.magType).toBe("mwc");
    expect(dataHash(f as never)).toBe("0xd604b4f7132c25556c5acda8c97ef967af9ce458b017144bac0741ff02672730");
    expect(idsOf(f)).toEqual(["usp000a8ds", "choy20010126031640", "gcmtm012601a", "gcmt20010126031640", "duputel012601a", "atlas20010126031640", "iscgem1763683"]);
  });
  it("parses the real search result (FeatureCollection) and its feature", () => {
    const fc = FeatureCollectionSchema.parse(fx("real-usgs-usp000a8ds-search.geojson"));
    expect(parseFeature(fc.features[0]).id).toBe("usp000a8ds");
  });
  it("accepts null mag / magType (ComCat allows them) but rejects missing or mistyped fields", () => {
    const f = fx("real-usgs-usp000a8ds-detail.geojson");
    expect(parseFeature({ ...f, properties: { ...f.properties, mag: null, magType: null } }).properties.mag).toBeNull();
    expect(() => parseFeature({ ...f, properties: { ...f.properties, time: "yesterday" } })).toThrow(/malformed USGS feature/);
    expect(() => parseFeature({ ...f, geometry: { type: "Point", coordinates: [70, 23] } })).toThrow();
    expect(() => parseFeature({ ...f, id: undefined })).toThrow();
  });
});

describe("UsgsClient HTTP behaviour", () => {
  const detail = fx("real-usgs-usp000a8ds-detail.geojson");
  it("sends the User-Agent and eventid, returns the feature", async () => {
    const fetchImpl = vi.fn(async () => resp(200, detail));
    const c = new UsgsClient({ ...OPTS, fetchImpl: fetchImpl as never, sleep: async () => {} });
    const r = await c.detail("usp000a8ds");
    expect(r.kind).toBe("ok");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://example.test/query?eventid=usp000a8ds&format=geojson");
    expect((init.headers as Record<string, string>)["User-Agent"]).toBe(USER_AGENT);
  });
  it("409 → deleted, 404 and 204 → not-found, without retries", async () => {
    for (const [status, kind] of [[409, "deleted"], [404, "not-found"], [204, "not-found"]] as const) {
      const fetchImpl = vi.fn(async () => resp(status));
      const r = await new UsgsClient({ ...OPTS, fetchImpl: fetchImpl as never, sleep: async () => {} }).detail("x");
      expect(r.kind).toBe(kind);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
  it("retries 503 / 429 / network errors with exponential backoff, then succeeds", async () => {
    const answers = [() => resp(503), () => resp(429), () => Promise.reject(new TypeError("fetch failed")), () => resp(200, detail)];
    const fetchImpl = vi.fn(async () => answers.shift()!());
    const sleeps: number[] = [];
    const r = await new UsgsClient({ ...OPTS, fetchImpl: fetchImpl as never, sleep: async (ms) => void sleeps.push(ms) }).detail("usp000a8ds");
    expect(r.kind).toBe("ok");
    expect(sleeps).toEqual([1000, 2000, 4000]);
  });
  it("gives up after retries + 1 attempts; a 400 is not retried", async () => {
    const always503 = vi.fn(async () => resp(503));
    await expect(new UsgsClient({ ...OPTS, fetchImpl: always503 as never, sleep: async () => {} }).detail("x")).rejects.toThrow(/after 4 attempts/);
    const bad = vi.fn(async () => resp(400));
    await expect(new UsgsClient({ ...OPTS, fetchImpl: bad as never, sleep: async () => {} }).detail("x")).rejects.toThrow(/HTTP 400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });
  it("a timeout aborts the request and is retried", async () => {
    let calls = 0;
    const fetchImpl = vi.fn((_u: string, init: RequestInit) => {
      calls++;
      if (calls === 1) return new Promise<Response>((_r, reject) => init.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      return Promise.resolve(resp(200, detail));
    });
    const r = await new UsgsClient({ ...OPTS, timeoutMs: 20, fetchImpl: fetchImpl as never, sleep: async () => {} }).detail("usp000a8ds");
    expect(r.kind).toBe("ok");
    expect(calls).toBe(2);
  });
  it("search builds the FDSN box query and skips malformed features", async () => {
    const fc = fx("real-usgs-usp000a8ds-search.geojson");
    fc.features.push({ type: "Feature", id: "broken" });
    const fetchImpl = vi.fn(async () => resp(200, fc));
    const out = await new UsgsClient({ ...OPTS, fetchImpl: fetchImpl as never, sleep: async () => {} }).search({
      start: new Date("2001-01-25T00:00:00Z"), end: new Date("2001-01-27T00:00:00Z"), box: { minLat: 22.5, maxLat: 24.5, minLon: 68.5, maxLon: 71.5 }, minMagnitude: 7,
    });
    expect(out.map((f) => f.id)).toEqual(["usp000a8ds"]);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ format: "geojson", minlatitude: "22.5", maxlatitude: "24.5", minlongitude: "68.5", maxlongitude: "71.5", minmagnitude: "7", eventtype: "earthquake", orderby: "time", starttime: "2001-01-25T00:00:00.000Z" });
  });
});
