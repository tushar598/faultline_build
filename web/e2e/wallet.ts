// TEST-ONLY EIP-1193 wallet: forwards every request to the local Hardhat node, whose test accounts are unlocked, so
// eth_sendTransaction is signed by the node. No key exists in the browser or in this file. Never used outside e2e.
import type { Page } from "@playwright/test";

export const RPC = "http://127.0.0.1:8545";
/** Hardhat account indexes of the local world (scripts/lib/e2e.ts deployWorld). */
export const ACCOUNTS = { admin: 0, sponsor: 1, trustee: 2, relayer: 4, investorA: 5, backupTrustee: 8 } as const;

/** One eth_sendTransaction seen by the test wallet: the gas it carried and the last eth_estimateGas answer before it. */
export type SentTx = { gas?: string; estimate?: string };

export async function connectNodeWallet(page: Page, index: number): Promise<void> {
  await page.addInitScript(
    ({ rpc, index }) => {
      let id = 0;
      let estimate: string | undefined;
      const sent: SentTx[] = [];
      (window as unknown as { __sentTxs: SentTx[] }).__sentTxs = sent;
      const call = async (method: string, params?: unknown) => {
        const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }) });
        const body = (await res.json()) as { result?: unknown; error?: { message: string; code: number; data?: unknown } };
        if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
        return body.result;
      };
      (window as unknown as { ethereum: unknown }).ethereum = {
        async request({ method, params }: { method: string; params?: unknown }) {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [((await call("eth_accounts")) as string[])[index]];
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "eth_sendTransaction") sent.push({ gas: (params as { gas?: string }[])[0]?.gas, estimate });
          const result = await call(method, params);
          if (method === "eth_estimateGas") estimate = result as string;
          return result;
        },
        on() {},
        removeListener() {},
      };
    },
    { rpc: RPC, index },
  );
}

/** Every transaction this page sent through the test wallet (cleared by a page load). */
export const sentTxs = (page: Page): Promise<SentTx[]> => page.evaluate(() => (window as unknown as { __sentTxs: SentTx[] }).__sentTxs);
