// Ported from the reference repo (ops/scripts/smoke/smoke-1-token.ts) on 2026-11-06 with the new FLH_* accounts; nothing from the old deployment is reused.
// Smoke phase 1 — the HTS test stablecoin, the same way as spike S3 (faultline docs/LESSONS.md S3):
//   create     SDK TokenCreate "Faultline Test USD" (fUSD), 6 decimals, FungibleCommon, treasury = deployer,
//              admin/supply/KYC key = deployer, NO wipe/freeze/pause key, freezeDefault false. Payer = deployer, which
//              is still HOLLOW: Hedera docs say a hollow payer signing with its ECDSA key completes the account;
//              whether a TokenCreate does it is not documented, so this run finds out (fallback: PHASE=complete).
//   associate  sponsor, A, B: IHRC719(token).associate() via the facade (their first EVM tx completes them, as in S3)
//   kyc        SDK TokenGrantKyc sponsor, A, B (associate → KYC → fund; KYC before association fails with 184, S3)
//   fund       SDK TransferTransaction treasury → sponsor 10, A 1,000, B 1,000 fUSD (one tx)
//   complete   FALLBACK ONLY (not in the default list): a 0-value self-transfer from the deployer, its first EVM tx
// PHASE=create,associate,kyc,fund is the default. Every step skips itself when the mirror node shows it done, so a
// rerun resumes. Dry run: EVM steps are simulated; SDK steps print the exact plan (they cannot be simulated).
import { Hbar, TokenCreateTransaction, TokenGrantKycTransaction, TokenSupplyType, TokenType, TransferTransaction, type Client } from "@hashgraph/sdk";
import { Contract, getAddress } from "ethers";
import { gasPriceWei, record, signerFor } from "../lib/common.js";
import { closeClient, mirror, sdkStep } from "../lib/hedera.js";
import { ACCOUNTS, EXECUTE, TOKEN_ABI, USD, balances, clientOf, feeOf, loadSmoke, mirrorAccount, printHbar, printInvariants, provider, saveSmoke, tx, usd, type Role } from "./lib.js";

const PHASE = "smoke-1";
const phases = (process.env.PHASE ?? "create,associate,kyc,fund").split(",");
const HOLDERS = ["sponsor", "investorA", "investorB"] as const;
const AMOUNT: Record<(typeof HOLDERS)[number], bigint> = { sponsor: USD(10n), investorA: USD(1_000n), investorB: USD(1_000n) };
const INITIAL_SUPPLY = USD(10_000n); // 10,000.000000 fUSD to the treasury; 2,010 are distributed
const dep = ACCOUNTS.deployer;

const p = await provider();
const start = await balances();

type Rel = { balance: number; kyc_status: string; freeze_status: string };
async function rel(role: Role): Promise<Rel | undefined> {
  const tokenId = loadSmoke().token as string | undefined;
  if (!tokenId) return undefined;
  return (await mirror<{ tokens: Rel[] }>(`/api/v1/accounts/${ACCOUNTS[role].id}/tokens?token.id=${tokenId}`))?.tokens?.[0];
}
async function showRelationships(label: string): Promise<void> {
  const tokenId = loadSmoke().token as string | undefined;
  console.log(`\n${label}: token ${tokenId ? `${tokenId} (${loadSmoke().tokenAddress})` : "(not created yet)"}`);
  if (!tokenId) return;
  for (const r of ["deployer", ...HOLDERS] as Role[]) {
    const x = await rel(r);
    console.log(`  ${r.padEnd(9)} ${ACCOUNTS[r].id}: ${x ? `associated, balance ${usd(BigInt(x.balance))}, kyc ${x.kyc_status}, freeze ${x.freeze_status}` : "NOT associated"}`);
  }
}
/** EXECUTE only: the mirror node lags consensus by a few seconds, so poll (≤ ~30 s) before deciding a step is not done. */
async function relWhen(role: Role, ok: (x: Rel | undefined) => boolean): Promise<Rel | undefined> {
  let x = await rel(role);
  for (let i = 0; EXECUTE && !ok(x) && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    x = await rel(role);
  }
  return x;
}
const deferred = (what: string, why: string) => console.log(`\n[${PHASE}] ${what}\n  simulation deferred: ${why}`);

