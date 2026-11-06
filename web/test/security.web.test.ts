// Security review: route-handler rules (SEC-10 fixed) and wallet chain guard support. Pure checks, no server needed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAFE_ID, localApiEnabled } from "@/lib/server/localApi";

afterEach(() => vi.unstubAllEnvs());

describe("SEC-10: local-network routes never answer on a deployed production server", () => {
  it("enabled in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(localApiEnabled()).toBe(true);
  });
  it("disabled in production unless FAULTLINE_LOCAL_API=1 (only the local smoke test sets it)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FAULTLINE_LOCAL_API", "");
    expect(localApiEnabled()).toBe(false);
    vi.stubEnv("FAULTLINE_LOCAL_API", "1");
    expect(localApiEnabled()).toBe(true);
  });
});

describe("route ids cannot escape their directory or reach another host", () => {
  it("accepts USGS and topic ids", () => {
    for (const ok of ["usp000a8ds", "synthetic-kutch-3", "local-5fc8d326", "0.0.11330395"]) expect(SAFE_ID.test(ok), ok).toBe(true);
  });
  it("rejects separators, encodings, schemes and oversize input", () => {
    for (const bad of ["../config.local", "a/b", "a\\b", "%2e%2e%2f", "http://evil", "x".repeat(81), "", "id?x=1", "id#frag", "a b"]) expect(SAFE_ID.test(bad), bad).toBe(false);
  });
});
