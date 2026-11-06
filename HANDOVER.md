# Faultline — Project Handover & Research Report

Oct 25, 2026 · @tushar

## 1. Purpose and working rules

This report hands the whole Faultline project (idea, research, testnet proof, design, plan) to Claude Code so building can continue without re-explaining anything. Read sections 15, 6, 9, 10 and 14 first (section 15 records the independent review and overrides any older text); the rest is reference.

**Where to find what**

| If you need | Go to |
| --- | --- |
| What the product is, who the actors are, the lifecycle | Section 2 |
| MVP scope (must, should, nice to have), track background, pitch | Section 11 |
| Market numbers, competitors, verdict | Section 3 |
| ATS roles, function guards, HIP-1215 signature, Stablecoin Studio, Hedera RPC | Section 4 |
| Addresses, account IDs, tx hashes, test scripts, errors already solved | Section 5 |
| Contract-by-contract spec, maths, invariants | Section 6 |
| Why each design choice was made, and what was rejected | Section 12 |
| Oracle, dashboard, tests, security plan | Section 7 |
| Sandbox findings, exact package versions, offline compile trick | Section 8 |
| Status table, risks, cleanup debts | Section 9 |
| Build order and starter prompt | Section 10 |
| Meaning of every term and acronym | Section 13 |
| What this report does NOT contain and must be asked or verified | Section 14 |
| What the independent review found and which design changes it caused | Section 15 |

**Standing rules from the owner (apply to every step):**

- Ideas must be genuinely new. Never recycle a product he has already built.
- Research deeply before suggesting anything sensitive, important or complex.
- Everything is production-grade: clean, optimised, professional code, architecture, design and UI.
- Answers to him: short, simple, step by step, in Hinglish. Say plainly what is proven and what is not.
- Private keys never go into chat. They live only in the terminal or the Hardhat keystore. Testnet keys only.
- Throwaway test code stays separate from the real project.

## 2. The idea: Faultline

**Faultline is a parametric earthquake catastrophe bond on Hedera: if a USGS-verified quake crosses a preset threshold inside an insured zone, bond principal is written down automatically and the matching collateral goes to the sponsor as soon as a short challenge window ends (hours after the event, with an on-chain audit trail), without any loss adjustment.**

**Origin.** The target was the ETHGlobal Mumbai (5 to 7 Nov 2026) Hedera track "Tokenize Anything with Hedera Studios" ($5k). The brief was five constraints: creativity, usefulness, practicality, winner mindset, impressive to judges. It lists suggested ideas (invoices, gold, real estate, remittances, order books); Faultline sits outside that list and uses both Studios.

**Who is who**

- Sponsor (insured party, e.g. a government or insurer): pays a coupon premium, receives collateral if the trigger fires.
- Investors: buy bond units with a stablecoin, earn coupons, lose principal pro rata on a trigger, get the rest back at maturity.
- Calculation agent (oracle): reads USGS data, applies the trigger rule, signs the result.
- Trustee: can veto during a challenge window and pause the contract in an emergency.

**Lifecycle**

1. Setup: the sponsor funds the coupon reserve for the whole term. The pool and trigger contracts are deployed and the pool becomes the only address allowed to mint and force-redeem the bond.
2. Subscription: KYC'd investors pay the stablecoin into the pool and receive bond units 1:1 (1 unit = 1 base unit of the stablecoin). Issuance closes before the risk period starts.
3. Risk period: coupon accrues on the outstanding principal through an index; nothing is paid out yet.
4. Event: the oracle sees a qualifying quake, applies the payout curve, signs an EIP-712 attestation, publishes it to a Hedera Consensus Service topic and submits it on-chain.
5. Challenge window: the trustee may veto; the oracle may replace its attestation after a USGS revision; the clock stops while the contract is paused.
6. Write-down: after the window anyone executes. The pool raises its loss index and credits the sponsor the matching collateral in one step. Holders' ATS balances do not change but are now worth less.
7. Maturity: after maturity plus a grace period, with no pending event, each holder calls `redeem()`. Units are burned through the ATS controller and the holder can claim principal x (1 - loss) plus accrued coupon. The sponsor claims the unused reserve and rounding dust at the end.

**Payout curve (decided 2026-10-26, D13; replaces the old 6.5 to 7.5 placeholder):** linear from 0% loss at magnitude 7.0 to 100% loss at magnitude 8.0, so the 2001 Bhuj quake (M7.7) gives 70%. The oracle computes it off-chain and rounds down to whole basis points. Only reviewed, moment-magnitude earthquakes inside the box and above a depth limit count (section 7).

**Why it can win (the pitch):** a real instrument that exists today; both Studios used for a purpose; one memorable demo (replay a real quake, watch the trustee window run, see the sponsor's payout appear and every holder's effective value drop); India has no cat bond of its own, which is a strong hook for a Mumbai audience. Honest framing: parametric bonds already skip claims adjustment, so the value is cheaper structuring and a transparent, automatic lifecycle for small private deals, not retail access.

## 3. Research and verdict

Verification verdict: **"yes, continue, with changes"**. Podium chance is roughly a coin flip if the core demo is clean. A second-opinion review (Grok) also said build it and listed the same risks (judges may not know cat bonds, trusted oracle, upstream-contribution quality).

**Market context (for README and pitch).** These figures come from earlier web research in this project; source URLs were not kept, so re-verify before publishing.

| Fact | Value |
| --- | --- |
| Cat bond market outstanding, end of H1 2026 | $65.6B |
| World Bank Jamaica bond | $150M, paid out in full after Hurricane Melissa (parametric trigger, evaluated by AIR Worldwide) |
| Replacement cover, May 2026 | $200M arranged by the World Bank |
| Typical cat bond minimum ticket | commonly $250k or more |
| Tokenized cat bonds | Harneys/droppRWA plan early 2027, chain undisclosed |
| India | no cat bond of its own (Mumbai hook) |

**Competitors in the same track (ETHOnline).** None is a parametric write-down product.

| Project | What it does | How Faultline differs |
| --- | --- | --- |
| Covenant\_Hedera | ATS note, compliance gate, coupon, collateral hold on default | credit event, not an external physical trigger |
| Clearing House | DvP bonds | settlement venue, not insurance |
| Captable | compliance venue | no payoff logic |
| Galvanic | seen in the ETHOnline list; details not recorded, re-check | no parametric trigger |
| Remate | exit auctions | secondary market |
| Ripcord | parametric wallet insurance | wallet-level insurance, not a bond with collateral and write-down |
| Asseto | order book, RFQ, DvP | venue |

**Strategic rule:** do not build a venue or secondary market. Differentiate on the trigger plus write-down.

**Judging risks and mitigations**

- Judges may not know cat bonds: open with a 20-second explainer (problem, trigger, seconds-level outcome).
- Complexity: if HIP-1215 scheduling slips, fall back to a keeper script without hesitation.
- Trusted oracle: say so honestly. The challenge window and trustee pause are part of the design, not an apology.
- Upstream contribution: a thoughtful ATS enhancement proposal for event-linked instruments beats a generic PR.

## 4. Technical facts collected

**Asset Tokenization Studio (ATS)**

- Diamond / resolver / factory architecture; ERC-1400 plus partial ERC-3643.
- Roles are address-based: CONTROLLER, ISSUER (Minter), KYC, SSI\_MANAGER, INTERNAL\_KYC\_MANAGER, CORPORATE\_ACTION, BOND\_MANAGER and others. `ROLE_CONTROLLER = 0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e`.
- `controllerRedeem(address,uint256,bytes,bytes)` is guarded by: operational, activated, unpaused, controllable, without-multipartition, and the caller holding CONTROLLER or AGENT. This is the write-down primitive. Because of the unpaused guard, Faultline must not rely on pausing the bond; it enforces its own challenge window and pause inside TriggerController.
- Internal KYC uses Verifiable Credentials signed by a registered SSI issuer, with the investor's EVM address as holder. Generate with `npx hardhat createVC` in `packages/ats/contracts`.
- Bond currency is fixed to USD.
- Deployed testnet IDs: docs v4.0.0 BLR proxy 0.0.7707874 and Factory proxy 0.0.7708432; ETHOnline projects used v8, resolver 0.0.9212226 and factory 0.0.9213391. Bond creation worked on the one the owner's `.env` uses.
- Source paths worth reading: `packages/ats/contracts/contracts/facets/controller/Controller.sol`, `IController.sol`, `facets/accessControl/*`, `constants/roles.sol`.

**ATS SDK/UI bug (not ours):** the UI and SDK "Force Redeem" fail with "Insufficient allowance". It comes from `ControllerRedeemCommandHandler.execute` calling `validationService.checkCanRedeem(securityId, sourceId, amount, _PARTITION_ID_1)` before any transaction is sent. Root cause not found. Direct contract calls work, which is the path Faultline uses. Possible upstream issue to report.

**HIP-1215 (Hedera Schedule Service)**

- System contract at `0x000000000000000000000000000000000000016b`, available since node v0.68.
- `scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData) returns (int64 responseCode, address scheduleAddress)`; success code is 22. It returns failure codes instead of reverting. `hasScheduleCapacity(expirySecond, gasLimit)` exists.
- The scheduling contract pays the fees, so it must hold HBAR.
- Scheduled calldata is fixed at scheduling time, so a scheduled call cannot carry a fresh holder list.
- Local EVM chains (Hardhat) do not have this system contract; tests need a mock placed at that address.

**Added after the review (checked on 2026-10-25, see section 15)**