await showRelationships("before");
try {
  // ------------------------------------------------------------ complete (fallback only)
  if (phases.includes("complete")) {
    const m = await mirrorAccount(dep.id!);
    if (m?.key) console.log(`\n[${PHASE}] deployer already complete (${m.key._type}) — skip`);
    else {
      const gas = await p.estimateGas({ from: dep.evm, to: dep.evm, value: 0n });
      const gasLimit = (gas * 130n) / 100n;
      console.log(`\n[${PHASE}] complete the hollow deployer: 0-value self-transfer (its first signed EVM tx)`);
      console.log(`  from: ${dep.evm}\n  to: ${dep.evm}\n  simulation: OK, gas ≈ ${gas}, cost ≈ ${(Number(gas * (await gasPriceWei(p))) / 1e18).toFixed(4)} HBAR; gas limit ${gasLimit}`);
      if (!EXECUTE) console.log("  (dry run — nothing sent; only needed if TokenCreate refuses the hollow payer)");
      else {
        const t = await (await signerFor(dep.network)).sendTransaction({ to: dep.evm, value: 0n, gasLimit });
        console.log(`  sent: ${t.hash}`);
        const r = await t.wait();
        console.log(`  status: SUCCESS  gasUsed: ${r?.gasUsed}`);
        record(PHASE, "deployer 0-value self-transfer (completes the hollow account)", t.hash, { status: "SUCCESS", from: dep.evm, to: dep.evm, gasUsed: r?.gasUsed?.toString(), ...(await feeOf(t.hash)) });
      }
    }
  }

  // ------------------------------------------------------------ create
  if (phases.includes("create")) {
    if (loadSmoke().token) console.log(`\n[${PHASE}] token already created: ${loadSmoke().token} — skip`);
    else {
      const maxFee = new Hbar(30);
      let client: Client | undefined;
      const receipt = await sdkStep({
        spike: PHASE,
        what: "TokenCreate fUSD (Faultline Test USD), payer = deployer",
        payer: `deployer ${dep.id} (hollow: the key is checked against its EVM alias)`,
        client: async () => (client = await clientOf("deployer")),
        plan: {
          type: "TokenCreateTransaction",
          name: "Faultline Test USD",
          symbol: "fUSD",
          memo: "Faultline smoke run - TESTNET ONLY, no value",
          tokenType: "FungibleCommon",
          supplyType: "Infinite",
          decimals: 6,
          initialSupply: `${INITIAL_SUPPLY} base units (${usd(INITIAL_SUPPLY)} fUSD) to the treasury`,
          treasury: `deployer ${dep.id}`,
          "admin/supply/kyc key": "deployer ECDSA public key (taken from the keystore key at EXECUTE; none on chain yet)",
          "wipe/freeze/pause/fee-schedule key": "NONE",
          freezeDefault: false,
          customFees: "none",
          maxTransactionFee: `${maxFee} (S3 TokenCreate cost 13.393 HBAR)`,
        },
        build: () => {
          const key = client!.operatorPublicKey!;
          return new TokenCreateTransaction()
            .setTokenName("Faultline Test USD")
            .setTokenSymbol("fUSD")
            .setTokenMemo("Faultline smoke run - TESTNET ONLY, no value")
            .setTokenType(TokenType.FungibleCommon)
            .setSupplyType(TokenSupplyType.Infinite)
            .setDecimals(6)
            .setInitialSupply(Number(INITIAL_SUPPLY))
            .setTreasuryAccountId(dep.id!)
            .setAdminKey(key)
            .setSupplyKey(key)
            .setKycKey(key)
            .setFreezeDefault(false)
            .setMaxTransactionFee(maxFee);
        },
      });
      if (receipt?.tokenId) {
        const tokenAddress = getAddress("0x" + receipt.tokenId.toSolidityAddress());
        saveSmoke({ token: receipt.tokenId.toString(), tokenAddress });
        console.log(`  token: ${receipt.tokenId.toString()}  EVM ${tokenAddress}  (https://hashscan.io/testnet/token/${receipt.tokenId.toString()})`);
        const m = await mirrorAccount(dep.id!);
        console.log(`  deployer after TokenCreate: ${m?.key ? `COMPLETE (${m.key._type}) — a hollow payer worked` : "still hollow on the mirror node (may lag; rerun to check)"}`);
      }
    }
  }

  // ------------------------------------------------------------ associate (EVM, each holder signs)
  if (phases.includes("associate")) {
    const tokenAddress = loadSmoke().tokenAddress as string | undefined;
    for (const r of HOLDERS) {
      if (!tokenAddress) { deferred(`${r} IHRC719(fUSD).associate()`, "the token does not exist yet (create first)"); continue; }
      if (await rel(r)) { console.log(`\n[${PHASE}] ${r} already associated — skip`); continue; }
      await tx(PHASE, r, `${r} IHRC719(fUSD).associate() (first signed tx: completes the hollow account)`, new Contract(tokenAddress, TOKEN_ABI, p), "associate", []);
    }
  }

  // ------------------------------------------------------------ kyc (SDK, deployer = KYC key)
  if (phases.includes("kyc")) {
    const tokenId = (loadSmoke().token as string | undefined) ?? "<token id from create>";
    for (const r of HOLDERS) {
      const x = await relWhen(r, (y) => y !== undefined);
      if (x?.kyc_status === "GRANTED") { console.log(`\n[${PHASE}] ${r} KYC already GRANTED — skip`); continue; }
      if (!x) console.log(`\n  ⚠ ${r} is not associated yet: TokenGrantKyc would fail with 184 (S3). EXECUTE stops here.`);
      if (EXECUTE && !x) throw new Error(`${r} not associated; run PHASE=associate first`);
      await sdkStep({
        spike: PHASE,
        what: `TokenGrantKyc(${r})`,
        payer: `deployer ${dep.id}`,
        client: () => clientOf("deployer"),
        plan: { type: "TokenGrantKycTransaction", token: tokenId, account: `${ACCOUNTS[r].id} (${r})` },
        build: () => new TokenGrantKycTransaction().setTokenId(tokenId).setAccountId(ACCOUNTS[r].id!),
      });
    }
  }

  // ------------------------------------------------------------ fund (SDK, one transfer)
  if (phases.includes("fund")) {
    const tokenId = (loadSmoke().token as string | undefined) ?? "<token id from create>";
    const todo: [(typeof HOLDERS)[number], bigint][] = [];
    for (const r of HOLDERS) {
      const x = await relWhen(r, (y) => y?.kyc_status === "GRANTED");
      const have = x ? BigInt(x.balance) : 0n;
      if (have >= AMOUNT[r]) console.log(`\n[${PHASE}] ${r} already holds ${usd(have)} fUSD — skip`);
      else {
        if (EXECUTE && x?.kyc_status !== "GRANTED") throw new Error(`${r} has no KYC yet; run PHASE=kyc first`);
        todo.push([r, AMOUNT[r] - have]);
      }
    }
    if (todo.length) {
      const total = todo.reduce((a, [, v]) => a + v, 0n);
      await sdkStep({
        spike: PHASE,
        what: `TokenTransfer treasury → ${todo.map(([r, v]) => `${r} ${usd(v)}`).join(", ")} fUSD`,
        payer: `deployer ${dep.id} (treasury)`,
        client: () => clientOf("deployer"),
        plan: {
          type: "TransferTransaction",
          token: tokenId,
          from: `${dep.id} (treasury) -${usd(total)}`,
          ...Object.fromEntries(todo.map(([r, v]) => [`to ${r}`, `${ACCOUNTS[r].id} +${usd(v)}`])),
        },
        build: () => {
          const t = new TransferTransaction().addTokenTransfer(tokenId, dep.id!, -Number(total));
          for (const [r, v] of todo) t.addTokenTransfer(tokenId, ACCOUNTS[r].id!, Number(v));
          return t;
        },
      });
    }
  }
} finally {
  closeClient();
}

await showRelationships("now");
await printInvariants(p);
await printHbar(start);
