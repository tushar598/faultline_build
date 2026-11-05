// D8 ledger: id overlap → original eventId, conflicts, atomic writes, reload.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ledger } from "../src/ledger.js";

const TRIGGER = "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707";
let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "faultline-ledger-"))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("ledger", () => {
  it("a merged record (new preferred id, ids overlap) maps to the ORIGINAL eventId and adds the new id", () => {
    const l = new Ledger(dir, 31337n, TRIGGER);
    l.upsert("0xE1", "pt26282000", ["pt26282000", "us6000u18k"]);
    const look = l.lookup(["us6000u18k", "pt26282000", "usauto6000u18k"]);
    expect(look).toEqual({ kind: "known", eventId: "0xE1", newIds: ["usauto6000u18k"] });
    l.upsert("0xE1", "us6000u18k", ["us6000u18k", "pt26282000", "usauto6000u18k"]);
    expect(l.get("0xE1")!.usgsIds).toEqual(["pt26282000", "us6000u18k", "usauto6000u18k"]);
    expect(l.get("0xE1")!.firstUsgsId).toBe("pt26282000");
    expect(l.lookup(["usauto6000u18k"])).toEqual({ kind: "known", eventId: "0xE1", newIds: [] });
  });
  it("ids that point at two different known events are a conflict; unknown ids are new", () => {
    const l = new Ledger(dir, 31337n, TRIGGER);
    l.upsert("0xA", "a1", ["a1"]);
    l.upsert("0xB", "b1", ["b1"]);
    expect(l.lookup(["a1", "b1"])).toEqual({ kind: "conflict", eventIds: ["0xA", "0xB"] });
    expect(l.lookup(["zzz"])).toEqual({ kind: "new" });
  });
  it("persists and reloads; one file per (chainId, trigger); refuses a file of another trigger", () => {
    const l = new Ledger(dir, 296n, TRIGGER);
    l.upsert("0xA", "a1", ["a1"]);
    l.update("0xA", (e) => e.advisories.push({ reason: "box", dataHash: "0x01", at: "t" }));
    expect(path.basename(l.file)).toBe(`ledger-296-${TRIGGER.toLowerCase()}.json`);
    const again = new Ledger(dir, 296n, TRIGGER);
    expect(again.get("0xA")!.advisories[0]!.reason).toBe("box");
    fs.copyFileSync(l.file, path.join(dir, `ledger-296-${"0x0000000000000000000000000000000000000001"}.json`));
    expect(() => new Ledger(dir, 296n, "0x0000000000000000000000000000000000000001")).toThrow(/another chain or trigger/);
  });
  it("writes atomically: temp file + rename, never a half-written ledger, no temp left behind", () => {
    const l = new Ledger(dir, 31337n, TRIGGER);
    l.upsert("0xA", "a1", ["a1"]);
    const good = fs.readFileSync(l.file, "utf8");
    const spy = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => l.upsert("0xB", "b1", ["b1"])).toThrow(/disk full/);
    spy.mockRestore();
    expect(fs.readFileSync(l.file, "utf8")).toBe(good); // the old ledger is intact
    l.save();
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(JSON.parse(fs.readFileSync(l.file, "utf8")).events["0xB"]).toBeDefined();
  });
});