- A scheduled transaction can be at most 62 days (5,356,800 seconds) in the future, so a quarterly or yearly schedule cannot be set up at issuance.
- `scheduleCall` returns `(responseCode, scheduleAddress)` and does not revert. Always check for code 22. Call `hasScheduleCapacity(expirySecond, gasLimit)` first.
- One hackathon team reported that two schedule calls in one transaction fail on testnet with `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`. **Correction (2026-10-25):** that code (373) is in the official `HederaResponseCodes.sol`: "A contract operation attempted to schedule another transaction after it had already scheduled a recursive contract call", and code 374 says a contract "can schedule recursive calls a finite number of times (approximately four million…)". So self-chaining (a scheduled call scheduling the next one) looks supported; only a second schedule in the same operation after a recursive one fails. **Still test this with a small spike before relying on it.**
- `forge script` cannot simulate `0x16b` (no bytecode there), so use Hardhat or `cast`.
- ATS v8 testnet factory is 0.0.9213391 (the v4 factory in older docs is stale). A fresh bond needs a Luhn-valid ISIN; the role order is `ROLE_SSI_MANAGER`, `addIssuer`, `grantKyc`, then mint; mint needs KYC on the recipient.

**Stablecoin Studio (not yet tested)**

- CLI: `npm i -g @hashgraph/stablecoin-npm-cli`, then `accelerator wizard`.
- Docs list a testnet factory 0.0.14455068 (unverified; the docs example config shows an older 0.0.636690). Use key type ECDSA.
- Has KYC, freeze, wipe, rescue and a demo-quality proof-of-reserve. HoldManagementFacet exists, but SDK exposure is unverified.
- Because it has KYC and freeze, a recipient can be blocked from receiving the stablecoin. This is why the vault pays by pull (`claim()`), not push.

**Hedera EVM and tooling**

- Testnet chain ID 296 (0x128), RPC `https://testnet.hashio.io/api`.
- The Hashio relay rejected a large-gas role-grant sent from MetaMask (HTTP client error), while an ethers script worked. Use scripts for admin transactions.
- Owner's Mac: Hardhat 3 with `keystore set`, ethers v6, `@hiero-ledger/hiero-contracts` (new import paths: `schedule-service/HederaScheduleService.sol`, `common/HederaResponseCodes.sol`), zsh (no `--include=*.sol` glob; quote or use `find`).

## 5. Hands-on testnet results

All of this was done by the owner on Hedera testnet from his Mac. None of the code below exists in Claude's cloud workspace; it lives in `~/hedera-tests/hedera-code-snippets/hss-schedule-sc-calls/` and is throwaway.

**Proven**

| Mechanism | Result |
| --- | --- |
| Issue a bond through the deployed ATS factory | works |
| Internal KYC with a generated VC | works (VC must be signed by the registered SSI issuer, holder = investor EVM address) |
| Mint bond units | works |
| A contract holding ROLE\_CONTROLLER burns units via `controllerRedeem` | works (the write-down mechanism) |
| HIP-1215 contract self-scheduling (`AlarmClockSimple`) | works |

**Not yet tested:** Stablecoin Studio (create plus KYC-gated mint), a scheduled call that lands in an ATS token, HCS publishing, the collateral vault, coupon payout, the oracle, any UI beyond ATS's stock one.

**Testnet state of that first exploration (throwaway, not used by this project)**

- A throwaway issuer account (token admin with Admin, Minter, Controller, KYC, SSI Manager, KYC Manager and Internal KYC Manager roles; registered as SSI issuer) and a hollow investor with valid KYC.
- Test bond TCB (ATS v4, max 10,000, nominal 1,000 USD), a `Redeemer` probe with no access control (its ROLE\_CONTROLLER was revoked in spike S0), and an `AlarmClockSimple` HIP-1215 contract.
- ATS web app ran locally in dev mode at `localhost:5174` (the production `vite build` ran out of memory, exit 134).
- This project's own accounts and deployments: docs/ACCOUNTS.md and docs/DEPLOYMENTS.md.

**Throwaway test code (summary of what each does)**

- `contracts/Redeemer.sol`: `redeem(token, holder, amt)` calls `IController(token).controllerRedeem(holder, amt, "", "")`.
- `scripts/deployRedeemer.ts`, `scripts/grantController.ts` (grantRole via ethers, env ROLE and ACCOUNT), `scripts/callRedeem.ts` (env REDEEMER and HOLDER).
- `redeem.js`: standalone ethers v6 direct `controllerRedeem` through Hashio, signer key from env `PK`.
- `AlarmClockSimple.sol` import fix: `sed` the `@hashgraph/smart-contracts/...` paths to `@hiero-ledger/hiero-contracts/schedule-service/` and `.../common/HederaResponseCodes.sol`.

**Errors hit and fixes (so Claude Code does not repeat them)**

- `issuer ... is not registered` when adding KYC: sign the VC with the issuer's key and use the investor's EVM address as holder.
- UI Force Redeem "Insufficient allowance": SDK pre-check, bypass with a direct contract call.
- HHE902 import error and HHE28 invalid `HEDERA_RPC_URL`: fixed with the import-path rewrite and `keystore set --force`.
- ATS UI role-grant failure through MetaMask and Hashio: use the `grantController.ts` script.
- Wrong guess that the Controller role was missing: the owner already had it.

## 6. Target architecture and contract design (revised after review)

This is the spec after the independent review (section 15). **No contract code has been written yet.** Solidity 0.8.28, OpenZeppelin 5, Hardhat 2. ATS stays unmodified.

**Core idea: a global loss index instead of burning every holder.** Let `U` be the units the pool has issued (tracked by the pool itself), and `L` the cumulative loss in basis points applied so far (0 to 10000). One bond unit stays one original notional share. Its economic value is `(10000 - L) / 10000` of a stablecoin base unit, plus accrued coupon. Nothing loops over holders, ever.

**Core rules**

1. **Write-down is O(1).** `applyLoss(C)` raises `L` to `C` and credits the sponsor `floor(U x C / 10000) - alreadyCredited`. Because it uses the cumulative `C`, two events (for example 30% then 70%) give exactly the same sponsor credit as one 70% event.
2. **Units are not burned at write-down.** They are burned when a holder redeems at maturity, through `controllerRedeem`, so the ATS CONTROLLER mechanism still appears in the demo. The ATS balance does not change after a write-down, so the dashboard must show the effective value.
3. **Redemption is pull-based and per holder.** `redeem()` pays `floor(balance x (10000 - L) / 10000)` plus the holder's coupon. Rounding always goes against the holder; the leftover dust is swept to the sponsor only after all supply is redeemed.
4. **Only the pool can mint.** The pool holds the issuer (mint) role and the controller role. The deployment script removes the issuer role from every other address, and a test asserts `bond.totalSupply() == pool.unitsIssued()`.
5. **Issuance closes before the risk period starts.** The sponsor must fund the coupon reserve first; `invest` reverts until the reserve covers the full term, so investors never subscribe to an unfunded coupon.
6. **Coupons are accrued by index, paid at redemption.** Between checkpoints the pool adds `(10000 - L) x couponBps x dt / (10000 x 10000 x YEAR)` per original unit to an accumulator scaled by 1e18. Checkpoints happen inside `applyLoss` and at maturity, so a loss lowers the accrual from the moment it is applied. Interim coupons are a stretch goal (they need a record-date snapshot, for example from the ATS coupon entitlement).
7. **Pull payments.** The pool credits `claimable[address]`; each party calls `claim()`. A frozen recipient cannot block anyone else.
8. **The bond token is never paused.** The challenge window, veto and pause live only in `FaultlineTrigger`.
9. **Bond nominal is 1 USD per unit**, 6 decimals, so one base unit of the bond equals one base unit of the 6-decimal stablecoin.

**Contracts**

| Contract | Responsibility | Key functions and rules |
| --- | --- | --- |
| FaultlinePool | Stablecoin custody, issuance, loss index, redemption, coupon accrual, claimable balances | `invest(units)` (issuance window, cap, minimum ticket, coupon reserve funded, balance-delta check on the incoming stablecoin, then mint 1:1); `fundCoupons(amount)`; `applyLoss(cumulativeBps)` (trigger only); `redeem()` (needs `now > trigger.submissionDeadline()` — `maturity + grace` plus all paused time, never while the trigger is paused — no pending attestation, burns with `controllerRedeem`); `claim()`; `sweepDust()` (only when bond supply is zero); views `effectiveValue(holder)`, `appliedLossBps`, solvency |
| FaultlineTrigger | Attestation intake, replay protection, challenge window, veto, pause | EIP-712 verification against one oracle address; `submit(att, sig)`; `veto(eventId)`; `execute(eventId)`; `pause()` by trustee, `unpause()` by admin; `pendingCount()`; oracle rotation by admin. Needs no ATS role at all |
| Mocks (tests only) | MockUSD (6 decimals, optional association/KYC flags), MockBond (ERC-20 with mint, `controllerRedeem`, roles, KYC check), MockHSS (placed at `0x16b` with `hardhat_setCode`) | Mirror the real function names and revert behaviour |

**Trigger rules (FaultlineTrigger)**

- The EIP-712 domain is `name "FaultlineTrigger"`, `version "1"`, the chain ID (296 testnet, 295 mainnet) and the contract address. One trigger is deployed per bond, so the signature is bound to that bond.
- Signed fields: `eventId` (keccak of the USGS event id), `lossBps` (loss of this event only; changed from `cumulativeBps` on 2026-10-25, see section 15 addendum D1), `magnitudeX100`, `observedAt` (origin time), `usgsUpdatedAt`, `nonce`, `termsHash` (hash of the trigger rule version, must equal an immutable), `dataHash` (hash of the canonical USGS record) and `deadline`.
- `submit`: valid oracle signature; before the deadline; `observedAt` inside the risk period and not in the future; `termsHash` matches; `lossBps` between 1 and 10000; the applied loss is below 10000; the trigger is not paused (D2); and the call itself is made no later than `submissionDeadline()` = `maturity + grace` + total paused time (D2, 2026-10-25). After that no new event can be submitted, and redemption opens only after the same deadline, so a late attestation can never arrive after some holders have already redeemed, and a pause can never make a legit quake miss the cutoff.
- **Event status is permanent.** None, Pending, Vetoed, Executed or Superseded. A vetoed or executed event can never be submitted again, so a public signature cannot be replayed.
- **USGS revisions:** while an event is Pending, a new attestation for the same event with a higher `nonce` and a newer `usgsUpdatedAt` replaces it, may lower the loss, and restarts the challenge window.
- **Veto:** trustee only, while the event is Pending and inside the window. Allowed while paused.
- **Pause:** the trustee can pause; only the admin can unpause. The window is measured in unpaused time: `effectiveTime = (paused ? pauseStart : now) - totalPausedSeconds`. A pause can therefore never run out the clock.
- `execute`: anyone, not paused, window complete. If the applied loss is already 10000 the event becomes Superseded and nothing happens (no revert). Otherwise it calls `applyLoss(min(10000, L + lossBps))` (D1).
- `pendingCount()` counts Pending events. The pool refuses redemption while it is above zero.
- After execution there is no clawback if USGS later revises the magnitude. Finality is the end of the window; state this plainly.

