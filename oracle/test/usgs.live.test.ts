// Opt-in LIVE check (network): `npm run test:live` (USGS_LIVE=1). Never part of `npm run check`.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dataHash } from "../../shared/ts/attestation.js";
import { UsgsClient } from "../src/usgs.js";

describe.skipIf(!process.env.USGS_LIVE)("USGS live (opt-in)", () => {
  it("usp000a8ds from the live API has the same dataHash as the saved fixture", async () => {
    const c = new UsgsClient({ baseUrl: "https://earthquake.usgs.gov/fdsnws/event/1/query", timeoutMs: 20_000, retries: 2 });
    const r = await c.detail("usp000a8ds");
    expect(r.kind).toBe("ok");
    const saved = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../fixtures/real-usgs-usp000a8ds-detail.geojson"), "utf8"));
    if (r.kind !== "ok") throw new Error(r.kind);
    expect(dataHash(r.feature as never)).toBe(dataHash(saved));
  }, 60_000);
});
