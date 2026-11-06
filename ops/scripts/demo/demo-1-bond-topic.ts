// Full demo phase 1 — the demo's HCS topic and a fresh ATS v8 bond (no pool yet, so the schedule clock has not started):
//   topic   TopicCreate memo "faultline-demo-testnet": submit key = oracle key, admin key = trustee key, payer and
//           auto-renew account = relayer (D16, the layout spike S7 proved); signed by relayer + trustee; mirror-checked
//   bond    Factory.deployBond "Faultline Demo Bond" FLDMO (S1 shape, scripts/lib/atsBond.ts), deployer = admin,
//           SSI_MANAGER and KYC; startingDate = now + 2 min, maturityDate = now + BOND_MATURITY_MIN (default 45) min
//   issuer  addIssuer(deployer)
//   kyc     grantKyc(A / B, "urn:faultline:demo:kyc:<role>", now, now + 100 y, deployer) — opaque vcId, no VC document
// The topic goes first: it has no clock. After the bond, phase 2 must start within ~29 min (printed below).
// PHASE=topic,deploy,issuer,kyc (default all, in order); each step skips itself when it is already done.
import { Hbar, TopicCreateTransaction, type Client } from "@hashgraph/sdk";
import { Contract, Interface } from "ethers";
import { FACTORY, FACTORY_ABI, ROLES } from "../lib/common.js";
import { bondArgs } from "../lib/atsBond.js";
import { closeClient, mirror, sdkStep, usdPerHbar } from "../lib/hedera.js";
import { FEE_USD, sdkKey } from "../s7/s7.js";
import { ACCOUNTS, BOND, EXECUTE, MIN, P, TOPIC_MEMO, balances, bondAt, clientOf, eventually, iso, latestTs, loadDemo, printHbar, provider, saveSmoke, tx as send, usd } from "./lib.js";

const PHASE = "demo-1";
const phases = (process.env.PHASE ?? "topic,deploy,issuer,kyc").split(",");
const KYC_HOLDERS = ["investorA", "investorB"] as const;
const dep = ACCOUNTS.deployer;

const p = await provider();
const start = await balances();
if (!loadDemo().preflightAt) throw new Error("run phase 0 (demo-0-preflight) first");
const tx = (what: string, contract: Contract, method: string, args: unknown[]) => send(PHASE, "deployer", what, contract, method, args);
const deferred = (what: string, why: string) => console.log(`\n[${PHASE}] ${what}\n  simulation deferred: ${why}`);

// ------------------------------------------------------------ topic
type TopicInfo = { submit_key: { key: string } | null; admin_key: { key: string } | null; auto_renew_account: string; memo: string };
if (phases.includes("topic")) {
  if (loadDemo().topicId) console.log(`\n[${PHASE}] topic already created: ${loadDemo().topicId} — skip`);
  else {
    let oraclePub = "";
    let trusteePub = "";
    const rate = await usdPerHbar();
    const receipt = await sdkStep({
      spike: PHASE,
      what: `TopicCreate "${TOPIC_MEMO}" (submit key = oracle, admin key = trustee, payer + auto-renew = relayer)`,
      payer: `relayer ${ACCOUNTS.relayer.id}`,
      client: () => clientOf("relayer"),
      plan: {
        type: "TopicCreateTransaction",
        topicMemo: TOPIC_MEMO,
        submitKey: `oracle ECDSA public key (from FLH_ORACLE_PRIVATE_KEY at EXECUTE; must derive to ${ACCOUNTS.oracle.evm})`,
        adminKey: `trustee ECDSA public key (from FLH_TRUSTEE_PRIVATE_KEY at EXECUTE; must derive to ${ACCOUNTS.trustee.evm})`,
        autoRenewAccount: `${ACCOUNTS.relayer.id} (relayer)`,
        signatures: "relayer (payer, auto-renew) + trustee (admin key)",
        maxTransactionFee: "2 ℏ",
        estimate: `S7 measured 0.3935 HBAR; fee table base $${FEE_USD.ConsensusCreateTopic} = ${(FEE_USD.ConsensusCreateTopic / rate).toFixed(3)} HBAR`,
      },
      build: async (client: Client) => {
        const o = await sdkKey("flhOracle", ACCOUNTS.oracle.evm, ACCOUNTS.oracle.keyName);
        const t = await sdkKey("flhTrustee", ACCOUNTS.trustee.evm, ACCOUNTS.trustee.keyName);
        oraclePub = o.publicKey.toStringRaw();
        trusteePub = t.publicKey.toStringRaw();
        const tx = new TopicCreateTransaction().setTopicMemo(TOPIC_MEMO).setSubmitKey(o.publicKey).setAdminKey(t.publicKey).setAutoRenewAccountId(ACCOUNTS.relayer.id!).setMaxTransactionFee(new Hbar(2)).freezeWith(client);
        return tx.sign(t);
      },
    });
    if (receipt?.topicId) {
      const topicId = receipt.topicId.toString();
      saveSmoke({ topicId, oraclePub, trusteePub });
      console.log(`  topic: ${topicId}  (https://hashscan.io/testnet/topic/${topicId})`);
    }
    closeClient();
  }
  const topicId = loadDemo().topicId as string | undefined;
  if (topicId) {
    const st = loadDemo();
    const info = await eventually(() => mirror<TopicInfo>(`/api/v1/topics/${topicId}`), (i) => Boolean(i?.submit_key));
    const ok = info?.submit_key?.key === st.oraclePub && info?.admin_key?.key === st.trusteePub && info?.auto_renew_account === ACCOUNTS.relayer.id && info?.memo === TOPIC_MEMO;
    console.log(`  mirror: memo "${info?.memo}", submit_key ${info?.submit_key?.key === st.oraclePub ? "== oracle ✓" : "✖"}, admin_key ${info?.admin_key?.key === st.trusteePub ? "== trustee ✓" : "✖"}, auto_renew_account ${info?.auto_renew_account}`);
    if (!ok) {
      process.exitCode = 1;
      console.log("  ✖ topic keys are not as intended — stop and report");
    } else saveSmoke({ topicVerifiedAt: new Date().toISOString() });
  }
}

