// Sign-out for an EIP-1193 wallet. There is no account or server session here: signing in means the wallet shares an
// address with this site. wallet_revokePermissions ends that where the wallet supports it. Not every wallet does, and a
// site that still has permission gets its address back from eth_accounts on the next load, so the choice is also kept
// in this browser. Storage can be blocked, so every access is guarded and the page works without it.

const KEY = "faultline.wallet.signedOut";

export type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Requester = { request(args: { method: string; params?: unknown[] | object }): Promise<unknown> };

/** The browser's localStorage, or null where reading it throws. */
export function browserStore(): SessionStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isSignedOut(store: SessionStore | null): boolean {
  try {
    return store?.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setSignedOut(store: SessionStore | null, signedOut: boolean): void {
  try {
    if (signedOut) store?.setItem(KEY, "1");
    else store?.removeItem(KEY);
  } catch {
    // The flag is a convenience: the current page still holds the state in memory.
  }
}

/** Asks the wallet to drop this site's permission. False when the wallet refuses or does not know the method. */
export async function revokeWallet(eth: Requester): Promise<boolean> {
  try {
    await eth.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] });
    return true;
  } catch {
    return false;
  }
}