**Write-down maths**

```latex
\text{sponsorCredit}_{k} = \lfloor U \cdot C_k / 10000 \rfloor - \lfloor U \cdot C_{k-1} / 10000 \rfloor
```

```latex
\text{redeemable}(b) = \lfloor b \cdot (10000 - L) / 10000 \rfloor
```

Solvency holds by construction: the sponsor credit plus the sum of per-holder floors never exceeds `U` (Claude checked this on 20,000 random holder splits). The dust that remains stays in the pool and goes to the sponsor in `sweepDust`.

**Invariants for the tests**

1. `stablecoin.balanceOf(pool) >= collateralLeft + couponReserveLeft + totalClaimable`.
2. `collateralLeft >= value owed to all unredeemed units`.
3. Applying losses A then C gives the same sponsor credit as applying C alone.
4. `bond.totalSupply() <= unitsIssued - unitsRedeemed`, and `==` when nobody burned units through ATS (D18, was `==`).
5. No sequence of transfers, vetoes, pauses or replays lets a holder redeem more than `floor(balance x (10000 - L) / 10000)` plus their coupon.

**Hedera-specific requirements for the pool**

- The stablecoin is an HTS token. The pool must associate with it and be granted the HTS KYC flag before the first subscription. Do the association in an initialisation function.
- Do not read `msg.value` in a constructor; fund contracts with a normal call after deployment. Inside the EVM, HBAR amounts are in tinybar.
- ATS v8 setup order for a fresh bond: grant `ROLE_SSI_MANAGER`, `addIssuer(issuer)`, `grantKyc(issuer)`, `grantKyc(each investor)`, then mint. `deployBond` needs a Luhn-valid ISIN. Minting requires KYC on the recipient, so `invest` fails cleanly for a non-KYC'd investor.
- **Interface names to verify on testnet:** `controllerRedeem(address,uint256,bytes,bytes)` is confirmed from source. The ATS v8.0.0 source (`facets/mint/IMint.sol`) has **both** `mint(address,uint256)` and `issue(address,uint256,bytes)`, each requiring `ROLE_ISSUER` or `ROLE_AGENT` (checked 2026-10-25); still confirm on a fresh v8 bond in spike S1.

## 7. Oracle, dashboard, tests and security plan

**Oracle service (TypeScript, Node)**

