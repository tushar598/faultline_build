// Startup refusal gate (config.ts checkStartup) and the zod schemas.
import { readFileSync } from "node:fs";
import { keccak256, toUtf8Bytes } from "ethers";
import { describe, expect, it } from "vitest";
import { kutchTerms, termsHash } from "../../shared/ts/attestation.js";
import { ConfigSchema, TermsSchema, checkStartup, expectedTypehash, type ChainFacts } from "../src/config.js";

const ORACLE = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const replay = kutchTerms("replay", 812_561_278);
const cfg = (chainId = 296, terms = replay) => ({ chainId, trigger: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707", terms, termsHash: termsHash(terms) });
const facts = (over: Partial<ChainFacts> = {}): ChainFacts => ({ chainId: 296n, hasCode: true, termsHash: termsHash(replay), typehash: expectedTypehash(), oracle: ORACLE, ...over });

describe("checkStartup (refusal gate)", () => {
  it("accepts matching chainId, termsHash, type hash and oracle", () => {
    expect(() => checkStartup(cfg(), facts(), ORACLE)).not.toThrow();
  });
  it("the EIP-712 type hash is the trigger's constant (the type string read from FaultlineTrigger.sol)", () => {
    const source = readFileSync(new URL("../../contracts/FaultlineTrigger.sol", import.meta.url), "utf8");
    const declaration = source.slice(source.indexOf("ATTESTATION_TYPEHASH = keccak256("), source.indexOf("/// @dev 100 % in basis points"));
    const typeString = [...declaration.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join("");
    expect(typeString).toMatch(/^Attestation\(bytes32 eventId,/);
    expect(expectedTypehash()).toBe(keccak256(toUtf8Bytes(typeString)));
  });
  it.each([
    ["termsHash mismatch", facts({ termsHash: "0x" + "11".repeat(32) }), /termsHash/],
    ["type hash mismatch", facts({ typehash: "0x" + "22".repeat(32) }), /ATTESTATION_TYPEHASH/],
    ["chainId mismatch", facts({ chainId: 31337n }), /chainId: RPC reports 31337/],
    ["no code at the trigger", facts({ hasCode: false }), /no contract code/],
    ["signer is not the trigger's oracle", facts({ oracle: "0x0000000000000000000000000000000000000001" }), /is not the trigger's oracle/],
  ])("refuses: %s", (_n, f, re) => {
    expect(() => checkStartup(cfg(), f, ORACLE)).toThrow(re);
  });
  it.each([295, 297])("refuses replay terms on chainId %i (D14) even when everything else matches", (c) => {
    expect(() => checkStartup(cfg(c), facts({ chainId: BigInt(c) }), ORACLE)).toThrow(/replay terms are not allowed on chainId/);
  });
  it("live terms run on mainnet chainId 295", () => {
    const live = kutchTerms("live", 0);
    expect(() => checkStartup(cfg(295, live), facts({ chainId: 295n, termsHash: termsHash(live) }), ORACLE)).not.toThrow();
  });
  it("lists every problem at once", () => {
    expect(() => checkStartup(cfg(), facts({ termsHash: "0x" + "11".repeat(32), typehash: "0x" + "22".repeat(32) }), ORACLE)).toThrow(/termsHash[\s\S]*ATTESTATION_TYPEHASH/);
  });
});

describe("schemas", () => {
  it("the D13 terms parse; live terms with an offset or unknown keys are refused", () => {
    expect(TermsSchema.parse(replay)).toEqual(replay);
    expect(() => TermsSchema.parse({ ...kutchTerms("live", 0), timeOffsetSec: 5 })).toThrow();
    expect(() => TermsSchema.parse({ ...replay, extra: 1 })).toThrow();
  });
  it("config: defaults applied, bad address / unknown HCS mode refused", () => {
    const base = { rpcUrl: "http://127.0.0.1:8545", chainId: 31337, trigger: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707", termsFile: "terms/local.json", hcs: { mode: "mock", topicId: "t" }, stateDir: "out" };
    const c = ConfigSchema.parse(base);
    expect(c.trigger).toBe("0x5FC8d32690cc91D4c39d9d3abcBD16989F875707");
    expect([c.attestationTtlSec, c.pendingPollSec, c.pollIntervalSec, c.hcs.mode === "mock" && c.hcs.mockDir]).toEqual([3600, 10, 60, ".hcs-mock"]);
    expect(() => ConfigSchema.parse({ ...base, trigger: "0x1234" })).toThrow();
    expect(() => ConfigSchema.parse({ ...base, hcs: { mode: "carrier-pigeon", topicId: "t" } })).toThrow();
    expect(() => ConfigSchema.parse({ ...base, hcs: { mode: "real", topicId: "abc", network: "testnet", payerAccountId: "0.0.1" } })).toThrow();
  });
  it("evm transport: the relay by default; hedera-sdk needs a network and the relayer's account id", () => {
    const base = { rpcUrl: "http://127.0.0.1:8545", chainId: 296, trigger: "0x5fc8d32690cc91d4c39d9d3abcbd16989f875707", termsFile: "t.json", hcs: { mode: "mock", topicId: "t" }, stateDir: "out" };
    expect(ConfigSchema.parse(base).evm).toEqual({ transport: "relay" });
    expect(ConfigSchema.parse({ ...base, evm: { transport: "hedera-sdk", network: "testnet", payerAccountId: "0.0.11329581" } }).evm.transport).toBe("hedera-sdk");
    expect(() => ConfigSchema.parse({ ...base, evm: { transport: "hedera-sdk", network: "testnet" } })).toThrow();
    expect(() => ConfigSchema.parse({ ...base, evm: { transport: "hedera-sdk", network: "testnet", payerAccountId: "0x1" } })).toThrow();
  });
  it("evm transport hedera-sdk is refused when the network does not match the chain", () => {
    const evm = { transport: "hedera-sdk" as const, network: "mainnet" as const, payerAccountId: "0.0.1" };
    expect(() => checkStartup({ ...cfg(), evm }, facts(), ORACLE)).toThrow(/needs chainId 295, the RPC reports 296/);
    expect(() => checkStartup({ ...cfg(), evm: { ...evm, network: "testnet" } }, facts(), ORACLE)).not.toThrow();
  });
});
