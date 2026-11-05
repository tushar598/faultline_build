// Keys from env only; Hardhat's public test accounts only on chainId 31337.
import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import { isHardhatTestAccount, walletFor } from "../src/keys.js";

const HARDHAT_3 = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"; // documented Hardhat account #3

describe("keys", () => {
  it("HARDHAT_ACCOUNT_* picks the documented default accounts on 31337", () => {
    expect(walletFor("oracle", 31337n, { HARDHAT_ACCOUNT_ORACLE: "3" }).address).toBe(HARDHAT_3);
  });
  it("refuses HARDHAT_ACCOUNT_* off the local chain", () => {
    expect(() => walletFor("oracle", 296n, { HARDHAT_ACCOUNT_ORACLE: "3" })).toThrow(/only allowed on chainId 31337/);
  });
  it("refuses a Hardhat test key passed as ORACLE_PRIVATE_KEY on testnet (and never echoes it)", () => {
    const key = walletFor("oracle", 31337n, { HARDHAT_ACCOUNT_ORACLE: "3" }).privateKey;
    let msg = "";
    try {
      walletFor("oracle", 296n, { ORACLE_PRIVATE_KEY: key });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/public Hardhat test account; refused on chainId 296/);
    expect(msg).not.toContain(key.slice(2));
  });
  it("accepts a fresh key on testnet; a malformed key fails without echoing it", () => {
    const w = Wallet.createRandom();
    expect(walletFor("relayer", 296n, { RELAYER_PRIVATE_KEY: w.privateKey }).address).toBe(w.address);
    expect(isHardhatTestAccount(w.address)).toBe(false);
    expect(() => walletFor("relayer", 296n, { RELAYER_PRIVATE_KEY: "0xnot-a-key-SECRET" })).toThrow(/not a valid private key \(value not shown\)/);
    try {
      walletFor("relayer", 296n, { RELAYER_PRIVATE_KEY: "0xnot-a-key-SECRET" });
    } catch (e) {
      expect((e as Error).message).not.toContain("SECRET");
    }
  });
  it("a missing key explains how to enter it with read -s", () => {
    expect(() => walletFor("oracle", 296n, {})).toThrow(/read -s ORACLE_PRIVATE_KEY/);
  });
});