// ------------------------------------------------------------ bond
if (phases.includes("deploy")) {
  if (loadDemo().bond) console.log(`\n[${PHASE}] bond already deployed: ${loadDemo().bond} — skip`);
  else {
    const now = await latestTs(p);
    const { args, isin, startingDate, maturityDate } = bondArgs(now, { ...BOND, admin: dep.evm, cap: P.cap, startDelaySec: 120 });
    const factory = new Contract(FACTORY, FACTORY_ABI, p);
    const predicted = await factory.deployBond.staticCall(...args, { from: dep.evm }).catch(() => undefined);
    console.log(`\nbond plan: ${BOND.name} (${BOND.symbol}), ISIN ${isin}, startingDate ${iso(startingDate)}, maturityDate ${iso(maturityDate)} (now + ${BOND.maturityMin} min)`);
    console.log(`  after this bond, phase 2 must start within ${((maturityDate - P.issuanceStartDelay - P.issuance - P.margin - now) / MIN).toFixed(1)} min (by ${iso(maturityDate - P.issuanceStartDelay - P.issuance - P.margin)})`);
    if (predicted) console.log(`  simulated bond address: ${predicted}`);
    const r = await tx(`deployBond ISIN ${isin} (${BOND.name} ${BOND.symbol})`, factory, "deployBond", args);
    if (EXECUTE && r.receipt) {
      const iface = new Interface(FACTORY_ABI);
      const ev = (r.receipt as { logs: { topics: string[]; data: string }[] }).logs
        .map((l) => { try { return iface.parseLog(l); } catch { return null; } })
        .find((x) => x?.name === "BondDeployed");
      if (!ev) throw new Error("BondDeployed event not found in the receipt");
      const bond = String(ev.args.bondAddress);
      saveSmoke({ bond, isin, bondStartingDate: startingDate, bondMaturityDate: maturityDate, bondDeployTx: r.hash! });
      console.log(`  bond: ${bond}  (https://hashscan.io/testnet/contract/${bond})`);
    }
  }
}

// ------------------------------------------------------------ issuer
if (phases.includes("issuer")) {
  if (!loadDemo().bond) deferred("addIssuer(deployer)", "the bond does not exist yet (deploy first; smoke 126,989 gas)");
  else if (await eventually(() => bondAt(p).isIssuer(dep.evm), (v) => v === true)) console.log(`\n[${PHASE}] deployer already a registered SSI issuer — skip`);
  else await tx("addIssuer(deployer) — SSI issuer", bondAt(p), "addIssuer", [dep.evm]);
}

// ------------------------------------------------------------ kyc
if (phases.includes("kyc")) {
  for (const r of KYC_HOLDERS) {
    const vcId = `urn:faultline:demo:kyc:${r}`;
    if (!loadDemo().bond) { deferred(`grantKyc(${r}, ${vcId})`, "the bond does not exist yet (smoke ≈ 257k–274k gas)"); continue; }
    const b = bondAt(p);
    if ((await b.getKycStatusFor(ACCOUNTS[r].evm)) === 1n) { console.log(`\n[${PHASE}] ${r} bond KYC already GRANTED — skip`); continue; }
    if (!(await eventually(() => b.isIssuer(dep.evm), (v) => v === true))) { deferred(`grantKyc(${r}, ${vcId})`, "addIssuer(deployer) must land first"); continue; }
    const now = await latestTs(p);
    await tx(`grantKyc(${r}, ${vcId}) — opaque vcId, no VC document`, b, "grantKyc", [ACCOUNTS[r].evm, vcId, BigInt(now), BigInt(now + 100 * 365 * 24 * 3600), dep.evm]);
  }
}

// ------------------------------------------------------------ state of the bond
if (loadDemo().bond) {
  const b = bondAt(p);
  const st = loadDemo();
  console.log(`\nbond ${st.bond} (ISIN ${st.isin}):`);
  console.log(`  ${await b.name()} / ${await b.symbol()}, decimals ${await b.decimals()}, controllable ${await b.isControllable()}, paused ${await b.paused()}, internal KYC ${await b.isInternalKycActivated()}`);
  console.log(`  totalSupply ${usd(await b.totalSupply())}, startingDate ${iso(Number(st.bondStartingDate))}, maturityDate ${iso(Number(await b.getMaturityDate()))}`);
  for (const [n, role] of Object.entries(ROLES)) console.log(`  getRoleMemberCount(${n}) = ${await b.getRoleMemberCount(role)}`);
  for (const r of KYC_HOLDERS) console.log(`  getKycStatusFor(${r}) = ${await b.getKycStatusFor(ACCOUNTS[r].evm)} (1 = GRANTED)`);
  const latest = Number(st.bondMaturityDate) - P.issuanceStartDelay - P.issuance - P.margin;
  console.log(`  phase 2 (pool deploy) must start before ${iso(latest)} (${((latest - (await latestTs(p))) / MIN).toFixed(1)} min from now)`);
}
await printHbar(start);
