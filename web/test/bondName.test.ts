// The header title comes from the bond contract itself (ERC-20 name()), so testnet shows the ATS bond's real name.
import { Interface, type Provider } from "ethers";
import { describe, expect, it } from "vitest";
import { ERC20_ABI, POOL_ABI, TRIGGER_ABI } from "@/lib/abi";
import { readStatic } from "@/lib/chain";
import { bondTitle } from "@/lib/format";

const A = { trigger: "0x6455F6B7E140Cb273FA612f8091a6c8a5C2A20ab", pool: "0xfF26af30416E7897A1a2a4d703dE05374E9c1359", bond: "0xB26CDB984337E37F021e64CaEb02Fc4085131d6F", usd: "0x0000000000000000000000000000000000aCe152" };
const trig = new Interface(TRIGGER_ABI);
const pool = new Interface(POOL_ABI);
const erc20 = new Interface(ERC20_ABI);

/** A read-only provider stub answering eth_call by contract and selector (values from the testnet smoke run). */
function stubProvider(bondName: string | null): Provider {
  const answers = new Map<string, string>();
  const put = (to: string, iface: Interface, fn: string, values: unknown[]) => answers.set(`${to.toLowerCase()}:${iface.getFunction(fn)!.selector}`, iface.encodeFunctionResult(fn, values));
  put(A.trigger, trig, "pool", [A.pool]);
  put(A.trigger, trig, "termsHash", ["0x78cc5927126c193c0381fe42d1bdbd862697b8d88a42bf68fce8f0257f6acd87"]);
  put(A.trigger, trig, "challengeWindow", [60]);
  put(A.trigger, trig, "oracle", ["0x3509f14C1423381Cfd60Dc874be6C68C1Dc10EfF"]);
  for (const [fn, v] of [["stablecoin", A.usd], ["bond", A.bond], ["sponsor", "0x3932487C0949c02EeB890cD4c02E2360992A6d39"], ["issuanceStart", 1793039438], ["issuanceEnd", 1793040218], ["riskStart", 1793040218], ["maturity", 1793041793], ["grace", 180], ["couponBps", 600], ["cap", 10_000_000_000n], ["minTicket", 100_000_000n]] as const) put(A.pool, pool, fn, [v]);
  put(A.usd, erc20, "symbol", ["fUSD"]);
  put(A.bond, erc20, "symbol", ["FLSMK"]);
  if (bondName !== null) put(A.bond, erc20, "name", [bondName]);
  return {
    getCode: async () => "0x6080",
    call: async (tx: { to?: string | null; data?: string | null }) => {
      const hit = answers.get(`${String(tx.to).toLowerCase()}:${String(tx.data).slice(0, 10)}`);
      if (!hit) throw Object.assign(new Error("execution reverted"), { code: "CALL_EXCEPTION", data: "0x" });
      return hit;
    },
  } as unknown as Provider;
}

describe("bond name in the header", () => {
  it("is read from the bond's name() on chain (testnet: the ATS smoke bond)", async () => {
    const facts = await readStatic(stubProvider("Faultline Smoke Bond"), A.trigger);
    expect(facts.symbols).toEqual({ stablecoin: "fUSD", bond: "FLSMK", bondName: "Faultline Smoke Bond" });
    expect(bondTitle(facts.symbols)).toBe("Faultline Smoke Bond");
  });
  it("falls back to the symbol when name() is missing, and to a neutral title without data", async () => {
    const facts = await readStatic(stubProvider(null), A.trigger);
    expect(bondTitle(facts.symbols)).toBe("FLSMK");
    expect(bondTitle(undefined)).toBe("Faultline bond");
    expect(bondTitle({ bondName: "  ", bond: "" })).toBe("Faultline bond");
  });
});
