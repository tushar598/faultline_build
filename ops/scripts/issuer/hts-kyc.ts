// Issuer helper: HTS stablecoin KYC for a new pool and its investors (TokenGrantKyc, signed by the token's KYC key).
// The pool pre-checks this KYC before every transfer (D11). Why this is an ops/ step and not a wallet button: since
// the v2 security model a system-contract call honours only contract-id keys, never the caller's signature; a direct
// EOA call to 0x167 grantTokenKyc can pass only when the token's KYC key is exactly the caller's own account key
// (the node then treats it as the payer's key). That path is read from the node source, NOT testnet-verified
// (docs/LESSONS.md "Issuer page"); the SDK transaction below is the one demo phase 2 ran on testnet.
// Written 2026-11-03, NOT testnet-verified in this form.
//
//   TOKEN=<fUSD 0.0.x> ACCOUNTS=<pool>,<investor>,… KYC_EVM=<KYC key holder> [KYC=flhDeployer] \
//     npx hardhat run --network testnetRead scripts/issuer/hts-kyc.ts               # dry run: mirror status per account
//   … EXECUTE=1 …                                                                    # owner only
import { TokenGrantKycTransaction } from "@hashgraph/sdk";
import { getAddress, isAddress } from "ethers";
import { EXECUTE, KEY_FOR } from "../lib/common.js";
import { closeClient, mirror, operatorClient, sdkStep } from "../lib/hedera.js";
import { addressEnv, hederaIdOf, keyFor, networkEnv, saveResult, tokenIdOf } from "./lib.js";

const PHASE = "issuer-kyc";
const token = tokenIdOf(process.env.TOKEN ?? "");
const kycEvm = addressEnv("KYC_EVM");
const KYC = networkEnv("KYC", "flhDeployer");
const targets = (process.env.ACCOUNTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (targets.length === 0 || targets.some((t) => !isAddress(t))) throw new Error("ACCOUNTS must be a comma list of EVM addresses");

type TokenInfo = { name: string; symbol: string; decimals: string; kyc_key: { _type: string; key: string } | null; wipe_key: unknown };
const info = await mirror<TokenInfo>(`/api/v1/tokens/${token}`);
if (!info) throw new Error(`token ${token} not found on the mirror node`);
console.log(`token ${token}: ${info.name} (${info.symbol}), ${info.decimals} decimals, KYC key ${info.kyc_key ? `${info.kyc_key._type} ${info.kyc_key.key.slice(0, 12)}…` : "none"}, wipe key ${info.wipe_key ? "SET" : "none"}`);
if (!info.kyc_key) throw new Error("the token has no KYC key: nothing to grant");

const holder = await hederaIdOf(kycEvm);
if (!holder || holder.kind !== "account") throw new Error(`KYC_EVM ${kycEvm} is not a Hedera account — nothing sent`);
const holderKey = (await mirror<{ key: { key: string } | null }>(`/api/v1/accounts/${holder.id}`))?.key?.key;
const sameKey = holderKey !== undefined && holderKey === info.kyc_key.key;
console.log(`KYC key holder ${kycEvm} = ${holder.id}: account key ${sameKey ? "== token KYC key" : "differs from the token KYC key (EXECUTE will refuse)"}`);

const todo: { evm: string; id: string }[] = [];
const report: Record<string, string> = {};
for (const t of targets.map((x) => getAddress(x))) {
  const h = await hederaIdOf(t);
  if (!h) {
    report[t] = "not on the mirror node";
    console.log(`  ${t}: not on the mirror node yet — skip`);
    continue;
  }
  const rel = (await mirror<{ tokens: { kyc_status: string }[] }>(`/api/v1/accounts/${h.id}/tokens?token.id=${token}`))?.tokens?.[0];
  const status = rel ? rel.kyc_status : "NOT ASSOCIATED";
  report[t] = status;
  console.log(`  ${t} (${h.kind} ${h.id}): ${status}${!rel ? " — associate first (a pool associates in initialize; an investor calls the token's associate())" : ""}`);
  if (rel && rel.kyc_status !== "GRANTED") todo.push({ evm: t, id: h.id });
}
if (todo.length === 0) console.log("\nnothing to grant");

for (const t of todo) {
  await sdkStep({
    spike: PHASE,
    what: `TokenGrantKyc(${token}, ${t.id})`,
    payer: `${KEY_FOR[KYC]} ${holder.id}`,
    client: async () => {
      await keyFor(KYC, kycEvm); // refuses a keystore entry that is not the expected KYC key holder
      if (!sameKey) throw new Error("the payer's account key is not the token's KYC key; nothing sent");
      return operatorClient(KYC, holder.id, KEY_FOR[KYC]);
    },
    plan: { type: "TokenGrantKycTransaction", token, account: `${t.id} (${t.evm})`, estimate: "about 0.013 HBAR (smoke run)" },
    build: (client) => new TokenGrantKycTransaction().setTokenId(token).setAccountId(t.id).freezeWith(client),
  });
}
closeClient();

if (EXECUTE && todo.length) {
  for (const t of todo) {
    let s = "";
    for (let i = 0; i < 10 && s !== "GRANTED"; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      s = (await mirror<{ tokens: { kyc_status: string }[] }>(`/api/v1/accounts/${t.id}/tokens?token.id=${token}`))?.tokens?.[0]?.kyc_status ?? "";
    }
    report[t.evm] = s || "unknown";
    console.log(`  mirror: ${t.evm} ${s}`);
  }
  console.log(`saved ${saveResult(`kyc-${token}-${Date.now()}`, { token, kycHolder: holder.id, accounts: report })}`);
  console.log('press "Check" on the issuer page');
}
