// Ported from the reference repo (ops/scripts/s7/s7-hcs-keys.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Spike S7 — the HCS key layout for the oracle (D16). Dry run by default; EXECUTE=1 only by the owner.
//   create   TopicCreate: submitKey = oracle key, adminKey = trustee key, payer + auto-renew = relayer
//            (signed by the relayer as payer and by the trustee as admin key; the relayer is hollow and is completed)
//   publish  the smoke run's real attestation message, paid by the relayer, signed by relayer + oracle submit key →
//            SUCCESS; read back from the mirror node: bytes equal, payer = relayer, in-payload signature = oracle
//   wrong    a message signed by the relayer only (no submit key) → expect INVALID_SIGNATURE at consensus (S5: the
//            payer is still charged; the fee is recorded)
//   rotate   TopicUpdate submitKey → a throwaway key (generated in memory, discarded) and back to the oracle key,
//            signed by the trustee admin key; mirror checked after each; skipped if the estimate exceeds 1 HBAR
// PHASE=create,publish,wrong,rotate (default all, in order); finished steps skip themselves (out/s7-state.json).
import { Hbar, PrecheckStatusError, PrivateKey, ReceiptStatusError, TopicCreateTransaction, TopicMessageSubmitTransaction, TopicUpdateTransaction, type Client } from "@hashgraph/sdk";
import { EXECUTE } from "../lib/common.js";
import { closeClient, mirror, sdkStep, usdPerHbar } from "../lib/hedera.js";
import { FEE_USD, ORACLE, RELAYER, TOPIC_MEMO, TRUSTEE, hcsMessage, loadS7, relayerClient, saveS7, sampleMessage, sdkKey } from "./s7.js";

