// Issuer helper: the HCS topic of a new Faultline bond (D16 layout: submit key = oracle signer, admin key = trustee, payer
// and auto-renew = a relayer). A browser wallet cannot do this: Hedera has no HCS system contract (the EVM system
// contracts are HTS 0x167, exchange rate 0x168, PRNG 0x169, HAS 0x16a, HSS 0x16b), so TopicCreate is a native
// transaction signed with the SDK (docs/LESSONS.md "Issuer page"). Written 2026-11-03, NOT testnet-verified; the same
// transaction shape ran in demo phase 1 (scripts/demo/demo-1-bond-topic.ts) and spike S7.
//
//   SUBMIT_EVM=<oracle signer> ADMIN_EVM=<trustee> PAYER_EVM=<relayer> [MEMO=…] [SUBMIT=flhOracle ADMIN=flhTrustee PAYER=flhRelayer] \
//     npx hardhat run --network testnetRead scripts/issuer/hcs-topic.ts            # dry run: plan + mirror checks
//   … EXECUTE=1 …                                                                   # owner only
import { Hbar, TopicCreateTransaction, type Client } from "@hashgraph/sdk";
import { EXECUTE, KEY_FOR } from "../lib/common.js";
import { closeClient, mirror, operatorClient, sdkStep } from "../lib/hedera.js";
import { addressEnv, hederaIdOf, keyFor, networkEnv, saveResult } from "./lib.js";

const PHASE = "issuer-topic";
const submitEvm = addressEnv("SUBMIT_EVM");
const adminEvm = addressEnv("ADMIN_EVM");
const payerEvm = addressEnv("PAYER_EVM");
const SUBMIT = networkEnv("SUBMIT", "flhOracle");
const ADMIN = networkEnv("ADMIN", "flhTrustee");
const PAYER = networkEnv("PAYER", "flhRelayer");
const MEMO = process.env.MEMO ?? "faultline-issuer";
if (MEMO.length > 100) throw new Error("MEMO is limited to 100 bytes");

const payer = await hederaIdOf(payerEvm);
console.log(`payer ${payerEvm}: ${payer ? `${payer.kind} ${payer.id}` : "not on the mirror node (fund it from the faucet first)"}`);
if (!payer || payer.kind !== "account") throw new Error("the payer must be an existing Hedera account — nothing sent");
const admin = await hederaIdOf(adminEvm);
console.log(`admin (trustee) ${adminEvm}: ${admin ? `${admin.kind} ${admin.id}` : "no Hedera account (fine: only its public key goes on the topic)"}`);
console.log(`submit (oracle signer) ${submitEvm}: needs no Hedera account and no HBAR (D16)`);

type TopicInfo = { submit_key: { key: string } | null; admin_key: { key: string } | null; auto_renew_account: string | null; memo: string };
let submitPub = "";
let adminPub = "";
const receipt = await sdkStep({
  spike: PHASE,
  what: `TopicCreate "${MEMO}" (submit key = oracle signer, admin key = trustee, payer + auto-renew = ${payer.id})`,
  payer: `${KEY_FOR[PAYER]} ${payer.id}`,
  client: () => operatorClient(PAYER, payer.id, KEY_FOR[PAYER], true),
  plan: {
    type: "TopicCreateTransaction",
    topicMemo: MEMO,
    submitKey: `ECDSA public key of ${KEY_FOR[SUBMIT]} (must derive to ${submitEvm})`,
    adminKey: `ECDSA public key of ${KEY_FOR[ADMIN]} (must derive to ${adminEvm}); it signs too`,
    autoRenewAccount: payer.id,
    maxTransactionFee: "2 HBAR",
    estimate: "about 0.39 HBAR (spike S7 measured 0.3935)",
  },
  build: async (client: Client) => {
    const s = await keyFor(SUBMIT, submitEvm);
    const a = await keyFor(ADMIN, adminEvm);
    submitPub = s.publicKey.toStringRaw();
    adminPub = a.publicKey.toStringRaw();
    const t = new TopicCreateTransaction().setTopicMemo(MEMO).setSubmitKey(s.publicKey).setAdminKey(a.publicKey).setAutoRenewAccountId(payer.id).setMaxTransactionFee(new Hbar(2)).freezeWith(client);
    return t.sign(a);
  },
});
closeClient();

if (EXECUTE && receipt?.topicId) {
  const topicId = receipt.topicId.toString();
  let info: TopicInfo | undefined;
  for (let i = 0; i < 10 && !info?.submit_key; i++) {
    await new Promise((r) => setTimeout(r, 3000)); // mirror-node lag
    info = await mirror<TopicInfo>(`/api/v1/topics/${topicId}`);
  }
  const ok = info?.submit_key?.key === submitPub && info?.admin_key?.key === adminPub && info?.auto_renew_account === payer.id && info?.memo === MEMO;
  console.log(`\ntopic ${topicId} (https://hashscan.io/testnet/topic/${topicId})`);
  console.log(`  mirror: submit_key ${info?.submit_key?.key === submitPub ? "== oracle signer" : "MISMATCH"}, admin_key ${info?.admin_key?.key === adminPub ? "== trustee" : "MISMATCH"}, auto_renew ${info?.auto_renew_account}, memo "${info?.memo}"`);
  const file = saveResult(`topic-${topicId}`, { topicId, memo: MEMO, submitEvm, adminEvm, payer: payer.id, submitPub, adminPub, mirrorChecked: ok });
  console.log(`  saved ${file}\n  paste ${topicId} into the issuer page and press "Check"`);
  if (!ok) process.exitCode = 1;
}
