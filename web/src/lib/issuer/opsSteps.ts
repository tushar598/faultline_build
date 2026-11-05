// The two issuer steps a browser wallet cannot sign on Hedera (docs/LESSONS.md "Issuer page"): the exact ops/ command with
// the values filled in, and the "mark done" checks that read the result from the mirror node.
//   HCS topic: Hedera has no HCS system contract, so TopicCreate needs the SDK and the trustee's key.
//   HTS KYC:   since the v2 security model a system-contract call honours contract-id keys only; an EOA's direct
//              0x167 grantTokenKyc can pass only when the token's KYC key is exactly its own account key (node source,
//              NOT testnet-verified), so the page offers the proven SDK path.
import { computeAddress, getAddress, isAddress } from "ethers";

/** `0x000…00aa9f0f` (HTS long-zero facade) → `0.0.11181839`; null for any other address. */
export function htsTokenId(evm: string): string | null {
  if (!isAddress(evm) || !/^0x0{24}/i.test(evm)) return null;
  return `0.0.${BigInt(evm)}`;
}

/** ops/scripts/issuer/hcs-topic.ts, from the repo root. */
export function topicCommand(a: { oracle: string; trustee: string; payer: string; memo: string }): { dryRun: string; execute: string } {
  const env = `SUBMIT_EVM=${getAddress(a.oracle)} ADMIN_EVM=${getAddress(a.trustee)} PAYER_EVM=${getAddress(a.payer)} MEMO=${a.memo}`;
  return { dryRun: `${env} npm run ops:issuer:topic`, execute: `EXECUTE=1 ${env} npm run ops:issuer:topic` };
}

/** ops/scripts/issuer/hts-kyc.ts, from the repo root. */
export function kycCommand(a: { stablecoin: string; accounts: string[]; kycKeyHolder: string }): { dryRun: string; execute: string } | null {
  const token = htsTokenId(a.stablecoin);
  if (!token || a.accounts.length === 0) return null;
  const env = `TOKEN=${token} ACCOUNTS=${a.accounts.map((x) => getAddress(x)).join(",")} KYC_EVM=${getAddress(a.kycKeyHolder)}`;
  return { dryRun: `${env} npm run ops:issuer:kyc`, execute: `EXECUTE=1 ${env} npm run ops:issuer:kyc` };
}

/** Topic memo for a bond symbol: lowercase, at most 100 bytes. */
export const topicMemo = (symbol: string) => `faultline-${symbol.toLowerCase()}`.slice(0, 100);

type Fetcher = (url: string) => Promise<Response>;

async function getJson<T>(fetcher: Fetcher, url: string): Promise<T | null> {
  const res = await fetcher(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mirror node: HTTP ${res.status} for ${new URL(url).pathname}`);
  return (await res.json()) as T;
}

/** The EVM address of a compressed ECDSA public key from the mirror node; null for any other key type. */
export function evmOfKey(key: { _type: string; key: string } | null | undefined): string | null {
  if (!key || key._type !== "ECDSA_SECP256K1" || !/^[0-9a-f]{66}$/i.test(key.key)) return null;
  return computeAddress(`0x${key.key}`);
}

/** Topic exists, its submit key is the oracle signer's and its admin key the trustee's (D16). */
export async function checkTopic(mirrorUrl: string, topicId: string, want: { oracle: string; trustee: string }, fetcher: Fetcher = fetch): Promise<{ ok: boolean; lines: string[] }> {
  if (!/^0\.0\.\d+$/.test(topicId)) return { ok: false, lines: ["Enter the topic id printed by the command (0.0.x)."] };
  const t = await getJson<{ submit_key: { _type: string; key: string } | null; admin_key: { _type: string; key: string } | null; memo: string; deleted: boolean }>(fetcher, `${mirrorUrl}/api/v1/topics/${topicId}`);
  if (!t) return { ok: false, lines: [`Topic ${topicId} is not on the mirror node (yet).`] };
  const submit = evmOfKey(t.submit_key);
  const admin = evmOfKey(t.admin_key);
  const submitOk = submit !== null && getAddress(submit) === getAddress(want.oracle);
  const adminOk = admin !== null && getAddress(admin) === getAddress(want.trustee);
  return {
    ok: submitOk && adminOk && !t.deleted,
    lines: [`memo "${t.memo}"${t.deleted ? ", DELETED" : ""}`, `submit key ${submitOk ? "is the oracle signer" : `is not the oracle signer (${submit ?? "none"})`}`, `admin key ${adminOk ? "is the trustee" : `is not the trustee (${admin ?? "none"})`}`],
  };
}

/** Hedera id of an EVM address (account, else contract), from the mirror node. */
async function hederaIdOf(fetcher: Fetcher, mirrorUrl: string, evm: string): Promise<string | null> {
  const a = await getJson<{ account: string }>(fetcher, `${mirrorUrl}/api/v1/accounts/${evm}`);
  if (a?.account) return a.account;
  const c = await getJson<{ contract_id: string }>(fetcher, `${mirrorUrl}/api/v1/contracts/${evm}`);
  return c?.contract_id ?? null;
}

/** HTS KYC status of each account for the token, read from the mirror node. */
export async function checkHtsKyc(mirrorUrl: string, stablecoin: string, accounts: string[], fetcher: Fetcher = fetch): Promise<{ ok: boolean; lines: string[] }> {
  const token = htsTokenId(stablecoin);
  if (!token) return { ok: false, lines: ["The stablecoin is not an HTS token (no long-zero address): there is no HTS KYC to check."] };
  const lines: string[] = [];
  let ok = true;
  for (const evm of accounts) {
    const id = await hederaIdOf(fetcher, mirrorUrl, evm);
    if (!id) {
      ok = false;
      lines.push(`${evm}: not on the mirror node (yet)`);
      continue;
    }
    const rel = await getJson<{ tokens: { kyc_status: string }[] }>(fetcher, `${mirrorUrl}/api/v1/accounts/${id}/tokens?token.id=${token}`);
    const status = rel?.tokens?.[0]?.kyc_status ?? "NOT ASSOCIATED";
    if (status !== "GRANTED") ok = false;
    lines.push(`${evm} (${id}): ${status}`);
  }
  return { ok, lines };
}
