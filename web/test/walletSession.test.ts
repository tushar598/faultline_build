// Sign-out survives a reload through the stored flag, and neither blocked storage nor a wallet without
// wallet_revokePermissions can break it.
import { describe, expect, it } from "vitest";
import { isSignedOut, revokeWallet, setSignedOut, type SessionStore } from "@/lib/walletSession";

function memoryStore(): SessionStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}
const blocked: SessionStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("signed-out flag", () => {
  it("is off by default, set by sign-out and cleared by sign-in", () => {
    const s = memoryStore();
    expect(isSignedOut(s)).toBe(false);
    setSignedOut(s, true);
    expect(isSignedOut(s)).toBe(true);
    setSignedOut(s, false);
    expect(isSignedOut(s)).toBe(false);
  });
  it("never throws when storage is blocked or missing", () => {
    expect(() => setSignedOut(blocked, true)).not.toThrow();
    expect(isSignedOut(blocked)).toBe(false);
    expect(isSignedOut(null)).toBe(false);
  });
});

describe("revokeWallet", () => {
  it("asks for the eth_accounts permission to be dropped", async () => {
    const calls: unknown[] = [];
    const ok = await revokeWallet({
      request: async (a) => {
        calls.push(a);
        return null;
      },
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }]);
  });
  it("reports false when the wallet does not support it", async () => {
    await expect(revokeWallet({ request: () => Promise.reject(new Error("unsupported")) })).resolves.toBe(false);
  });
});
