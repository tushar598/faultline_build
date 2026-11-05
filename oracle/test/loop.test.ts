// watch / keeper loop: tasks run on their own intervals, a failing task does not stop the loop, abort stops it cleanly.
import { describe, expect, it } from "vitest";
import { loop } from "../src/service.js";

describe("service loop", () => {
  it("runs every task, survives a failing task, and returns once aborted (SIGINT path)", async () => {
    const ran: string[] = [];
    const ctl = new AbortController();
    let failures = 0;
    const p = loop(
      [
        { name: "pending", everySec: 0, run: async () => void ran.push("pending") },
        { name: "search", everySec: 3600, run: async () => (failures++, Promise.reject(new Error("USGS down"))) },
      ],
      ctl.signal,
    );
    await new Promise((r) => setTimeout(r, 1200));
    ctl.abort();
    await expect(p).resolves.toBeUndefined();
    expect(ran.length).toBeGreaterThanOrEqual(2); // pending re-ran on its own short interval
    expect(failures).toBe(1); // search is not retried before its interval
  });
});
