// The dashboard's human-readable ABI must match the compiled contracts (run `npm run compile` in the repo root first).
import fs from "node:fs";
import path from "node:path";
import { Interface } from "ethers";
import { describe, expect, it } from "vitest";
import { BOND_ABI, ERC20_ABI, POOL_ABI, TRIGGER_ABI } from "@/lib/abi";

const artifact = (dir: string, n: string) => new Interface(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../../artifacts/contracts", dir, `${n}.sol`, `${n}.json`), "utf8")).abi);

function same(full: Interface, abi: readonly string[]) {
  const mine = new Interface(abi as string[]);
  mine.forEachFunction((f) => expect(full.getFunction(f.selector)?.format("full"), f.name).toBe(f.format("full")));
  mine.forEachEvent((e) => expect(full.getEvent(e.topicHash)?.format("full"), e.name).toBe(e.format("full")));
  mine.forEachError((e) => expect(full.getError(e.selector)?.format("full"), e.name).toBe(e.format("full")));
}

describe("dashboard ABI vs artifacts", () => {
  it("FaultlinePool", () => same(artifact("", "FaultlinePool"), POOL_ABI));
  it("FaultlineTrigger", () => same(artifact("", "FaultlineTrigger"), TRIGGER_ABI));
  it("bond fragments vs MockBond (ATS v8 names)", () => same(artifact("mocks", "MockBond"), [...BOND_ABI, ...ERC20_ABI.filter((f) => !f.includes("allowance") && !f.includes("approve"))]));
});