- **Acceptance rule (all must hold):** `status` is `reviewed` (never `automatic` or `deleted`); `type` is `earthquake`; `magType` is a moment-magnitude type (mw, mww, mwb, mwc, mwr; confirm the list in the USGS event documentation); epicentre is inside the box; depth (`coordinates[2]`, kilometres) is at or below the depth limit; and the event is older than a cooling period (placeholder: 6 hours). A `reviewed` status and a cooling period are both required. An old `automatic` event is never accepted.
- **Payout curve:** linear between a floor magnitude and a ceiling magnitude (7.0 to 8.0, D13; the old placeholder was 6.5 to 7.5), rounded down to whole basis points. No cliff tiers.
- **Terms hash:** the box, curve, depth limit, magnitude types and cooling period are written to a canonical JSON file and hashed. The hash is an immutable in `FaultlineTrigger` and is signed inside every attestation, so the oracle cannot change the rules without a new bond.
- **Attestation:** `eventId`, `lossBps` (this event's loss; the trigger aggregates), `magnitudeX100`, `observedAt`, `usgsUpdatedAt`, `nonce`, `termsHash`, `dataHash` (hash of the canonical USGS record), `deadline`, signed with EIP-712 against the trigger's address and the chain ID.
- **Revisions:** while an event is pending, the oracle keeps re-reading the USGS record. If it changes, the oracle signs a new attestation with a higher `nonce` and newer `usgsUpdatedAt` (the loss may go down). After execution there is no clawback.
- **HCS:** publishes the same payload to a Hedera Consensus Service topic. Two modes: mock (a local file) and real (`@hashgraph/sdk`). Real mode is untested until run on testnet. Never write personal data to HCS; only hashes and opaque ids.
- **Replay CLI** (`--replay-usgs-event <id>`): fetches a historical record from the live USGS API (needs network on the owner's machine), runs the full rule, posts to HCS, submits to the trigger and prints the HashScan links. Offline tests use fixtures that must be labelled as synthetic data shaped like USGS GeoJSON. A good demo event for a Mumbai audience is the 2001 Bhuj (Gujarat) M7.7 quake, epicentre near 23.4 N, 70.2 E. Do not invent USGS event ids.
- **Second source:** EMSC (or another network) may be shown as a cross-check on the dashboard. A signer quorum is a stretch goal, not part of the MVP.

**Dashboard.** Next.js (App Router) plus React plus TypeScript — the owner's choice on 2026-10-25 (replaces the earlier Vite plan). Three views: investor (holdings, coupons, claim), sponsor (premium reserve, collateral received), trustee (pending attestation, countdown, veto and pause). Show each holder's effective value (balance x (1 - loss)) beside the ATS balance, because the ATS balance does not change at a write-down. Show a "pending event" banner and countdown during the challenge window. A live "earthquake replay" screen is the demo moment.

**Tests (Hardhat, chai)**

- **Pool:** invest mints 1:1; reverts when the coupon reserve is not funded, outside the window, over the cap, below the minimum ticket, or for a non-KYC'd investor; claim pays once; `bond.totalSupply() == unitsIssued` always.
- **Loss index:** one event; two events equal one cumulative event (property test over random sequences: sponsor credit equals `floor(U x Cn / 10000)`); redeemable value floors against the holder; the solvency invariants hold with random holder splits and random transfers.
- **Regression for the main review finding:** a holder transfers one unit to a brand-new wallet just before `execute`. The write-down must still succeed, and the buyer inherits the loss.
- **Trigger:** valid flow; wrong signer; expired deadline; replay of a vetoed or executed event reverts; a newer nonce supersedes a pending attestation and may lower the loss; a stale nonce is rejected; veto works inside the window and not after; veto works while paused; a pause does not consume the window; only the admin unpauses; early execute reverts; an event executed when the applied loss is already 10000 becomes Superseded without a revert; two concurrent events where one is vetoed apply only the other's loss (D1); submit while paused reverts (D2); submit after `submissionDeadline()` reverts; a pause extends the submit cutoff and the redemption opening by exactly the paused time; terms-hash mismatch reverts; a signature for one trigger instance fails on another.
- **Coupon:** accrual lowers from the moment a loss is applied; unused reserve returns to the sponsor; reserve is required before subscription.
- **Maturity:** `redeem` is blocked before `submissionDeadline()`, while the trigger is paused, and while an event is pending; a pause moves both the submit cutoff and the redemption opening later by its length; `sweepDust` works only when supply is zero.
- **Access control:** only the trigger can call `applyLoss`; strangers cannot touch roles; the pool is the only minter.
- **Hedera spikes (testnet, not mocks):** see section 10.

**Security plan**

- Independent review by a separate agent that did not write the contracts, then fixes, then re-test.
- Static checks: Slither if installable, otherwise a manual checklist (reentrancy, access control, rounding, unexpected token transfers around execution, loss-index and coupon-accrual maths, oracle key compromise, signature replay, front-running the veto).
- Trust assumptions to state in the README: oracle key, trustee veto power (bounded to the window), finality at the end of the window, single mint authority, stablecoin admin keys, and effective value differing from the ATS balance.

## 8. Environment findings and toolchain decisions

These were measured in Claude's cloud workspace on 2026-10-25. If Claude Code runs on the owner's Mac, most network limits below will not apply; re-check first.

| Item | Finding |
| --- | --- |
| Runtime | Node 22.23.4, npm 10.9.9, Python 3.13.17, 2 CPU cores, 8 GB RAM |
| npm registry | reachable |
| solc binary host (`binaries.soliditylang.org`) | not reachable, so Hardhat cannot download compilers there |
| USGS (`earthquake.usgs.gov`) | not reachable, so live feeds could not be tested |
| Hedera testnet RPC (`testnet.hashio.io`) | not reachable from the cloud workspace |
| GitHub | returned HTTP 400 on a bare request; treat as limited |

**Decisions**

- Hardhat 2 (not 3) with `@nomicfoundation/hardhat-ethers@3` and `@nomicfoundation/hardhat-chai-matchers@2`, `chai@4`, `ethers@6`, `@openzeppelin/contracts@5`, `solc@0.8.28` from npm. Hardhat 3 plugins have a peer conflict with Hardhat 2. This set installed cleanly (178 packages) in `~/kavach-re` in the cloud workspace.
- Offline compile: the npm `solc` package compiles with its bundled wasm. In `hardhat.config.js`, override the subtask `TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD` to return `{ compilerPath: require.resolve('solc/soljson.js'), isSolcJs: true, version: '0.8.28', longVersion: '0.8.28+commit.7893614a' }`. On the owner's Mac this override is unnecessary.
- EVM version: **`cancun`** (corrected 2026-10-25). OpenZeppelin 5.6 uses `MCOPY` and fails to compile for `shanghai`; ATS v8 itself builds with 0.8.28 + cancun and runs on Hedera testnet. See `docs/LESSONS.md`.
- Local chains lack ATS, the stablecoin and `0x16b`, so tests use mocks. The README must separate "mock-tested" from "testnet-verified".
- Nothing from the project exists on disk yet apart from an empty npm project with dependencies installed. The Claude Code session should scaffold from this report.

## 9. Risks, open items and honest status

Nothing in the Faultline contracts, oracle or dashboard is built. What exists is verified ATS and HIP-1215 behaviour on testnet plus a design. Keep this status table updated in the README as work lands.

| Area | Status | Note |
| --- | --- | --- |
| ATS bond issue, KYC, mint | verified on testnet | by hand, through UI and scripts |
| ATS burn by a contract with ROLE\_CONTROLLER | verified on testnet | via the throwaway Redeemer |
| HIP-1215 self-scheduling | verified on testnet | alarm contract only; not yet into an ATS token |
| Stablecoin Studio | untested | create, KYC-gated mint, behaviour on blocked recipients |
| HCS publishing | untested |  |
| FaultlinePool, FaultlineTrigger | not written | spec in section 6 |
| Oracle, replay CLI | not written | spec in section 7 |
| Dashboard | not written |  |
| Security review | not started |  |

**Open risks**

1. **Pause behaviour of ATS is unclear.** One reading of the source says `controllerRedeem` requires an unpaused token; another says pause may not block burns. The design never pauses the bond, but test it on testnet anyway. **Result (spike S2, 2026-10-25):** on testnet `controllerRedeem` and `mint` revert with `IsPaused()` while the bond is paused (see docs/LESSONS.md).
2. **ATS rough edges:** the SDK pre-check bug on Force Redeem, a possible KPI-linked factory bug, bond currency fixed to USD, and the v8 setup order (Luhn-valid ISIN, SSI manager, issuer, KYC) that makes first-time setup fail in non-obvious ways.
3. **ATS balance no longer equals economic value** after a write-down (loss-index design). Third-party tools and secondary-market views will show the old balance. The dashboard shows effective value and the README says so.
4. **Interim coupons are unproven.** They need a record-date snapshot; the ATS coupon entitlement API was not checked. MVP pays accrued coupon at redemption.
5. **Single mint authority.** If any other address can mint bond units, the collateral is diluted. The deployment script removes other issuers and a test asserts `bond.totalSupply() == unitsIssued`.
6. **Hedera scheduling limits:** 62-day horizon, one schedule per transaction (reported), nested scheduling probably unsupported. Scheduling is a stretch goal with a keeper fallback.
7. **HTS stablecoin:** the pool must be associated and KYC-granted; the stablecoin admin's freeze or wipe key can hit the whole pool. Use a stablecoin without a wipe key for the MVP and say so.
8. **Trust assumptions to state in the README:** oracle key (mitigated by the window, veto, pause and key rotation); trustee veto limited to the window; finality at the end of the window with no clawback after a later USGS revision; holders can sell during the window (the buyer inherits the loss).
9. **Economic limits to state plainly:** collateral earns no yield, the sponsor pre-funds the full-term coupon, there is no SPV or insurance licence, and real cat bonds are sold to qualified institutional buyers (Rule 144A). The prototype shows lifecycle automation, not a regulated product.
10. **ETHGlobal eligibility** is set aside by the owner's decision; revisit only if he later decides to submit to an event.

**Cleanup debts**

- ~~Revoke ROLE\_CONTROLLER from the `Redeemer` contract if the TCB token is kept.~~ **Done 2026-10-25** (spike S0).
- Consider reporting the ATS "Insufficient allowance" Force Redeem bug upstream (also useful for the upstream-contribution bonus).

## 10. Next actions for Claude Code

Save this report in the project root as `HANDOVER.md` (or paste the key parts into `CLAUDE.md`), then start Claude Code there.

**Two-phase plan**

- **Phase 1, now (local rehearsal):** build the MVP from section 11 on a local Hardhat chain, run it, test it, security-check it. The early Hedera testnet spikes in step 2 of the build order run first; the full flow runs on testnet only as a stretch at the end. The goal is a working, tested design and a fast, proven recipe.
- **Phase 2, event day (clean rebuild):** start from an empty repo and rebuild the whole project using the Phase 1 recipe. Only these things carry over: this report, `docs/LESSONS.md`, `docs/COMMANDS.md`, and what was learned from the testnet checks.

**What Phase 1 must produce for Phase 2 to be fast** (Claude Code keeps these updated as it works)

1. `docs/LESSONS.md`: every bug hit, its cause and its fix; every wrong assumption and what was true; how long each stage took.
2. `docs/COMMANDS.md`: the exact commands, in order, that take an empty folder to a green test run and a working local demo.
3. `docs/ARCHITECTURE.md`: the final contract design after any changes, with the reason for each change against section 6.
4. A verified-versus-mock table (section 9) that says what is proven on testnet and what only passed against mocks.
5. A saved copy of the working contracts' public interfaces and the oracle's attestation format, so Phase 2 does not drift from what the tests proved.
6. A short list of the things that took longest, so Phase 2 can plan around them.

If Phase 1 changes a design decision in section 12, record the new decision and the reason there; do not leave the old row standing.

**Suggested repo layout**

- `contracts/` (FaultlinePool, FaultlineTrigger, interfaces) and `contracts/mocks/`
- `test/` Hardhat tests
- `scripts/` deploy, local end-to-end demo, testnet helpers
- `oracle/` TypeScript service and replay CLI, with `fixtures/`
- `web/` Next.js dashboard
- `docs/` design notes and the verified-versus-mock table

**Build order**

1. Scaffold the repo, install the pinned toolchain from section 8, write a README skeleton with the status table, and create `docs/LESSONS.md`, `docs/COMMANDS.md`, `docs/ARCHITECTURE.md`.
2. **Early Hedera testnet spikes** (each small, results written to `docs/LESSONS.md` before any contract is written):
   - ATS v8: create a bond with a Luhn-valid ISIN, run the role order from section 6, mint to a KYC'd investor, and find the real mint function name.
   - Pause: pause the bond and call `controllerRedeem`. Does it revert?
   - HTS stablecoin: associate a contract, grant it KYC, send in and claim out. Use a plain HTS token first; give Stablecoin Studio at most half a day.
   - Schedule Service: schedule one call; then try two in one transaction; then try scheduling from inside a scheduled call; check `hasScheduleCapacity` and the 62-day limit.
   - HCS: create a topic, publish a message, read it back from the mirror node.
   - ATS coupon entitlement and snapshot balances (decides whether interim coupons are possible).
3. Write thin interfaces (`IAtsBond`, `IHtsStable`, `IHederaScheduleService`) and mocks that mirror what the spikes found.
4. Write `FaultlinePool` and `FaultlineTrigger`, then every test from section 7 until green, including the property tests and the transfer-before-execute regression.
5. Local end-to-end script on a Hardhat node: fund reserve, invest, run a quake through the challenge window, execute, redeem, claim.
   5b. **Testnet smoke run (owner, 2026-10-26)**, right after step 5: the real FaultlinePool and FaultlineTrigger once on Hedera testnet with a real ATS v8 bond, a real HTS stablecoin and the real `0x167`, testnet demo profile (D13): deploy, KYC/associate, fund, invest, one attestation signed by a script (the oracle is not written yet), 60 s window, execute, redeem, claim. Purpose: find Hedera-only problems (gas, association, ATS roles, `controllerRedeem` by the pool) before the oracle and dashboard are built. Fresh accounts; every transaction confirmed by the owner; evidence in docs/TESTNET-EVIDENCE.md. Step 9 stays for the full flow with the oracle and HCS. **Done 2026-11-05:** one full lifecycle testnet-verified on the FLH_* accounts and the D18 build (33 txs, 40.06 HBAR, L = 7000, books closed to the base unit at 1,001 = 1,000 + 1, no contract change); results in docs/LESSONS.md "Smoke run summary".
6. Oracle service with mock HCS and the replay CLI, run against the local node with offline fixtures. **Done 2026-10-27 (mock-tested, local only):** `oracle/src` (config gate, USGS client, D8 ledger, decision table, D15 advisories, mock + real HCS publishers, relayer, keeper, CLI), 67 vitest tests, `npm run oracle:e2e:local`; real HCS and testnet stay for step 9 (spike S7 prepares the HCS keys).
7. Dashboard wired to the local node. **Done 2026-10-27 (local; testnet read and a MetaMask redeem + claim verified in step 9):** `web/` Next.js 16 + Tailwind + GSAP, six views (overview, investor, sponsor, trustee, replay, evidence), wallet writes, D15 advisories, D16 signature checks; 38 vitest tests + Playwright smoke test on a Hardhat node; testnet read-only mode written but not run (Hashio 502).
8. Independent security review by a separate agent, fixes, re-run all tests.
9. Stretch: run the same flow on Hedera testnet, real HCS, keeper-scheduled coupons, and collect the HashScan evidence table (bond, subscription, HCS topic, write-down, redemption). **Done 2026-11-06 (run 2026-11-05/06 on the D18 build `a0b1dd5`, FLH_* accounts):** 34 transactions and two HCS messages, ≈ 22.9 HBAR, L = 7000, books closed at 501 = 500 + 1; Flow A (SYNTHETIC: pause with 114 of 120 s left, veto, replay rejection `EventFinalised`) and Flow B (live Bhuj: real oracle CLI, real HCS, keeper), plus investor B's redeem and claim through the dashboard with MetaMask. Sourcify verification (phase 7) is the last step. Evidence: docs/TESTNET-EVIDENCE.md "Full demo"; lessons: docs/LESSONS.md "Full testnet demo — results"; commands: docs/COMMANDS.md §11. Two limits on the brief: no scheduled coupons (coupons accrue and are paid at redemption, section 15; the keeper only runs `execute`), and only one event was executed (two events, the cap and Superseded stay mock-tested). What stays mock-tested: README table.
10. Finish the docs. The README must include a short Legal and Regulatory note (insurance licensing needs a licensed special purpose insurer; real cat bonds are Rule 144A, Regulation D or Regulation S offerings; no personal data on-chain, only hashes and credential ids) and the trust-assumption list from section 9. **Docs done 2026-10-30:** README "Trust assumptions and legal note", docs/DEMO-SCRIPT.md (5 minutes or less). The video itself is not recorded yet.

**Starter prompt to paste into Claude Code**

```markdown
Read HANDOVER.md fully. We are building Faultline, a parametric earthquake cat bond on Hedera.
Follow sections 15, 6, 7, 9 and 10 (section 15 records the independent review and overrides older text): Solidity 0.8.28, OpenZeppelin 5, Hardhat 2, mocks for ATS bond, stablecoin and the 0x16b schedule service.
Build in the order of section 10, run every test, then do an independent security review.
Be honest in the README about what is mock-tested versus testnet-verified.
Keep code production-grade and keep answers to me short, step by step, in Hinglish.
Never ask me to paste private keys; use the terminal or the Hardhat keystore.
```

**Working agreement.** Write real, clean code, not placeholders. Say what is not proven. Do not recycle earlier products. Research before any sensitive or complex design call.

## 11. MVP scope and pitch

Source note: the owner pasted the full track text in the original chat. That text was not kept in this report, so ask him to save it as `docs/TRACK.md`. What follows is reconstructed from the plan and from the Grok review the owner pasted.

**Event and track (background only, not a constraint)**

- ETHGlobal Mumbai, 6 to 8 November 2026. Track: "Tokenize Anything with Hedera Studios", $5k.
- Hedera Studios here means Asset Tokenization Studio (ATS) and Stablecoin Studio. Using both in one product was the plan.
- Judging constraints the owner set for the idea: creativity, usefulness, practicality, winner mindset, impressive to judges.
- Hackathon rules, deadlines and the event timeline are set aside on purpose. The goal is the best possible MVP, judged on quality (see section 1).

**Extra-points items the plan was built to hit** (as listed in the review): compliance (expiring KYC, allowlist, pause/freeze), distributions (coupon pool plus servicer fee), an oracle (USGS data attested on HCS), Scheduled Transactions (HIP-1215 for coupons and maturity), and an upstream contribution to the Studios.

**MVP scope (best-MVP target, no time limit imposed)**

- **Must have (the MVP):** `FaultlinePool` and `FaultlineTrigger`; subscription with a funded coupon reserve; attestation, challenge window, veto and supersede; write-down through the loss index; redemption with accrued coupon at maturity; one historical-quake replay end to end on a local chain; every test in section 7 green.
- **Should have:** the dashboard with effective value and a pending-event banner; the early Hedera spikes recorded in `docs/LESSONS.md`; the same flow once on Hedera testnet against a real ATS v8 bond; HCS publishing of each attestation.
- **Nice to have, cut first:** interim coupons (ATS snapshot) with keeper-scheduled Hedera calls, Stablecoin Studio instead of a plain HTS token, a signer quorum, an upstream contribution to ATS (the Force Redeem bug, a note on event-linked bonds).
- **The demo that wins:** two short flows on a testnet challenge window of 60 seconds (**demo-only; production is 48 to 72 hours**, see D13). Flow A: submit, trustee vetoes, a replay of the same signature is rejected. Flow B: a first event, then a second with a higher cumulative loss, then redemption and claims with no rounding leakage. Show the HashScan table and the invariant test output. One clean flow beats many features.

**Pitch framing**

1. Open with a 20-second explainer: investors earn a coupon for taking earthquake risk; if a measured quake crosses the threshold they lose principal and the sponsor receives the collateral.
2. Be accurate about the value. Parametric bonds already have no claims adjustment. Faultline's claim is a transparent, automatic, auditable lifecycle and cheaper structuring for small private deals. It is not retail access: real cat bonds are sold to qualified institutional buyers.
3. Time claim: from the earthquake to finality takes hours (reviewed status, cooling period, challenge window); from finality to settlement is seconds. Never say "seconds after the earthquake".
4. Say plainly that the calculation agent is trusted, and show the challenge window, the trustee veto and the replay rejection in the demo.
5. State what is out of scope: SPV and insurance licence, Rule 144A offering, collateral yield, regulatory compliance.
6. Mumbai hook: India has no cat bond of its own.
7. Do not claim "first on Hedera" without a final check. An earlier second-opinion review found no existing Hedera parametric cat bond but advised not to overclaim.

**Claimed prior art to check once more:** the review said a project called Bond Desk at ETHOnline already used HIP-1215 with ATS bonds. This was not independently verified here.

## 12. Design decision log

Each row is a choice already made, with the reason and what was rejected. Do not reverse one without reading its reason.

| Decision | Reason | Rejected alternative |
| --- | --- | --- |
| Leave ATS unmodified, integrate only through roles | Fighting the framework costs time and breaks upgrades | Forking or patching ATS facets |
| Burn with `controllerRedeem`, called by the pool at redemption | Proven on testnet; no allowance needed when the caller holds ROLE\_CONTROLLER | The ATS UI/SDK Force Redeem (fails with "Insufficient allowance") |
| Never pause the bond; challenge window, veto and pause live in the trigger | `controllerRedeem` may require an unpaused token, and a bond pause would also freeze redemption | Relying on ATS Pause |
| **Global loss index instead of per-holder burns and a holder registry** | Write-down is O(1); no gas ceiling; transfers cannot break it; no rounding drift | Registry plus `sum(balances) == totalSupply` (one unit moved to an unregistered wallet reverts every operation; about 100-holder cap); caller-supplied holder lists |
| Units are burned at redemption, not at write-down | Keeps the ATS CONTROLLER mechanism in the demo while keeping the write-down O(1) | Burning all holders at write-down |
| Sponsor credit computed from the cumulative loss | Two events give exactly the same result as one; no path dependence | Per-event delta, or the two-step basis-point formula (30% then 70% of 1,000,000 units leaves 300,020 instead of 300,000) |
| Rounding goes against the holder; dust to the sponsor after full redemption | Solvency holds by construction | Rounding to nearest |
| Two contracts: `FaultlinePool` and `FaultlineTrigger` | Fewer cross-contract roles; the trigger needs no ATS role | Three contracts (vault, trigger, coupon payer) |
| Coupon accrued by index and paid at redemption | No holder loop; no double claim by moving units between wallets | Pull claims on the current balance; push payments to a registry |
| Pull payments through `claim()` | Stablecoin Studio has KYC and freeze; a blocked recipient must not block others | Pushing tokens inside loops |
| Event status is permanent; a pending event can be superseded by a higher nonce and newer USGS update time | Blocks replay of vetoed or executed signatures; handles downward USGS revisions | A bare "new loss must exceed old loss" rule |
| Veto works while paused; the challenge window excludes paused time | A pause can never run out the clock | A fixed end timestamp |
| Veto only inside the window | Bounds the trustee's discretion | Veto at any time before execution |
| Trustee pauses, only the admin unpauses | Emergency stop without letting one role lock the bond forever | Trustee controls both |
| Submissions close at `submissionDeadline()` = `maturity + grace` + total paused time; redemption opens only after the same moment, not while paused, and with no pending event (pause extension added 2026-10-25) | A late attestation cannot arrive after some holders have redeemed | Settlement exactly at maturity |
| Bond nominal is 1 USD per unit, 6 decimals | 1 base unit of the bond equals 1 base unit of the stablecoin. The owner's old test bond (TCB) has a nominal of 1,000 USD and is not used for Faultline | Other nominals or decimals |
| Oracle accepts only `reviewed` events past a cooling period, of type `earthquake`, moment-magnitude types, below a depth limit | Automatic solutions can be false or withdrawn; shallow quakes shake more | The earlier rule (`reviewed` OR older than a set age) |
| Linear payout curve, computed off-chain; rules hashed into an immutable `termsHash` | Cliff tiers cause disputes at tiny magnitude revisions; the oracle cannot change the rules silently | 6.5 to 50% and 7.0 to 100% cliff tiers |
| Single oracle with trustee veto for the MVP | A quorum with EMSC rarely agrees to the basis point (different ids and magnitudes) | Dispute bond; enforced second signer |
| Keep the two-phase plan (local rehearsal, then clean rebuild) and add early Hedera testnet spikes | It is the owner's decision; the spikes cover what local chains cannot emulate | Building one repo directly on testnet from day one (the review's suggestion) |
| Stablecoin Studio time-boxed to half a day; plain HTS token as fallback | It is untested and a second toolkit can eat time | Making it a hard dependency |
| Hardhat 2 (solc 0.8.28, cancun); Next.js dashboard | Hardhat 3 plugins conflict and ATS v8 itself uses Hardhat 2; the owner chose Next.js on 2026-10-25 | Hardhat 3, Foundry, Vite (the earlier dashboard plan) |
| Oracle signs a per-event `lossBps`; the trigger aggregates `min(10000, L + lossBps)` (2026-10-25) | A signed cumulative loss is wrong when two events are pending (one may be vetoed or executed first) | Signed `cumulativeBps`; one pending event at a time |
| `submit` is blocked while the trigger is paused (2026-10-25) | Pause is the emergency stop for a compromised oracle key | Allow submit while paused |
| `sweepExcess()` after `submissionDeadline()` (2026-10-25) | One holder who never redeems must not lock the sponsor's unused reserve for ever | Only `sweepDust` at zero supply |
| On-chain supply guard in invest, redeem, sweepExcess: revert when `bond.totalSupply() > unitsIssued - unitsRedeemed` (2026-10-25, relaxed from `!=` by D18 on 2026-10-31) | A foreign mint would let someone redeem collateral they never paid for; a holder's own ATS burn must not lock everyone | Relying only on the deploy script; the strict `!=` (SEC-15) |
| Pool pre-checks stablecoin KYC through HTS `0x167` `isKyc` before every transfer (2026-10-25) | The HTS facade reverts with empty data, so users would get reasonless failures | Letting the transfer fail and explaining it only in the dashboard |
| Do not build a venue or secondary market | Competitors already do; focus on trigger plus write-down | Order book, RFQ, auctions |

## 13. Glossary

| Term | Meaning in this project |
| --- | --- |
| Catastrophe (cat) bond | A bond whose principal is lost, in whole or part, if a defined disaster happens. Investors earn a coupon for taking that risk |
| Parametric trigger | Payout depends on a measured value (earthquake magnitude in a box), not on assessed damage |
| Sponsor | The party that wants protection (government, insurer). Pays the premium via coupons, receives collateral on a trigger |
| Write-down | Reduction of bondholders' principal after a trigger. Here: raising the global loss index and crediting the matching collateral to the sponsor. Units are burned later, at redemption (corrected 2026-10-25; the old text said units are burned at write-down) |
| Calculation agent / oracle | The off-chain service that reads USGS data, applies the rule and signs an attestation |
| Trustee | Role that can veto during the challenge window and pause the controller |
| Challenge window | Delay between submitting an attestation and being able to execute it |
| Attestation | Signed EIP-712 message: eventId, lossBps, magnitudeX100, observedAt, usgsUpdatedAt, nonce, termsHash, dataHash, deadline (full list per section 6) |
| lossBps | Loss of original principal caused by one event, in basis points. The trigger applies `min(10000, L + lossBps)` (replaced the signed `cumulativeBps` on 2026-10-25) |
| Collateral vault | The investors' stablecoin that backs the bond units 1:1. Held by `FaultlinePool` (there is no separate vault contract since section 15) |
| Coupon reserve | Separate stablecoin pool funded by the sponsor to pay coupons |
| SPV | Special purpose vehicle, the legal entity that issues a real cat bond. Out of scope here |
| ATS | Asset Tokenization Studio from Hedera. Tokenizes securities such as bonds (ERC-1400 with partial ERC-3643) |
| Diamond / facet | ATS contract pattern (EIP-2535): one proxy address routes calls to many facet contracts |
| ERC-1400, ERC-3643 | Standards for permissioned security tokens with compliance |
| controllerRedeem | ATS function letting a CONTROLLER-role address burn a holder's tokens without the holder's consent |
| ROLE\_CONTROLLER | ATS role id `0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e` |
| Internal KYC / VC / SSI | ATS compliance flow: a Verifiable Credential signed by a registered SSI issuer proves an investor is KYC'd |
| Stablecoin Studio | Hedera tool to create stablecoins with KYC, freeze, wipe and rescue features |
| HSS / HIP-1215 | Hedera Schedule Service system contract at `0x16b`; lets a contract schedule a future call to itself or another contract |
| HCS | Hedera Consensus Service, used to publish a timestamped, ordered record of each attestation |
| HBAR | Hedera's native currency, needed to pay scheduled-call fees |
| Hashio | Public JSON-RPC relay for Hedera (`https://testnet.hashio.io/api`, chain ID 296) |
| EIP-712 | Typed-data signing standard. The domain binds signatures to one contract and chain, preventing cross-contract replay |
| TCB | The owner's throwaway test bond on testnet (first exploration, not used by this project) |
| Keeper | Off-chain script that calls permissionless functions on time. Fallback for HIP-1215 |
| Mock | Test-only stand-in for ATS bond, stablecoin or HSS used on a local chain |
| Loss index (appliedLossBps, L) | Single global number in the pool: cumulative loss in basis points (0 to 10000). Replaces burning every holder at a write-down |
| Effective value | What a holder's units are worth: balance x (10000 - L) / 10000 plus accrued coupon. The ATS balance itself does not change at a write-down |
| termsHash | Hash of the trigger rules (box, payout curve, depth limit, magnitude types, cooling period). Immutable in the trigger and signed in every attestation |
| Superseded | Status of a pending event whose loss is no longer above the applied loss at execution time. Clears without reverting |
| Rule 144A | US rule under which real cat bonds are sold to qualified institutional buyers only. The reason minimum tickets are high |

## 14. Gaps: what this report does not contain

Claude Code must not guess these. Ask the owner, or verify, before relying on them.

**Missing information (ask the owner)**

1. The full original text of the ETHGlobal Hedera track (prize rules, exact extra-points wording, submission requirements).
Ans. 
Tokenize Anything with Hedera Studios ⸺ $5,000
🥇
1st place
$2,500
🥈
2nd place
$1,500
🥉
3rd place
$1,000
Use Hedera's open-source studios to put a real-world asset or payment flow on-chain. Asset Tokenization Studio (ATS) covers the full lifecycle of security tokens, bonds, and equities, and supports ERC-3643 and ERC-1400. Stablecoin Studio covers minting and managing fiat-backed stablecoins, with admin and reserve controls built in.

Pick something that exists today in finance, trade, or commerce, and show how it works when it's issued, managed, and settled on Hedera.

Ideas

Fractional ownership of invoices or receivables for small businesses, sold to investors.
Tokenized bonds with on-chain coupon schedules.
Fractional ownership of gold, real estate, or warehouse receipts.
A stablecoin for cross-border remittances, with compliance controls.
A secondary market or order book for ATS assets.
An x402 service that sells data about tokenized assets, such as NAV or price feeds (this also links to Track 1).
Qualification Requirements
Use ATS or Stablecoin Studio (SDK, contracts, web app, or a combination) to issue or manage a tokenized asset or stablecoin.
Deploy and demo on Hedera testnet.
A public GitHub repo, with contracts verified on HashScan where applicable.
A demo video of 5 minutes or less that covers issuance, configuration, and at least one lifecycle operation (for example a coupon payment, redemption, freeze, or reserve update).
Extra points

Compliance controls: KYC, freezes, transfer restrictions, pauses.
Custom fees and distributions.
Oracle pricing or NAV feeds.
Scheduled Transactions for coupons, vesting, or recurring payouts.
Contributions back to ATS or Stablecoin Studio.

2. Which ATS deployment his local `.env` points at (docs v4.0.0 or the v8 ETHOnline one). Both resolver/factory pairs are listed in section 4.
Ans. v4.0.0 ( by owner )
3. The values he typed in the ATS bond-creation form beyond nominal 1,000 USD, max 10,000 and maturity 25/12/2026 (coupon settings, regulation type, recipients and external-list choices were entered through screenshots and were not recorded).
Ans. As you mentioned in the question they are exactly same. 
4. Whether he wants Hardhat 2 (this report) or Hardhat 3 (what he already has installed for the test project).
Ans. Decide according to yourself → Hardhat 2 chosen (see `docs/LESSONS.md`).
5. His preferred stablecoin setup (Stablecoin Studio config, key type ECDSA assumed).
Ans. Plain HTS token first (6 decimals, ECDSA, KYC key, no wipe key); Stablecoin Studio time-boxed to half a day.

Also answered on 2026-10-25: Faultline's new bond uses the **ATS v8 factory 0.0.9213391**; spikes reuse the existing issuer and investor accounts; the dashboard is **Next.js**. Full record in `docs/LESSONS.md`.



**To verify first (facts that were assumed or conflicting)**

| Item | Why uncertain | How to check |
| --- | --- | --- |
| Bond mint function name (`issue(address,uint256,bytes)` or `mint`) | Minting was done through the UI; ATS issue 1390 calls it `mint` | Read the ATS source under `facets/` or call it on a fresh v8 bond |
| Whether `controllerRedeem` works while the bond is paused | Source guards say "unpaused"; an earlier reading said burns might still pass | Pause a test bond on testnet and call it |
| Two schedule calls in one transaction, and scheduling from inside a scheduled call | Reported by one hackathon team; not in the official docs | Spike on testnet (build order step 2) |
| ATS coupon entitlement and snapshot balances | Decides whether interim coupons are possible | Read the ATS coupon facets; create a coupon on a test bond |
| HTS stablecoin: association and KYC for a contract, ERC-20 facade transfers into it | Review claim, not tested here | Spike on testnet with a plain HTS token |
| Stablecoin Studio testnet factory id | Docs show 0.0.14455068 and an older 0.0.636690 | Run `accelerator wizard` and read the generated config |
| USGS `status` and `magType` values and meanings | The feed documentation page did not define them | Read the USGS ComCat event documentation before coding the filter |
| Which ATS deployment the owner's `.env` uses | v8 factory 0.0.9213391 is current per ATS issue 1390; docs v4 ids are stale | Ask the owner or read his `.env` names (never the keys) |
| Cat bond market figures ($65.6B here, "$40B+" in the review) | Source links were not kept | Search again and cite |
| FONDEN payout timing ("about a month") | Review claim, not checked | Read the World Bank FONDEN case study |
| Competitor details (Galvanic especially); "Bond Desk" used HIP-1215 with ATS | Only names and short descriptions were gathered | Open the ETHOnline project pages |
| EVM version for Hedera | `shanghai` assumed safest | Check Hedera's current supported EVM version in its docs |
| `receive()` bypassed by native HAPI transfers | Review claim; its cited article does not say it | Test on testnet if the pool ever relies on `receive()` |

**Things that exist only outside this report**

- The cloud chat that produced it (task list items for the scaffold, contracts, tests, oracle, dashboard, security review and hand-over were created there but nothing was built). Its transcript is not available on the owner's machine, so this report is the single source.
- The throwaway test code on his Mac, described in section 5. The key files are reproduced in the appendix; the tutorial contract and redeem.js are only described.
- Screenshots of the ATS UI that he shared. They are not in this report.

## 15. Independent review: findings and decisions

The owner had the idea reviewed on another platform (report: "Technical Architecture, Financial Realism, and Smart-Contract Review of Faultline", 25 October 2026). Its verdict was **"build it with major architectural changes"**. Claude read the whole report, re-checked what could be checked (sources at the end of this section), and made the decisions below. **The rest of this report has been rewritten to match them; where an older sentence disagrees with this section, this section wins.**

**What changed in the design, in one list**

1. **No per-holder loops and no holder registry.** A single global loss index replaces burning every holder's units at a write-down. This removes the gas ceiling, the completeness-check denial of service, and rounding drift in one move.
2. **Two contracts instead of three:** `FaultlinePool` (collateral, issuance, loss index, redemption, coupon accrual) and `FaultlineTrigger` (attestations, veto, pause, challenge window).
3. **Coupons are paid together with redemption at maturity** (accrued on the outstanding principal). Interim coupons and Hedera scheduled calls become stretch goals, because interim coupons need a record-date snapshot.
4. **Trigger hardening:** replay protection for vetoed or executed attestations, a way for the oracle to supersede a pending attestation after a USGS revision, a challenge-window clock that stops while paused, veto allowed while paused, coupons blocked while an attestation is pending.
5. **Oracle rule fixed:** `reviewed` status AND a cooling period (never "automatic"), event type `earthquake`, moment-magnitude types only, a depth limit, and a piecewise-linear payout curve instead of cliff tiers.
6. **Pitch and product framing corrected** (parametric bonds already have no claims adjustment; minimum tickets are high because of Rule 144A, not because of settlement rails).
7. **Bond nominal set to 1 USD per unit** so one base unit of the bond equals one base unit of the 6-decimal stablecoin.
8. **Stablecoin Studio is time-boxed**; a plain HTS token or ERC-20 mock is the fallback.
9. **Phase 1 now includes early Hedera testnet spikes** (details in section 10). The two-phase plan stays because it is the owner's decision.

**Finding-by-finding decisions**

| ID | Finding in the review | Decision |
| --- | --- | --- |
| F-01 P0 | `sum(balances) == totalSupply` check bricks every operation if one unit moves to an unregistered KYC'd wallet | **Accepted.** Real problem (a bot can do it just before execution). Removed by the loss index. The review's duplicate-entry attack did not apply to the earlier design, which guarded the registry with `isHolder`, but the registry is gone anyway |
| F-02 P0 | Hedera Schedule Service: 62-day horizon, one schedule per transaction, non-reverting failures | **Accepted with a correction.** 62 days and non-reverting failure are confirmed in Hedera docs. The review's fix ("payCoupon schedules the next coupon") is itself unverified and may fail, see below. Scheduling is a stretch goal, done one call at a time by a keeper |
| F-03 P0 | HTS association and KYC needed on the vault; one freeze or wipe hits the whole pool | **Accepted.** Pool must associate with the stablecoin and be KYC-granted before subscription. The freeze/wipe risk is a stablecoin-admin trust assumption: use a stablecoin without a wipe key for the MVP and state it |
| F-04 P0 | O(N) loop can exceed Hedera's 15M gas limit | **Accepted.** Removed by the loss index |
| F-05 P1 | Two-step basis-point loss does not compose (30% then 70% leaves 300,020 units instead of 300,000) | **Accepted and reproduced by Claude.** The index design applies the loss to the whole supply once, using cumulative values, so there is no drift |
| F-06 P1 | Holders can sell doomed bonds during the challenge window | **Partly accepted.** With a loss index the accounting stays correct whoever holds the units; the buyer inherits the loss. Not pausing the bond. Dashboard shows a "pending event" banner. Residual market-fairness issue is stated openly |
| F-07 P1 | Vetoed attestation can be replayed; the C > A rule blocks downward USGS revisions | **Accepted.** Event status is permanent (a vetoed or executed event can never be resubmitted). Oracle may supersede a pending attestation with a higher nonce and a newer USGS update time |
| F-08 P1 | Pause can run out the challenge clock; coupon or maturity can settle during a pending event | **Accepted.** Veto works while paused; the window excludes paused time; coupons and maturity wait while any attestation is pending; maturity needs `now > submissionDeadline()` (`maturity + grace` plus paused time, D2) |
| F-09 P1 | Idle stablecoin collateral earns nothing, unlike real collateral trusts (SOFR) | **Accepted as a stated limitation** for the MVP. Sponsor pays the whole coupon. A yield-bearing collateral wrapper is a roadmap item |
| F-10 P2 | Trigger ignores depth and magnitude type | **Accepted.** Added to the oracle rule |
| F-11 P2 | Splitting a holding into 1-unit accounts defeats floor rounding | **Mostly moot.** With 6 decimals a unit is one millionth of a dollar; in the loss-index design, rounding hurts the holder, never the sponsor, and the sponsor sweeps the dust |
| F-12 P3 | Hedera EVM traps (payable constructor, tinybar, `forge script`) | **Accepted partly.** Do not read `msg.value` in constructors; fund by a normal call. HBAR is counted in tinybar inside the EVM. Hardhat is used, so the `forge` issue does not apply. The `receive()` bypass claim is unverified |
| Product | Real sponsors would see a toy; no SPV; upfront coupons; cliff tiers | **Accepted as framing.** State the limits plainly, switch to a linear payout curve, add a legal note to the README |
| Oracle | Cheap trust upgrades (2-of-3 signers with EMSC) | **Deferred.** Single oracle with veto stays for the MVP; a signer quorum parameter is a stretch goal |
| Plan | Drop the rebuild; build one repo directly against testnet | **Rejected as stated.** The owner chose a local rehearsal then a clean rebuild. The valid half (local chains cannot emulate Hedera) is handled by early testnet spikes |

**Where the review is wrong, contradictory or unverified**

1. **Its scheduling fix contradicts its own source.** It says Hedera allows one scheduled call per transaction (the error `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION`), then tells `payCoupon` to schedule the next coupon from inside a scheduled execution, which is exactly a scheduling-after-scheduled-recursion case. The only source for that error is one hackathon team's testnet write-up (Rialto). Official docs do not state the limit, and the list of schedulable transaction types in the docs does not include schedule creation, which suggests nested scheduling is unsupported. Treat self-chaining as untested and probably unavailable.
2. **The O(1) index fix does not cover coupons.** The review is silent on how interim coupons would be paid without a holder loop. A pull claim based on the balance at claim time can be claimed twice by moving units between wallets. That is why coupons move to redemption time (decision above).
3. **The index design makes ATS balances stop showing economic value.** After a write-down the token balance is unchanged; the value is `balance x (10000 - loss) / 10000`. The dashboard must show the effective value. This trade-off is not mentioned in the review.
4. **Unsourced statistics.** The figures 55,938 and 35,579 "out of 170,000 tested combinations" cite a document with no URL. Claude reproduced only the worked example: with the old formula, 30% then cumulative 70% on 1,000,000 units leaves 300,020; with a single division it leaves 300,000.
5. **Market-size mismatch.** The review says the cat bond market is "$40B+"; earlier research here found $65.6B outstanding at the end of H1 2026. Neither is needed for the design; re-check before quoting either.
6. **"Pause the ATS token during the challenge window"** would also stop coupons and transfers and depends on an unconfirmed ATS guard. Rejected.
7. **Second oracle from EMSC:** its event IDs and magnitudes differ from USGS, so two sources rarely agree to the basis point. Useful as a displayed cross-check, not as an enforced quorum.
8. **`receive()` bypassed by native transfers:** the cited article does not say this. Unverified.
9. **"Parametric payouts take about a month at FONDEN":** not checked here. The Jamaica release gives no payout timing either.

**Checked by Claude against sources (2026-10-25)**

- Scheduled transactions: "The maximum allowed value is 62 days (5356800 seconds)" (Hedera docs). Confirmed.
- `scheduleCall` and `scheduleCallWithPayer` return a response code (22 on success) and a zero address on failure, and "do not revert" (Hedera Schedule Service docs). Confirmed. `hasScheduleCapacity(uint256,uint256)` exists. Confirmed.
- ATS v8 testnet factory 0.0.9213391: `deployBond` needs a Luhn-valid ISIN; `grantKyc` needs the order grant `ROLE_SSI_MANAGER`, then `addIssuer(issuer)`, then `grantKyc`; `mint` requires KYC on the recipient (ATS issue 1390). Confirmed.
- World Bank Jamaica bond, 18 May 2026: USD 200 million replacing the USD 150 million cover paid after Hurricane Melissa; coupon is compounded SOFR plus 0.12% funding margin plus 6.75% risk margin; buyers must be qualified institutional buyers under Rule 144A; Moody's RMS is the calculation agent. Confirmed. The release does not describe the collateral structure.
- USGS GeoJSON feeds are updated every minute and use `[longitude, latitude, depth]` order. Confirmed. The meaning of `status` values and `magType` was not defined on that page; verify against USGS event documentation before coding the filter.
- On Hedera, a payable constructor sees `msg.value == 0` even if value was sent, and values inside the EVM are in tinybar (one dev article; consistent with the AlarmClock contract, which held its 5 HBAR but should not rely on `msg.value` in the constructor).

**Addendum: owner decisions in the prep session (2026-10-25)**

These override the matching text above. Full reasoning in `docs/ARCHITECTURE.md` section 12.

- D1: the oracle signs a per-event `lossBps`; `execute` applies `min(10000, L + lossBps)`; Superseded means `L == 10000`. Terms state the aggregation (sum capped at 100%).
- D2: `submit` reverts while paused; veto still works while paused. The submission cutoff is `submissionDeadline() = maturity + grace + total paused time` (a running pause counts), and redemption plus the sweeps open only after that same deadline; a pause that starts before the deadline keeps redemption closed, one that starts after it does not (wording corrected 2026-10-27, SEC-05).
- D3: `sweepExcess()` releases the sponsor's unused reserve after `submissionDeadline()` even if some holders never redeem.
- D4: on-chain supply guard in `invest`, `redeem`, `sweepExcess`; the deploy script also checks ATS role members (`ROLE_ISSUER` = pool only, no `ROLE_AGENT`, no `ROLE_ADJUSTMENT_BALANCE`).
- D5: deploy pool, then trigger (reads the schedule from the pool), then `pool.initialize(trigger)` once.
- D6: only the sponsor funds coupons, before `issuanceEnd`. D7: coupon drops from execution time. D8: oracle keeps a ledger of USGS `ids` to stop double attestation after event merges. D9: no lock/hold/clearing roles on the bond.
- D10: historical replays use "replay" terms (`mode: "replay"`, fixed `timeOffsetSec`, real `dataHash`); `termsHash` keeps replay attestations out of live bonds. Accepted magTypes: `mww, mwc, mwb, mwr, mw`. The real Bhuj event id is `usp000a8ds`.
- Tooling: Hardhat 2, solc 0.8.28, EVM `cancun`; dashboard Next.js.

- Mock policy (owner, 2026-10-25): real testnet wherever possible; mocks only for time-travel and repeated tests, each matched to a spike result or marked "not testnet-verified". Faultline's real deployment uses fresh accounts (deployer, oracle signer, sponsor, investors); spikes reuse the old issuer/investor.

- D13 (owner, 2026-10-26): parameters. Box Kutch, Gujarat (lat 22.5 to 24.5 N, lon 68.5 to 71.5 E), depth at most 70 km, magTypes as D10, curve linear 7.0 (0%) to 8.0 (100%), cooling 6 h, cap 10,000 USD, minimum ticket 100 USD. Bhuj `usp000a8ds` was re-checked on the live USGS API on 2026-10-26 (M7.7, `mwc`, reviewed, depth 16 km, 23.419 N 70.232 E) and gives 7000 bps. **Demo-only, production is different:** the 60 s challenge window, the ~20 min risk period (with ~5 min issuance and ~3 min grace) on testnet, and the 6% coupon. A production-like bond would use a 48 to 72 h window, a 1 to 3 year term, 30 days grace and a coupon priced from the expected loss. The local e2e uses 365 days, 30 days grace and a 48 h window with time travel. Full table: `docs/ARCHITECTURE.md` section 12.1.

- D14 (owner, 2026-10-26, for the testnet smoke run): in replay mode the oracle's cooling period is measured on the real clock from the real USGS origin time (`realNow - floor(time/1000) >= coolingPeriodSec`; live unchanged), so a decades-old replayed event is never held up and the demo does not exercise cooling. Replay is allowed only on chainIds 31337 (Hardhat) and 296 (Hedera testnet), enforced off-chain in shared/ts `buildAttestation` and in every deploy script; no contract change (on chain the mode shows only through `termsHash`). The HCS message gains `mode` and `timeOffsetSec`. Details: `docs/ARCHITECTURE.md` §12 D14.

- D15 (owner, 2026-10-27): if a PENDING event later fails the rule (moved out of the box, below the floor, too deep, another magType or status, deleted), the oracle cannot revise it to 0; it logs a loud error, publishes a signed `faultline.advisory` to HCS ("trustee should veto") and submits nothing. Pending events are re-checked on a fast loop (`pendingPollSec`) for the whole window. A USGS revision after the window is a residual risk (no clawback). Details: `docs/ARCHITECTURE.md` §12 D15.
- D16 (owner, 2026-10-27): HCS topic submit key = oracle signer key, admin key = trustee key; a separate relayer account (`FLH_RELAYER_PRIVATE_KEY`, `0.0.11329581`) pays HCS and EVM fees; the oracle signer needs no HBAR. Every HCS payload carries the oracle's signature (EIP-712 / EIP-191). Spike S7 tests the layout. Details: §6.5, §8, §12 D16.

- D11 (owner, 2026-10-25, after spike S3): before every stablecoin transfer `FaultlinePool` calls HTS `0x167` `isKyc(token, account)` and reverts with `NotKycForToken(account)` (or `HtsCallFailed(code)`), because the HTS facade reverts with empty data. Checked in `fundCoupons` (sponsor + pool), `invest` (investor + pool) and `claim` (recipient + pool since D17). HTS order is associate → KYC → fund. Local tests use a `MockHTS` at `0x167`.
- D17 (owner, 2026-10-27, security review docs/SECURITY-REVIEW.md): `TRUSTEE_ROLE` is its own admin (the trigger admin can no longer add or remove trustees; trustees add a backup; losing every trustee key removes veto and pause); constructors bound `challengeWindow <= 30 days` and `grace <= 365 days`; `claim()` also pre-checks the pool's stablecoin KYC. SEC-02 (foreign mint locks redemption) accepted: the bond `DEFAULT_ADMIN_ROLE` should be a multisig or timelock in production. Details: ARCHITECTURE §12 D17.

- D18 (owner, 2026-10-31, SEC-15, replaces the strict check of D4): `_checkSupply` reverts only when `bond.totalSupply() > unitsIssued - unitsRedeemed`, because ATS v8 lets any KYC'd holder burn its own units with no role and one burned base unit locked `invest`, `redeem` and `sweepExcess` for everyone. `isSolvent` counts `min(unitsIssued - unitsRedeemed, bond.totalSupply())`. Accepted downsides: a foreign mint up to the burned amount is not detected (it still needs a forbidden bond role; after `sweepDust` such a mint is unbacked and the last claimant is short), and burned collateral stays reserved until `sweepDust`. Needs a new deployment: the testnet evidence is from build `e617570`, before D18, and a re-run on the fixed build is still to do. Details: ARCHITECTURE §12 D18.
- SEC-19 (owner, 2026-10-31): a pause has no maximum and a lost admin key can lock redemption for ever. Accepted as a trust assumption, no contract change; production needs the admin in a multisig (ARCHITECTURE §9). SEC-21 (a holder can create a hold with no role): docs only.

**Sources opened for this section**

- [Hedera docs: Schedule Transaction](https://docs.hedera.com/learn/core-concepts/transactions/scheduled)
- [Hedera docs: Schedule Service system contract](https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service)
- [Rialto on ETHGlobal (testnet findings on scheduling)](https://ethglobal.com/showcase/rialto-psod2)
- [ATS issue 1390: v8 factory and KYC footguns](https://github.com/hashgraph/asset-tokenization-studio/issues/1390)
- [World Bank: Jamaica catastrophe bond, May 2026](https://www.worldbank.org/en/news/press-release/2026/05/18/world-bank-prices-catastrophe-bond-for-disaster-protection-for-jamaica)
- [USGS GeoJSON feed documentation](https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php)
- [Dev article: Hedera tinybar and weibar](https://dev.to/edycutjong/hederas-evm-speaks-tinybar-its-rpc-speaks-weibar-and-both-mistakes-return-success-132e)

## Appendix: throwaway test code from the owner's Mac

These files proved the mechanisms in section 5. They are test-only: `Redeemer` has no access control. Do not copy it into Faultline.

`contracts/Redeemer.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IController {
  function controllerRedeem(address,uint256,bytes calldata,bytes calldata) external;
}
contract Redeemer {
  function redeem(address token, address holder, uint256 amt) external {
    IController(token).controllerRedeem(holder, amt, "", "");
  }
}
```

`scripts/deployRedeemer.ts`

```typescript
import { network } from "hardhat";
const { ethers } = await network.connect({ network: "testnet" });
const [deployer] = await ethers.getSigners();
const c = await (await ethers.getContractFactory("Redeemer", deployer)).deploy();
await c.waitForDeployment();
console.log("Redeemer:", await c.getAddress());
```

`scripts/grantController.ts` (run with `ROLE=0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e ACCOUNT=<redeemer address> npx hardhat run scripts/grantController.ts --network testnet`)

```typescript
import { network } from "hardhat";
const { ethers } = await network.connect({ network: "testnet" });
const [signer] = await ethers.getSigners();
const abi = ["function grantRole(bytes32 _role, address _account) returns (bool)"];
const token = new ethers.Contract(process.env.TCB!, abi, signer);
const tx = await token.grantRole(process.env.ROLE!, process.env.ACCOUNT!);
await tx.wait();
console.log("granted", tx.hash);
```

`scripts/callRedeem.ts` (env `REDEEMER` and `HOLDER`, where HOLDER is the investor's EVM address)

```typescript
import { network } from "hardhat";
const { ethers } = await network.connect({ network: "testnet" });
const [signer] = await ethers.getSigners();
const r = await ethers.getContractAt("Redeemer", process.env.REDEEMER!, signer);
const tx = await r.redeem(process.env.TCB!, process.env.HOLDER!, 1000000n);
await tx.wait();
console.log("ok", tx.hash);
```

Import-path fix applied to the HIP-1215 alarm tutorial (macOS `sed`):

```bash
sed -i '' 's#@hashgraph/smart-contracts/contracts/system-contracts/hedera-schedule-service/#@hiero-ledger/hiero-contracts/schedule-service/#g' contracts/*.sol
sed -i '' 's#@hashgraph/smart-contracts/contracts/system-contracts/HederaResponseCodes.sol#@hiero-ledger/hiero-contracts/common/HederaResponseCodes.sol#g' contracts/*.sol
```

`AlarmClockSimple.sol` (from the hedera-dev/hedera-code-snippets tutorial `hss-schedule-sc-calls`, not reproduced): the contract inherits `HederaScheduleService`, calls `scheduleCall(address(this), time, 2_000_000, 0, callData)`, emits `AlarmScheduled` and `AlarmTriggered`, and is deployed with 5 HBAR attached.

`redeem.js` (earlier standalone script, not reproduced): ethers v6 `JsonRpcProvider` on `https://testnet.hashio.io/api`, wallet from env `PK` (the issuer's ECDSA private key, read from the environment only), calls `controllerRedeem(holder, 5000000n, "0x", "0x")` on the token.