const phases = (process.env.PHASE ?? "create,publish,wrong,rotate").split(",");
const SPIKE = "S7";
const keys = {
  trustee: () => sdkKey(TRUSTEE.network, TRUSTEE.evm, TRUSTEE.keyName),
  oracle: () => sdkKey(ORACLE.network, ORACLE.evm, ORACLE.keyName),
};
type TopicInfo = { submit_key: { key: string } | null; admin_key: { key: string } | null; auto_renew_account: string; memo: string };
const topicInfo = (id: string) => mirror<TopicInfo>(`/api/v1/topics/${id}`);
async function waitFor<T>(read: () => Promise<T | undefined>, ok: (v: T) => boolean, tries = 10): Promise<T | undefined> {
  for (let i = 0; i < tries; i++) {
    const v = await read();
    if (v !== undefined && ok(v)) return v;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return undefined;
}

try {
  // ------------------------------------------------------------ create
  if (phases.includes("create")) {
    if (loadS7().topicId) console.log(`\n[S7] topic already created: ${loadS7().topicId} — skip`);
    else {
      let oraclePub = "", trusteePub = "";
      const receipt = await sdkStep({
        spike: SPIKE,
        what: `TopicCreate "${TOPIC_MEMO}" (submit key = oracle, admin key = trustee, payer = relayer)`,
        payer: `relayer ${RELAYER.id} (hollow: completed by this payment)`,
        client: relayerClient,
        plan: {
          type: "TopicCreateTransaction",
          topicMemo: TOPIC_MEMO,
          submitKey: `oracle ECDSA public key (from FLH_ORACLE_PRIVATE_KEY at EXECUTE; must derive to ${ORACLE.evm})`,
          adminKey: `trustee ECDSA public key (from FLH_TRUSTEE_PRIVATE_KEY at EXECUTE; must derive to ${TRUSTEE.evm})`,
          autoRenewAccount: `${RELAYER.id} (relayer)`,
          signatures: "relayer (payer, auto-renew) + trustee (admin key)",
          maxTransactionFee: "2 ℏ",
          estimate: `≈ ${(FEE_USD.ConsensusCreateTopic / (await usdPerHbar())).toFixed(3)}–${((2 * FEE_USD.ConsensusCreateTopic) / (await usdPerHbar())).toFixed(3)} HBAR`,
        },
        build: async (client: Client) => {
          const [o, t] = [await keys.oracle(), await keys.trustee()];
          oraclePub = o.publicKey.toStringRaw();
          trusteePub = t.publicKey.toStringRaw();
          const tx = new TopicCreateTransaction().setTopicMemo(TOPIC_MEMO).setSubmitKey(o.publicKey).setAdminKey(t.publicKey).setAutoRenewAccountId(RELAYER.id).setMaxTransactionFee(new Hbar(2)).freezeWith(client);
          return tx.sign(t);
        },
      });
      if (receipt?.topicId) {
        const topicId = receipt.topicId.toString();
        saveS7({ topicId, oraclePub, trusteePub });
        console.log(`  topic: ${topicId}  (https://hashscan.io/testnet/topic/${topicId})`);
        const info = await waitFor(() => topicInfo(topicId), (i) => Boolean(i.submit_key));
        console.log(`  mirror: submit_key ${info?.submit_key?.key === oraclePub ? "== oracle ✓" : "✖ " + info?.submit_key?.key}, admin_key ${info?.admin_key?.key === trusteePub ? "== trustee ✓" : "✖ " + info?.admin_key?.key}, auto_renew_account ${info?.auto_renew_account}`);
      }
    }
  }
  const topicId = loadS7().topicId as string | undefined;

  // ------------------------------------------------------------ publish (relayer pays, oracle signs as submit key)
  if (phases.includes("publish")) {
    const { msg, bytes } = sampleMessage();
    if (loadS7().publishSeq) console.log(`\n[S7] sample already published (seq ${loadS7().publishSeq}) — skip`);
    else {
      const receipt = await sdkStep({
        spike: SPIKE,
        what: "TopicMessageSubmit: smoke-run attestation message, payer relayer + oracle submit key",
        payer: `relayer ${RELAYER.id}`,
        client: relayerClient,
        plan: { type: "TopicMessageSubmitTransaction", topicId: topicId ?? "<topic from create>", message: `${bytes.length} bytes, kind ${msg.kind}, eventId ${msg.attestation.eventId.slice(0, 18)}…`, signatures: "relayer (payer) + oracle (submit key)", maxTransactionFee: "1 ℏ", expected: "SUCCESS" },
        build: async (client: Client) => {
          if (!topicId) throw new Error("no topic yet");
          const tx = new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(bytes).setMaxTransactionFee(new Hbar(1)).freezeWith(client);
          return tx.sign(await keys.oracle());
        },
      });
      if (receipt?.topicSequenceNumber) {
        const seq = receipt.topicSequenceNumber.toString();
        saveS7({ publishSeq: seq });
        type MirrorMsg = { message: string; payer_account_id: string; consensus_timestamp: string; sequence_number: number };
        const m = await waitFor(() => mirror<MirrorMsg>(`/api/v1/topics/${topicId}/messages/${seq}`), () => true);
        if (!m) console.log("  mirror: message not visible yet; rerun PHASE=publish to read it back");
        else {
          const back = Buffer.from(m.message, "base64");
          const h = hcsMessage();
          const decoded = h.decodeMessage(back);
          const signer = h.recoverMessageSigner(decoded);
          const checks: [string, boolean][] = [
            ["bytes read back == bytes sent", Buffer.compare(back, Buffer.from(bytes)) === 0],
            [`payer_account_id ${m.payer_account_id} == relayer`, m.payer_account_id === RELAYER.id],
            [`in-payload EIP-712 signature recovers to ${signer} == oracle`, signer.toLowerCase() === ORACLE.evm.toLowerCase()],
          ];
          for (const [k, ok] of checks) console.log(`  ${ok ? "✓" : "✖"} ${k}`);
          saveS7({ publishConsensus: m.consensus_timestamp, publishVerified: checks.every(([, ok]) => ok) });
        }
      }
    }
  }

  // ------------------------------------------------------------ wrong (relayer only, no submit key)
  if (phases.includes("wrong")) {
    if (loadS7().wrongDone) console.log(`\n[S7] no-submit-key check already done — skip`);
    else {
      const bytes = Buffer.from(JSON.stringify({ v: 1, kind: "faultline.spike.no-submit-key", spike: true }), "utf8");
      try {
        const receipt = await sdkStep({
          spike: SPIKE,
          what: "TopicMessageSubmit signed by the relayer only (no submit key) — expect INVALID_SIGNATURE",
          payer: `relayer ${RELAYER.id} (NOT the submit key)`,
          client: relayerClient,
          plan: { type: "TopicMessageSubmitTransaction", topicId: topicId ?? "<topic from create>", message: `${bytes.length} bytes: ${bytes.toString("utf8")}`, signatures: "relayer only", maxTransactionFee: "1 ℏ", expected: "receipt INVALID_SIGNATURE (S5: at consensus, payer charged)" },
          build: (client: Client) => {
            if (!topicId) throw new Error("no topic yet");
            return new TopicMessageSubmitTransaction().setTopicId(topicId).setMessage(bytes).setMaxTransactionFee(new Hbar(1)).freezeWith(client);
          },
        });
        if (receipt) console.log("  ⚠ ACCEPTED without the submit key — the topic is not private-write; report this.");
        if (EXECUTE) saveS7({ wrongDone: true, wrongResult: receipt ? "ACCEPTED (unexpected)" : "dry run" });
      } catch (err) {
        const status = err instanceof ReceiptStatusError || err instanceof PrecheckStatusError ? err.status.toString() : undefined;
        if (!status) throw err;
        const where = err instanceof ReceiptStatusError ? "at consensus (payer charged; fee in the evidence log)" : "at precheck (no fee)";
        console.log(`  result: rejected ${where} with ${status}${status === "INVALID_SIGNATURE" ? " (as expected)" : " (UNEXPECTED code)"}`);
        saveS7({ wrongDone: true, wrongResult: `${status} ${where}` });
      }
    }
  }

  // ------------------------------------------------------------ rotate (trustee admin key)
  if (phases.includes("rotate")) {
    const usd = await usdPerHbar();
    const estimate = (2 * FEE_USD.ConsensusUpdateTopic) / usd;
    if (loadS7().rotatedBack) console.log(`\n[S7] submit-key rotation already done — skip`);
    else if (estimate > 1) console.log(`\n[S7] rotation skipped: estimate ${estimate.toFixed(4)} HBAR > 1 HBAR (owner rule)`);
    else {
      const throwaway = PrivateKey.generateECDSA(); // in memory only, never saved; only its public key is shown
      const throwPub = throwaway.publicKey.toStringRaw();
      for (const [label, target] of [["to a throwaway key", "throwaway"], ["back to the oracle key", "oracle"]] as const) {
        if (target === "throwaway" && loadS7().rotatedAway) continue;
        const receipt = await sdkStep({
          spike: SPIKE,
          what: `TopicUpdate submitKey ${label}, signed by the trustee admin key`,
          payer: `relayer ${RELAYER.id}`,
          client: relayerClient,
          plan: { type: "TopicUpdateTransaction", topicId: topicId ?? "<topic from create>", submitKey: target === "throwaway" ? `throwaway ECDSA ${throwPub} (generated now, discarded)` : "oracle ECDSA public key (from the keystore at EXECUTE)", signatures: "relayer (payer) + trustee (admin key)", maxTransactionFee: "1 ℏ", estimate: `≈ ${(FEE_USD.ConsensusUpdateTopic / usd).toFixed(5)} HBAR (base)` },
          build: async (client: Client) => {
            if (!topicId) throw new Error("no topic yet");
            const key = target === "throwaway" ? throwaway.publicKey : (await keys.oracle()).publicKey;
            const tx = new TopicUpdateTransaction().setTopicId(topicId).setSubmitKey(key).setMaxTransactionFee(new Hbar(1)).freezeWith(client);
            return tx.sign(await keys.trustee());
          },
        });
        if (!receipt) break; // dry run
        const want = target === "throwaway" ? throwPub : String(loadS7().oraclePub);
        const info = await waitFor(() => topicInfo(topicId!), (i) => i.submit_key?.key === want);
        console.log(`  mirror: submit_key ${info ? `== ${target} ✓` : "✖ not updated on the mirror node yet"}`);
        saveS7(target === "throwaway" ? { rotatedAway: true } : { rotatedBack: true });
      }
    }
  }
} finally {
  closeClient();
}
console.log(`\nstate: ${JSON.stringify(loadS7())}`);
