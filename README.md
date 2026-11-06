# Faultline

**A parametric earthquake catastrophe bond on Hedera.** Investors earn a coupon for taking earthquake risk. If a
USGS-reviewed earthquake crosses a preset threshold inside the insured zone, bond principal is written down
automatically, and the matching collateral goes to the sponsor once a short challenge window ends. There is no loss
adjuster and no claims process, and every step leaves an on-chain and HCS audit trail.

> **Status:** a prototype. It is self-reviewed, not audited, and not a regulated insurance or securities product. Do
> not use it with real money. Each feature is marked as **testnet-verified** or **mock-tested** in
> [Verified vs mock-tested](#5-verified-vs-mock-tested).

---

## 1. The idea and why it matters

### The problem

A catastrophe (cat) bond moves disaster risk from a sponsor (a government or an insurer) to capital-market investors:

- Investors put up the principal and receive a coupon.
- If a defined disaster happens, they lose part or all of the principal, and that money pays the sponsor.

Cat bonds exist today, mostly as large Rule 144A deals arranged by a few specialist firms: the market stood at
**$65.5 billion outstanding at the end of Q3 2026**
([Artemis, Q3 2026 report](https://www.artemis.bm/wp-content/uploads/2026/10/catastrophe-bond-ils-market-report-q3-2026-1.pdf)).
Setting one up and running it costs a lot: the special purpose vehicle, the trustee, the calculation agent, the paying
agent and the reporting. For small and private deals the market already uses a "cat bond lite", which skips
cost-intensive steps such as a full prospectus and a catastrophe model report
([OECD, 2024](https://doi.org/10.1787/ab1e49ef-en)). **India has no sovereign cat bond or sovereign parametric cover** ([OECD, 2024](https://doi.org/10.1787/ab1e49ef-en)), even though it has active fault zones such as
Kutch, where the 2001 Bhuj earthquake (M7.7) struck. Sources and dates: [`docs/research/MARKET.md`](docs/research/MARKET.md).

### What Faultline does

Faultline runs the whole lifecycle of a parametric cat bond on Hedera, without a person in the payout path:

- **Issue:** a real security token (ATS v8 bond), sold for a real stablecoin (HTS) to KYC'd investors only.
- **Trigger:** a calculation agent reads the USGS record, applies a public rule fixed at issuance, and signs the
  result.
- **Check:** the signed result is published to an HCS topic, then submitted on-chain, where a challenge window opens.
  A trustee can veto or pause during the window.
- **Settle:** after the window anyone can execute the event. The loss is applied to every holder in one step through
  a global loss index, and the sponsor's payout becomes claimable at once.
- **Redeem:** at maturity each holder gets principal × (1 − loss) plus the accrued coupon. The books close to the
  base unit.

### USP

1. **Both Hedera Studios, each for a real job:**
   - Asset Tokenization Studio (ATS v8) provides the bond, KYC and controller redemption.
   - An HTS stablecoin holds the collateral and pays the coupon.
   - HCS is a public, ordered log of every oracle message.
   - Custom Hedera EVM contracts handle the trigger and the loss allocation.
2. **The rule is locked at issuance:**
   - The trigger terms (box, depth, magnitude types, payout curve, cooling period) are hashed into `termsHash` and
     fixed in the trigger contract.
   - Nobody can change the rule after investors buy in, not even the issuer.
3. **Trust is bounded, not hidden:**
   - The oracle is trusted, and the README says so.
   - Its power is limited by the challenge window, the trustee veto, pause, replay protection and EIP-712 signatures
     bound to the chain and the contract.
   - Every HCS message carries the oracle's own signature, inside the payload.
4. **One loss index for all holders.** A write-down is O(1) whatever the number of holders, and the ATS balances do
   not need to change.
5. **Honest timing:**
   - From the earthquake to finality takes hours: USGS review, a cooling period and the challenge window (48 to 72
     hours in production, short in the demo).
   - From finality to settlement takes seconds.
6. **Self-serve issuance.** The `/issuer` page launches a new bond with the issuer's own wallet. It deploys and wires
   the contracts and audits the bond roles at the end.

### What it is not

- Not retail access: real cat bonds are sold to qualified institutional buyers.
- Not a licensed product: there is no SPV, no insurance licence and no securities offering.
- Not faster claims adjustment: parametric bonds already skip claims adjustment. The value is cheaper structuring and
  a transparent, automatic, auditable lifecycle for small private deals.

---

## 2. Entities and roles

### People and keys

| Entity | Who it is in real life | What it does in Faultline | What it cannot do |
| --- | --- | --- | --- |
| **Sponsor** | The insured party: a state government, an insurer or a reinsurer | Funds the coupon reserve for the whole term before the sale opens; receives the written-down collateral after an executed event; at the end, claims the unused reserve and rounding dust | Cannot trigger an event or change the terms |
| **Investors** | Funds that buy disaster risk for a yield | Pass KYC, pay the stablecoin into the pool, receive bond units 1:1, earn the coupon, then redeem at maturity | Cannot redeem before maturity plus grace, or while an event is pending |
| **Issuer / bond admin (deployer)** | The arranger that sets up the deal | Creates the ATS bond and the stablecoin wiring, deploys the pool and the trigger, grants KYC, and gives the bond's mint and controller roles to the pool only | A foreign mint is caught by the pool's supply guard (D4, D18): redemption stops (a lock, not a drain). In production this role belongs in a multisig |
| **Calculation agent (oracle)** | The independent firm that applies the trigger rule | Watches USGS, applies the payout curve off-chain, signs an EIP-712 attestation and the HCS message; holds the HCS topic's submit key | Pays no fees and holds no funds. A false attestation can be vetoed inside the window |
| **Relayer** | The oracle's operations account | Pays the HCS and EVM fees for the oracle: publishes the HCS message, sends `submit` and `execute` | Cannot sign an attestation or an HCS message (spike S7) |
| **Trustee** | The deal's independent trustee | Holds `TRUSTEE_ROLE`: can veto an event inside the challenge window and pause the trigger in an emergency. Holds the HCS topic's admin key | A veto is final for that event. Cannot unpause |
| **Backup trustee** | A second trustee key in separate custody (D17) | Holds `TRUSTEE_ROLE` too, so losing one trustee key does not remove the veto. Only a trustee can add or remove trustees | Same limits as the trustee |
| **Trigger admin** | The deal administrator | Unpauses the trigger and rotates the oracle key | Since D17 it can no longer add or remove trustees, so it cannot take the veto away |
| **Keeper** | Anyone: a bot, the relayer or a holder | Calls `execute` once the challenge window has ended | Changes nothing that the rule has not already decided |

### Contracts and Hedera services

| Component | Type | Role |
| --- | --- | --- |
| **ATS v8 bond** | Hedera Asset Tokenization Studio security | The bond units, with KYC, roles and controller redemption. The pool is the only minter |
| **HTS stablecoin** (test token fUSD) | Hedera Token Service, 6 decimals, with a KYC key | The collateral, the coupon reserve and every payout |
| **`FaultlinePool`** | Custom Solidity contract (Hedera EVM) | Holds the collateral and the coupon reserve; mints units on `invest`; keeps the loss index L; on `applyLoss`, credits the sponsor; on `redeem`, burns units through ATS and pays principal × (1 − L) plus the coupon |
| **`FaultlineTrigger`** | Custom Solidity contract (Hedera EVM) | Checks the oracle's EIP-712 attestation against `termsHash`; runs the challenge window, veto, pause, revisions and replay protection; on `execute`, calls the pool |
| **HCS topic** | Hedera Consensus Service | A public, ordered log of every attestation and advisory. The oracle holds the submit key, the trustee the admin key, and the relayer pays (D16). The chain, not HCS, is the source of truth |
| **Mirror node** | Hedera read API | Read by the oracle, the dashboard and the audit checks |
| **USGS ComCat** | External data source | The earthquake record (magnitude, type, depth, location, review status) |

---

## 3. How it works

### System architecture

```
                         off-chain                                         Hedera testnet (chain 296)
 ┌──────────────────────────────────────────────┐        ┌──────────────────────────────────────────────────────────┐
 │ USGS ComCat (earthquake record)              │        │  HCS topic  ◀── signed attestation / advisory messages    │
 │        │ fetch, D8 ledger, rule              │        │  (submit key = oracle, admin key = trustee, relayer pays) │
 │        ▼                                     │  HCS   │                                                          │
 │ oracle/ (calculation agent)  ────────────────┼───────▶│  FaultlineTrigger (EVM)                                  │
 │  rule → loss bps → EIP-712 sign (oracle key) │ submit │   termsHash, challenge window, veto, pause, revisions    │
 │  relayer key pays HCS + EVM fees             ├───────▶│        │ execute() → applyLoss(L)                        │
 │  keeper: execute() after the window          │        │        ▼                                                 │
 └──────────────────────────────────────────────┘        │  FaultlinePool (EVM) ── mint / controllerRedeem ──▶ ATS   │
 ┌──────────────────────────────────────────────┐        │   loss index L, coupon index, claims, supply guard   v8  │
 │ shared/ts: JCS terms, termsHash, dataHash,   │        │        │ transferFrom / transfer, isKyc (0x167)    bond  │
 │ EIP-712 types, HCS message format            │        │        ▼                                                 │
 │ (used by oracle, web, scripts and ops)       │        │  HTS stablecoin (fUSD): collateral, reserve, payouts      │
 └──────────────────────────────────────────────┘        └──────────────────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────┐                     ▲                      ▲
 │ web/ (Next.js dashboard): overview, investor,│  JSON-RPC relay      │   mirror node reads  │
 │ sponsor, trustee, replay, evidence, /issuer  ├──────────────────────┘──────────────────────┘
 │ wallet writes through MetaMask (gas × 1.3)   │
 └──────────────────────────────────────────────┘
 ┌──────────────────────────────────────────────┐
 │ ops/ (Hardhat 3 + keystore): smoke run, full │  owner-run, dry run first, EXECUTE=1 sends
 │ demo phases 0-7, issuer helpers              │
 └──────────────────────────────────────────────┘
```

### Lifecycle

```
 Sponsor ──fund coupon reserve──▶ FaultlinePool ◀──stablecoin── Investors (KYC'd)
                                      │  mints ATS bond units 1:1
                                      ▼
                              ─── risk period ───
 USGS record ─▶ Oracle: apply rule, sign EIP-712 ─▶ HCS topic (signed message, relayer pays)
                                      │
                                      ▼
                        FaultlineTrigger.submit()  ── challenge window opens
                                      │      ▲
                         trustee veto / pause (inside the window)
                                      ▼
                  window ends ─▶ anyone: execute() ─▶ Pool.applyLoss(L)
                                      │                 └─▶ sponsor's payout claimable
                                      ▼
            maturity + grace ─▶ holder: redeem() ─▶ ATS controllerRedeem ─▶ claim()
                                principal × (1 − L) + accrued coupon
```

1. **Setup:**
   - The issuer deploys the bond, the pool and the trigger, and gives the bond roles to the pool only.
   - The sponsor funds the full-term coupon reserve, so nobody subscribes to an unfunded coupon.
2. **Subscription:** KYC'd investors pay the stablecoin and receive bond units 1:1. Issuance closes before the risk
   period starts.
3. **Risk period:** the coupon accrues on the outstanding principal through an index. Nothing is paid out yet.
4. **Event:**
   - The oracle sees a qualifying quake that USGS has reviewed, and waits for the cooling period.
   - It computes the loss from the curve, signs an attestation, publishes it to HCS and submits it on-chain.
5. **Challenge window:**
   - The trustee can veto the event, or pause the trigger, which stops the clock.
   - If USGS revises the record, the oracle can replace its attestation with a higher nonce, and the window restarts.
   - Replaying the same signature is rejected.
6. **Write-down:**
   - After the window anyone calls `execute`.
   - The pool raises the loss index and credits the sponsor the matching collateral, in one transaction.
   - The holders' ATS balances do not change, but each unit is now worth less. The dashboard shows the effective
     value.
7. **Maturity:**
   - After maturity plus the grace period, with no pending event, each holder calls `redeem` and then `claim`.
   - The sponsor claims the unused reserve and the dust.

### The trigger rule (example terms: Kutch, India)

| Term | Value |
| --- | --- |
| Insured box | latitude 22.5 to 24.5 N, longitude 68.5 to 71.5 E |
| Depth | 70 km or less |
| Magnitude | moment magnitude only, reviewed by USGS |
| Payout curve | linear: M7.0 → 0 % loss, M8.0 → 100 % loss, rounded down to whole basis points |
| Example | the Bhuj earthquake of 2001 (M7.7, USGS `usp000a8ds`) → **7000 bps = 70 % loss** |
| Losses | cumulative across events, capped at 100 % |

The canonical terms JSON is serialised with RFC 8785 (JCS). Its keccak256 is the `termsHash` stored in the trigger, so
the oracle and the contract are provably running the same rule.

### Demo mode (replay)

The demo replays the real Bhuj record with `mode: "replay"` terms:
- The record's times are shifted into the demo bond's risk period, and the dashboard shows a REPLAY badge.
- Replay terms are refused on any chain other than Hardhat (31337) and Hedera testnet (296).
- The demo uses a challenge window of seconds. Production would use 48 to 72 hours.

---

## 4. How to run it

### Prerequisites

- Node.js 22 and npm.
- For testnet only: Hedera testnet accounts (ECDSA) and MetaMask on Hedera testnet:
  - RPC `https://testnet.hashio.io/api`
  - chain id `296`
  - currency HBAR
  - explorer `https://hashscan.io/testnet`
- Private keys never go into this repo, a `.env` file, a chat or a log. Testnet keys live only in the global
  Hardhat 3 keystore (see below).

### Install and check (local, no keys needed)

```bash
npm run setup     # npm ci in the root, oracle/, web/ and ops/
npm run check     # compile + Hardhat tests + typechecks + oracle tests + web lint/tests/build + ops typecheck
```

### Local end-to-end (mock-tested, local only)

```bash
npm run e2e:local         # 3 full lifecycles on an in-process chain: veto + replay, two events, cap + Superseded
npm run oracle:e2e:local  # the oracle CLI against a local node: Bhuj replay, keeper, advisories (mock HCS)
```

### Dashboard

```bash
npm run node                    # terminal 1: local Hardhat node on 127.0.0.1:8545
npm run dashboard:demo:local    # terminal 2: deploys a live demo world on that node
npm run web:dev                 # terminal 3: http://localhost:3000
```

- The dashboard has views for the overview, investor, sponsor, trustee, replay and evidence.
- Its testnet mode reads the Hedera testnet demo deployment (see [`docs/COMMANDS.md`](docs/COMMANDS.md)).
- `/issuer` launches a new bond with your own wallet. It is mock-tested locally, and its testnet run is not yet
  verified (RT-29).

### Hedera testnet (the owner runs every real transaction)

1. Set each account's key in the keystore, from `ops/`. It asks for the keystore password and then the key:
   ```bash
   cd ops && npx hardhat keystore set FLH_DEPLOYER_PRIVATE_KEY
   ```
   Repeat this for `FLH_TRUSTEE`, `FLH_TRUSTEE_BACKUP`, `FLH_ORACLE`, `FLH_SPONSOR`, `FLH_INVESTOR_A`,
   `FLH_INVESTOR_B` and `FLH_RELAYER` (each followed by `_PRIVATE_KEY`). The public ids and addresses are in
   [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).
2. Preflight. This checks the balances, the build and every key → address match, and sends nothing:
   ```bash
   cd ops && CHECK_KEYS=1 npm run demo:0
   ```
3. Run each phase of the full demo:
   - Run it first as a **dry run**: it simulates every transaction and prints the gas and HBAR, and sends nothing.
   - Then run it for real with `EXECUTE=1`, by the owner only:
   ```bash
   npm run ops:demo:1              # dry run
   EXECUTE=1 npm run ops:demo:1    # real transactions
   ```
   - Phases 1 to 7: bond and HCS topic, deploy, subscribe, Flow A (veto, replay rejection), Flow B (live oracle, keeper
     execute), settle, and Sourcify verification.
   - Every transaction is recorded in [`docs/TESTNET-EVIDENCE.md`](docs/TESTNET-EVIDENCE.md).

Every command is listed in [`docs/COMMANDS.md`](docs/COMMANDS.md). The design and the decision log (D1 to D18) are in
[`HANDOVER.md`](HANDOVER.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 5. Verified vs mock-tested

| Area | Status | Note |
| --- | --- | --- |
| ATS bond issue, KYC, mint | verified on testnet (by hand) | old test bond TCB, ATS v4 deployment |
| ATS burn by a contract with ROLE_CONTROLLER | verified on testnet | throwaway Redeemer contract |
| HIP-1215 self-scheduling | verified on testnet | alarm contract only |
| ATS v8 bond for Faultline (nominal 1 USD, 6 decimals) | verified on testnet | spike S1; this project's bonds FLSMK `0.0.11329898` and FLDMO `0.0.11330397` |
| ATS v8 mint and issue by a contract with ROLE_ISSUER | verified on testnet | spike S1, owner-only probe |
| ATS v8 controllerRedeem without holder KYC and after maturity | verified on testnet | spike S1 |
| ATS v8 controllerRedeem and mint revert while the bond is paused | verified on testnet | spike S2 (`IsPaused()`) |
| ATS mint / transfer to a non-KYC wallet reverts | verified by simulation on testnet | `InvalidKycStatus()`, no tx sent |
| HTS stablecoin into and out of a contract (associate, KYC, transferFrom, transfer) | verified on testnet | spike S3; this project's fUSD `0.0.11329874` |
| HTS facade failure mode (no KYC, frozen) | verified on testnet | reverts with empty data, never returns `false` |
| HCS topic create, publish, mirror-node read back (submit key enforced) | verified on testnet | spike S5; this project's topic `0.0.11330395` |
| Interfaces and mocks (IAtsBond, IHRC719, IHederaTokenServiceLite, IFaultlinePool, IFaultlineTrigger; MockBond, MockUSD, MockHTS, MockTrigger) | written, mock-tested | mocks copy S1–S3 behaviour; mocks themselves are never testnet-verified |
| Testnet smoke run (HANDOVER §10 step 5b): one full lifecycle, Bhuj replay, L = 7000 | **testnet-verified**, D18 build | 2026-11-05, 33 txs, 40.06 HBAR; demo-only schedule (60 s window, 27 min risk period) |
| **Full testnet demo (HANDOVER §10 step 9)** | **testnet-verified** | 2026-11-05/06, D18 build `a0b1dd5`, 34 txs + 2 HCS messages, ≈ 22.9 HBAR; demo-only schedule (120 s window, 26 min risk period); bond FLDMO `0.0.11330397`, pool `0.0.11330416`, trigger `0.0.11330420`, topic `0.0.11330395`; every tx, HCS message and result in docs/TESTNET-EVIDENCE.md |
| FaultlinePool, lifecycle | **testnet-verified** (smoke run + full demo), D18 build | constructor on real fUSD + ATS v8 bond, `initialize` (HIP-719 associate), `isKyc` pass path via real `0x167`, `fundCoupons`, `invest` (ATS `mint`), `applyLoss` (L = 7000), `redeem` (ATS `controllerRedeem`), `claim`, `sweepExcess`, `sweepDust`; books closed to the base unit twice. `test/pool.*` and the invariant fuzz. Revert paths and odd flows: mock-tested only |
| FaultlineTrigger: submit, window, execute | **testnet-verified** (smoke run + full demo) | oracle-signed EIP-712 attestations on chain 296. Tests in `test/trigger.*`, incl. integration tests with the real pool |
| Veto | **testnet-verified** | trustee vetoed the SYNTHETIC event in a real tx, while paused; status Vetoed, no loss applied |
| Pause / D2, pause before the deadline | **testnet-verified** | pause landed with 114 s of 120 s left; effective time and window frozen; `submissionDeadline()` moved with the clock; 45 s paused; only the admin unpaused. `execute` while paused: simulated to `IsPaused()`. **`submit` and `redeem` while paused: mock-tested only** |
| Replay rejection | **testnet-verified** | same attestation + signature re-sent as a real tx: reverted `EventFinalised(eventId, 2)`; the oracle, run again, published nothing |
| Oracle end to end: real HCS, live USGS, submit, keeper | **testnet-verified** | real `oracle/` CLI: `usp000a8ds` fetched live, rule → 7000 bps, EIP-712 signature, HCS seq 2 (relayer pays, oracle = submit key), submit, 120 s window, `keeper --once` execute. Flow A did the same with a SYNTHETIC fixture. 83 vitest tests + 1 opt-in live test (skipped by default) + `npm run oracle:e2e:local`. The local Hardhat e2e stays mock-tested |
| D17 trustee admin and backup trustee | **testnet-verified** | the primary trustee granted `TRUSTEE_ROLE` to the backup in a real tx; on chain the role is its own admin and both trustees hold it; the admin's refused grant and revoke were simulated, not sent. **The backup trustee has never signed a tx** (still hollow) |
| Source verification (Sourcify, shown on HashScan) | **testnet-verified** | `exact_match` for creation and runtime, both demo contracts (pool match 58588033, trigger 58588069), 2026-11-06 |
| Dashboard on testnet: read + one MetaMask write | **testnet-verified**, narrow | testnet mode read the demo; investor B's `redeem` + `claim` went through the dashboard and MetaMask on the first try (gas = estimate × 1.3, `web/src/lib/gas.ts`). No other button was used on testnet: trustee veto and execute through the UI ran on a local node only. Sign in and Sign out are local only. Tests on a Hardhat node: `npm run web:test`, `npm run web:e2e` |
| Shared attestation helpers (`shared/ts`: JCS, termsHash, dataHash, curve, acceptance, EIP-712 signing) | unit-tested; **testnet-verified** | digest equal to `FaultlineTrigger.hashAttestation`; attestations accepted on chain |
| HCS message format with in-payload signatures (`shared/ts/hcsMessage.ts`, D16) | unit-tested; **testnet-verified** | both demo messages read back, signatures recover to the oracle; topic-key layout from spike S7 |
| Revisions (§6.6: higher nonce, newer USGS update, window restart) | **mock-tested only** | no revision was sent on testnet |
| D15 advisory | **mock-tested only** | signed advisory and pending re-check loop ran on a local node with SYNTHETIC records; never published to a real topic |
| Two executed events, the 10000 cap, Superseded | **mock-tested only** | one event executed on testnet; local e2e Flows B and C (`npm run e2e:local`) |
| D11 failure paths (`NotKycForToken`, `HtsCallFailed`) | **mock-tested only** | the pass path ran on testnet; the facade's empty revert itself is from spike S3 |
| Pause after the deadline (SEC-05) | **mock-tested only** | |
| Oracle `evm.transport: "hedera-sdk"` | **mock-tested only** (stubbed SDK), off by default, not used in the demo | `oracle/src/hederaEvm.ts`; the demo used the `relay` transport |
| Local e2e (`npm run e2e:local`): 3 full lifecycles with the real Bhuj record + SYNTHETIC Kutch events | mock-tested, local only | real contracts on a Hardhat chain; MockBond is not ATS, MockUSD/MockHTS are not HTS |
| HIP-1215 scheduled calls in Faultline | not used | a keeper script runs `execute`; coupons accrue and are paid at redemption (HANDOVER §15) |
| D18 supply guard (SEC-15 fix) | deployed on testnet; the burn case **mock-tested only** | a holder's own ATS burn no longer locks anyone. The burn itself is simulated on the real bond (it works before the bond's maturity, `InvalidPartition` after), never mined (`ops/scripts/demo/rt02-holder-burn.ts`, written, not run) |
| Issuer page (`/issuer`): launch a new bond from the dashboard with your own wallet | **mock-tested, local only**; on testnet **NOT testnet-verified** | Local: full launch on a Hardhat node through the page (MockBond, MockUSD), audit and D4 checks pass, creation code read back equals the build (`web/e2e/issuer.spec.ts`). Testnet: ATS factory bond and every EVM step from MetaMask, HCS topic and HTS KYC through `ops/scripts/issuer/`; none of it has run on testnet (RT-29) |
| Testnet scripts in `ops/` | **ran on testnet 2026-11-05/06** | smoke run and full demo on the FLH_* accounts (docs/ACCOUNTS.md); RT-30 |
| Security review (HANDOVER §10 step 8) | **self-review, not an audit** (2026-10-27) | [`docs/SECURITY-REVIEW.md`](docs/SECURITY-REVIEW.md): Slither, coverage, npm audit, gitleaks, manual checklist, key-compromise table. That review found 0 High. **The later test assessment found one High, SEC-15, fixed by D18**; [`docs/SECURITY-TEST-REPORT.md`](docs/SECURITY-TEST-REPORT.md) holds the current list: 0 Critical, 0 open High. Fixed SEC-01/03/04 (contracts, D17), SEC-08 (oracle), SEC-09 (oracle dependency overrides), SEC-10/11 (web), SEC-15 (D18); accepted SEC-02 (D4 lock), SEC-06 (finality wording) and SEC-19 (unbounded pause). Regression tests in `test/security.contracts.test.ts` and `test/pool.supplyburn.test.ts` |

Test counts on 2026-11-06: `npm run check` → 436 Hardhat tests, 83 oracle tests (+ 1 skipped), 99 web tests, `ops/` typecheck; `npm run web:e2e` → 11. All local, on mocks.

---

## 6. Repository layout

```
faultline/
├── contracts/            FaultlinePool.sol, FaultlineTrigger.sol
│   ├── interfaces/       IAtsBond, IHRC719, IHederaTokenServiceLite, IFaultlinePool, IFaultlineTrigger
│   └── mocks/            MockBond, MockUSD, MockHTS, MockTrigger, … (local tests only)
├── test/                 Hardhat tests: pool, trigger, shared/ts, local e2e, security, invariant fuzz
├── shared/
│   ├── attestation.eip712.json   EIP-712 types (one source for Solidity tests, oracle and web)
│   └── ts/               jcs.ts, attestation.ts (terms, termsHash, dataHash, curve), hcsMessage.ts
├── scripts/              local deploy, e2e, dashboard demo world, oracle e2e; lib/bondAudit.ts
├── oracle/
│   ├── src/              cli, usgs, rule, decision, ledger, attest, hcs, submit, keeper, hederaEvm, …
│   ├── test/             Vitest
│   └── fixtures/         real Bhuj record + labelled SYNTHETIC records
├── web/
│   ├── src/app/          overview, investor, sponsor, trustee, replay, evidence, issuer, api/
│   ├── src/lib/          chain reads, events, HCS, gas, issuer wizard (lib/issuer/)
│   ├── src/config/       networks.ts (local + testnet demo)
│   ├── test/             Vitest
│   └── e2e/              Playwright
├── ops/                  Hardhat 3 testnet scripts
│   ├── scripts/smoke/    smoke run, phases 0-6
│   ├── scripts/demo/     full demo, phases 0-7
│   ├── scripts/issuer/   HCS topic + HTS KYC helpers for /issuer
│   ├── scripts/s7/       HCS topic-key spike
│   ├── scripts/lib/      dry-run / EXECUTE step, keystore signers, mirror helpers
│   └── abi/              ATS v8 factory, bond and error ABIs
├── docs/                 ARCHITECTURE, COMMANDS, TESTNET-EVIDENCE, DEPLOYMENTS, ACCOUNTS, LESSONS,
│                         SECURITY-*, TEST-*, DEMO-SCRIPT, research/, reference/
├── HANDOVER.md           idea, research, design and decision log
└── README.md
```

| Path | Contents |
| --- | --- |
| `contracts/` | `FaultlinePool`, `FaultlineTrigger`, thin interfaces; `contracts/mocks/` for tests |
| `test/` | Hardhat tests (unit, property, invariant) |
| `scripts/` | Deploy, local end-to-end demo, bond role audit (Hardhat 2) |
| `ops/` | Hedera testnet operator scripts (Hardhat 3 + global keystore): full demo phases 0 to 7, smoke run, RT-02; see [`ops/README.md`](ops/README.md) |
| `oracle/` | TypeScript calculation agent + replay CLI; `oracle/fixtures/` (synthetic, labelled) |
| `web/` | Next.js dashboard |
| `docs/` | Architecture, commands, lessons, testnet evidence, security review, demo script, references, spike plan |

Demo video script: [`docs/DEMO-SCRIPT.md`](docs/DEMO-SCRIPT.md). Testnet ids: [`docs/DEPLOYMENTS.md`](docs/DEPLOYMENTS.md); accounts: [`docs/ACCOUNTS.md`](docs/ACCOUNTS.md).

---

## 7. Issuer page

`/issuer` in the dashboard launches a new Faultline bond with the connected wallet as admin, without any contract change:

1. **Terms (a):** box, depth limit, magnitude types, curve floor and ceiling, cooling period, live or replay mode (replay only on
   31337 and 296, D14). The page shows the canonical JSON, the `termsHash` computed with `shared/ts` and the payout curve.
2. **Schedule and economics (b):** checked against the constructor rules before anything is sent
   (`issuanceStart < issuanceEnd <= riskStart < maturity`, `0 < grace <= 365 days`, `0 < window <= 30 days`, coupon, cap and
   minimum ticket above 0, 6-decimal stablecoin), with the coupon reserve the sponsor must fund.
3. **Launch (c, d):** a resumable wizard (progress in localStorage): bond (ATS v8 factory on testnet, MockBond locally), issuer
   role, investor KYC, `FaultlinePool`, `FaultlineTrigger`, an optional backup trustee (signed by the trustee wallet, D17),
   `initialize`, stablecoin KYC, bond roles to the pool, then the bond
   role audit (SEC-20) and the D4 and wiring checks as a pass/fail list. Every wallet step is simulated first and sent with gas =
   estimate x 1.3; the page shows the keccak of the build it deploys and compares it with what each deployment carried. The HCS
   topic and the HTS KYC grants cannot be signed by a browser wallet on Hedera (docs/LESSONS.md "Issuer page"), so the page prints
   the `ops/` command with the values filled in and checks the result on the mirror node.
4. **Result (e):** the config entry to copy, saved under "my deployments"; the header's Bond selector switches every view to it.
   The built-in testnet demo stays the default.

Status: local flow mock-tested (Playwright); **the testnet flow is NOT testnet-verified** until the owner runs it (RT-29).
Commands: docs/COMMANDS.md §9.

---

## 8. Trust assumptions and legal note

**This is a prototype that shows lifecycle automation. It is self-reviewed, not audited, and not a regulated insurance
or securities product. Do not use it with real money.**

### Trust assumptions

1. **Oracle key.** One calculation agent signs every attestation. A stolen key can attest a false event; the challenge
   window, trustee veto, pause and oracle rotation bound the damage. Its rule is hashed into `termsHash`, so it cannot be
   changed without a new bond.
2. **Trustee.** Can veto only inside the window, and a veto is permanent for that event, even if the quake was real.
3. **Pause.** Only a trustee pauses and only the admin unpauses. A pause also delays redemption by its length, and it has
   no maximum: if the admin key is lost during a pause begun before the deadline, redemption and both sweeps stay locked
   for ever (SEC-19, accepted). Production needs the admin in a multisig.
4. **Finality.** Finality is the first `execute` after the window; a revision landing first restarts the window (SEC-06).
   There is no clawback after a later USGS revision.
5. **Single mint authority.** Only the pool may mint. The bond admin could still re-grant minting (see below); the supply
   guard turns that into a lock, not a drain (SEC-02), except a foreign mint up to the amount holders burned, which it
   no longer sees (D18). Any KYC'd holder can burn its own units through ATS with no role: that locks nobody, and the
   burned value goes to the sponsor through `sweepDust`.
6. **Stablecoin admin keys.** Revoking or freezing the pool's KYC stops every payout until restored.
7. **ATS balance is not economic value.** After a write-down the ATS balance does not change; the dashboard shows the
   effective value. Other tools will show the old balance.
8. **Holders can sell during the window.** The buyer inherits the loss. The accounting stays correct; market fairness does not.
9. **Economic limits.** Collateral earns no yield and the sponsor pre-funds the full-term coupon.

### Legal and regulatory note

- **Insurance.** Taking insurance risk needs a licence. A real deal needs a licensed special purpose insurer; Faultline
  has no such entity, no SPV and no licence.
- **Securities.** Real cat bonds are Rule 144A, Regulation D or Regulation S offerings, sold to qualified buyers. Faultline
  is not an offering of anything, and its testnet tokens have no value.
- **Personal data.** No personal data goes on-chain or on HCS: only hashes and credential ids. Wallet addresses are public by
  the nature of the chain.

This note describes the project's limits. It is not legal advice.

### Details

**Bond roles after setup (testnet smoke run and full demo).** After bond setup nobody holds `ROLE_PAUSER`, `ROLE_ISSUER` (except
the pool) or `ROLE_AGENT` on the ATS bond, but the deployer keeps `DEFAULT_ADMIN_ROLE` and could grant any of them
later. A foreign mint is stopped on-chain by the pool's supply guard (D4, D18: invest, redeem and sweepExcess revert on
`bond.totalSupply() > unitsIssued - unitsRedeemed`). A bond pause is **not** prevented on-chain: it would block
`mint` and `controllerRedeem` (spike S2), and it relies on the admin never granting `ROLE_PAUSER`.

**Keys and roles (security review, docs/SECURITY-REVIEW.md §5; D17).**
- **Trigger admin** can unpause and rotate the oracle, but since D17 it can no longer add or remove trustees, so it
  cannot take the veto away (SEC-01, fixed).
- **Trustee:** a veto is final even if the quake was real, so a trustee key is as sensitive as the oracle key. Only
  trustees manage trustees: keep a backup trustee in separate custody. Losing every trustee key removes veto and pause
  for good; a rogue trustee can be removed only by another trustee. As the HCS topic's admin key it can also delete the
  topic or change its submit key (the chain, not HCS, is the source of truth).
- **Relayer:** pays fees and relays signatures only; it cannot sign attestations or HCS messages (spike S7).
- **Bond admin (`DEFAULT_ADMIN_ROLE` on the ATS bond):** a foreign mint or upward balance adjustment makes the pool's supply
  guard (D4) stop redemption for everyone: a **lock, not a drain**, accepted by design (SEC-02). It could also pause the
  bond or grant itself CONTROLLER and force-transfer holders' units, which the guard cannot see. In production this role
  belongs in a multisig or timelock.
- **Holder burns (SEC-15, D18):** a KYC'd holder, an approved spender or an authorised operator can burn units through ATS
  with no role. The guard now reverts only when supply is above the books, so this locks nobody. Two accepted costs: a
  foreign mint up to the burned amount goes undetected (it needs a bond role the deploy audit forbids, and after
  `sweepDust` such a mint is unbacked, so the last claimant is short), and burned collateral stays reserved until `sweepDust`,
  so it stays in the pool if any holder never redeems.
- **Trigger admin key (SEC-19):** a pause has no maximum and only this key ends it. A lost key during a pause begun before
  the deadline locks redemption and both sweeps for ever; so does a lost key with a pending event past its window, even for
  a pause begun after the deadline. Accepted, no contract change. Production needs this key in a multisig.
- **Holds (SEC-21):** D9 keeps hold roles off the bond, but a holder can create a hold with no role and no KYC. Held units
  leave `balanceOf`, so `redeem` pays only the free balance; the harm stays with that holder.
- **Stablecoin admin / KYC key:** revoking or freezing the pool's KYC stops every payout until it is restored; `claim`
  then reports `NotKycForToken(pool)` (D17).
- **Finality is the first execute after the window:** a revision that lands first restarts the window (SEC-06).
- **Pauses (D2):** a pause that starts before the submission deadline keeps redemption closed; one that starts after it
  does not.

**Late USGS revisions (D15).** While an event is pending the oracle re-checks its USGS record on a fast loop and, if the
record stops passing the rule, publishes a signed advisory asking the trustee to veto (it can never revise a loss to
0 itself). A USGS revision that arrives **after** the challenge window has ended is a residual risk: an executed
write-down is final and is not clawed back.

**On-chain values can lag USGS (§6.6).** A pending event is revised only when its loss changes. If USGS later refines
the magnitude or origin time without changing the loss (for example M8.1 → M8.2, both above the 100 % ceiling), the
trigger keeps the older `magnitudeX100` / `observedAt`; the oracle's ledger keeps the latest values.

**HCS is a log, not the authority (D16).** Every HCS message carries the oracle's own signature, but the on-chain
trigger is the source of truth. The topic's admin key is the trustee's: it can change the submit key or delete the topic.

**Demo (replay mode).** The demo replays a real historical quake (Bhuj 2001, `usp000a8ds`) with `mode: "replay"` terms
(ARCHITECTURE D10): its times are shifted into the demo bond's risk period and the dashboard shows a REPLAY badge. In
replay mode the oracle's 6 h cooling period is measured on the **real** USGS origin time (D14); the event is decades
old, so **the demo does not exercise the cooling period**. Replay terms are refused off-chain on any chain other than
Hardhat (31337) and Hedera testnet (296); on chain the mode is visible only through `termsHash`.

---

## License

MIT, see [`LICENSE`](LICENSE). Third-party code and data keep their own licenses: see [`NOTICE.md`](NOTICE.md).
The MIT License covers the code only; it does not make Faultline a licensed insurance or securities product (§8).
