// The oracle's human-readable ABI subset must match the compiled contracts (no drift).
import fs from "node:fs";
import path from "node:path";
import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { POOL_ABI, TRIGGER_ABI } from "../src/abi.js";

const artifact = (n: string) => new Interface(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../artifacts/contracts", `${n}.sol`, `${n}.json`), "utf8")).abi);

describe("abi subset vs artifacts", () => {
  for (const [name, abi] of [["FaultlineTrigger", TRIGGER_ABI], ["FaultlinePool", POOL_ABI]] as const) {
    it(`${name}: every function, event and error fragment exists in the artifact with the same signature`, () => {
      const full = artifact(name);
      const mine = new Interface(abi as unknown as string[]);
      mine.forEachFunction((f) => expect(full.getFunction(f.selector)?.format("full"), f.name).toBe(f.format("full")));
      mine.forEachEvent((e) => expect(full.getEvent(e.topicHash)?.format("full"), e.name).toBe(e.format("full")));
      mine.forEachError((e) => expect(full.getError(e.selector)?.format("full"), e.name).toBe(e.format("full")));
    });
  }
});
