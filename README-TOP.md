# Faultline

**A parametric earthquake catastrophe bond on Hedera.** Investors earn a coupon for taking earthquake risk. If a
USGS-reviewed earthquake crosses a preset threshold inside the insured zone, bond principal is written down
automatically, and the matching collateral goes to the sponsor once a short challenge window ends. There is no loss
adjuster and no claims process, and every step leaves an on-chain and HCS audit trail.

> **Status:** a prototype. It is self-reviewed, not audited, and not a regulated insurance or securities product. Do
> not use it with real money. Each feature is marked as **testnet-verified** or **mock-tested** in
> [Verified vs mock-tested](#verified-vs-mock-tested).

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
agent and the reporting. Small private deals are rarely worth that cost. **India has no sovereign cat bond or sovereign
parametric cover** ([OECD, 2024](https://doi.org/10.1787/ab1e49ef-en)), even though it has active fault zones such as
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
