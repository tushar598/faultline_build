# Roadmap — Milestone 1: ETHGlobal Mumbai MVP

## Phase Overview

| # | Phase | Requirements | Depends On | Est. Time |
| --- | --- | --- | --- | --- |
| P1 | Hedera Testnet Spikes (S1–S3) | R1 | — | ~4 h |
| P2 | Interfaces & Mocks | R2.1–R2.4 | P1 (revert selectors, failure modes) | ~2 h |
| P3 | FaultlinePool Contract | R2.5, R2.7, R2.9, R2.10 | P2 | ~4 h |
| P4 | FaultlineTrigger Contract | R2.6, R2.8, R2.9 | P2 | ~3 h |
| P5 | Contract Tests | R3 | P3, P4 | ~4 h |
| P6 | Oracle Service | R4 | P4 (EIP-712 domain), P1 (USGS findings) | ~4 h |
| P7 | HCS Spike (S5) | R8 | P1 (testnet account) | ~1 h |
| P8 | Dashboard | R5 | P3, P4 (ABIs), P6 (oracle terms) | ~6 h |
| P9 | End-to-End & Testnet Deploy | R6, R3.4 | P3–P6, P7 | ~4 h |
| P10 | Demo Video & Polish | R7, R9 | P8, P9 | ~3 h |

**Total estimated:** ~35 hours

---

## P1 — Hedera Testnet Spikes (S1–S3)

> **Goal:** Verify the 14 unverified assumptions before writing any contract code.

**Requirements:** R1.1–R1.7

**Deliverables:**
- [ ] S1: ATS v8 bond deployed with nominal 1 USD / 6 decimals; `mint`, `controllerRedeem` verified; revert selectors recorded
- [ ] S2: Pause vs `controllerRedeem` verified; confirm "never pause the bond"
- [ ] S3: HTS stablecoin created; contract association, KYC, ERC-20 facade verified; failure modes recorded
- [ ] `docs/LESSONS.md` updated with spike results
- [ ] `docs/ARCHITECTURE.md` §10 U-rows marked verified/false
- [ ] README verified-vs-mock table updated
- [ ] Mock requirements updated if any behavior differs from reference notes

**UAT:**
- Every spike question answered with testnet evidence (tx hash + HashScan link)
- Revert selectors and gas costs documented
- Stop rule: if a spike fails twice for the same reason, stop and report

**Notes:**
- Spikes run in `~/Desktop/faultline-spikes/` (separate repo, Hardhat 3 + encrypted keystore) — reference repo history; in this repo the operator scripts live in `ops/`
- Every testnet transaction needs owner confirmation
- Keys never in chat; only `read -s` in terminal

---

## P2 — Interfaces & Mocks

> **Goal:** Build the contract interfaces and test mocks calibrated to spike results.

**Requirements:** R2.1–R2.4

**Deliverables:**
- [ ] `contracts/interfaces/IAtsBond.sol` — `mint`, `controllerRedeem`, `balanceOf`, `totalSupply`, `decimals`, `hasRole`, `getRoleMemberCount`, `isControllable`
- [ ] `contracts/interfaces/IFaultlinePool.sol` — pool public interface
- [ ] `contracts/interfaces/IFaultlineTrigger.sol` — trigger public interface
- [ ] `contracts/interfaces/IHRC719.sol` — HIP-719 `associate()` call
- [ ] `contracts/mocks/MockBond.sol` — KYC flag, role checks, pause, revert selectors from S1/S2
- [ ] `contracts/mocks/MockUSD.sol` — ERC-20 + KYC, association, failure modes from S3
- [ ] All mocks compile with `npm run compile`

**UAT:**
- Mock revert selectors match actual ATS v8 behavior from spikes
- MockUSD failure mode (revert vs `false`) matches HTS facade
- Type-check passes (`npm run typecheck`)

---

## P3 — FaultlinePool Contract

> **Goal:** Implement the collateral, issuance, loss-index, coupon, and claims contract.

**Requirements:** R2.5, R2.7, R2.9, R2.10

**Deliverables:**
- [ ] `contracts/FaultlinePool.sol` — full implementation per `docs/ARCHITECTURE.md` §3
- [ ] All functions: `initialize`, `fundCoupons`, `invest`, `applyLoss`, `redeem`, `claim`, `sweepExcess`, `sweepDust`
- [ ] All views: `effectiveValue`, `currentCouponIndex`, `requiredReserve`, `collateralLeft`, `couponReserveLeft`, `isSolvent`
- [ ] All custom errors from §3.6
- [ ] All events from §3.5
- [ ] Supply guard (D4), balance-delta checks, CEI + nonReentrant
- [ ] Compiles with `npm run compile`

**UAT:**
- All functions O(1) (no loops over holders or events)
- Rounding always against the holder
- No `receive()`, no payable, no HBAR handling
- Uses `ReentrancyGuardTransient` (not deprecated `ReentrancyGuard`)

---

## P4 — FaultlineTrigger Contract

> **Goal:** Implement the EIP-712 attestation, challenge window, and event management contract.

**Requirements:** R2.6, R2.8, R2.9

**Deliverables:**
- [ ] `contracts/FaultlineTrigger.sol` — full implementation per `docs/ARCHITECTURE.md` §4
- [ ] All functions: `submit`, `veto`, `execute`, `pause`, `unpause`, `setOracle`
- [ ] All views: `effectiveTime`, `submissionDeadline`, `windowEndsAt`, `windowRemaining`, `getEvent`, `hashAttestation`, `pendingCount`
- [ ] Custom pause with `totalPausedSeconds` accounting (D2)
- [ ] Per-event loss aggregation (D1): `min(10000, L + lossBps)`
- [ ] `Superseded` status when `L == 10000`
- [ ] All custom errors from §4.5, all events from §4.4
- [ ] Compiles with `npm run compile`

**UAT:**
- EIP-712 domain: name `"FaultlineTrigger"`, version `"1"`, chainId, verifyingContract
- Veto works while paused; submit and execute do not
- Event status transitions are one-way (terminal statuses never change)

---

## P5 — Contract Tests

> **Goal:** Comprehensive test coverage including property-based invariant testing.

**Requirements:** R3.1–R3.5

**Deliverables:**
- [ ] `test/pool.unit.ts` — all FaultlinePool functions: happy path + every revert + events
- [ ] `test/trigger.unit.ts` — all FaultlineTrigger functions: same coverage
- [ ] `test/invariants.ts` — fast-check property tests asserting all 11 invariants
- [ ] `test/e2e.ts` — full lifecycle on local Hardhat chain
- [ ] `test/helpers/` — shared fixtures, time helpers, constants
- [ ] All tests pass with `npm test`

**UAT:**
- 100% custom error coverage (every revert path tested)
- 100% event emission coverage
- Invariants hold under random sequences (property-based)
- Edge cases: 100% loss, 0% loss, 1-unit holder, max supply, concurrent events
- Gas report generated with `npm run test:gas`

---

## P6 — Oracle Service

> **Goal:** Build the TypeScript calculation agent that reads USGS, signs attestations, and submits on-chain.

**Requirements:** R4.1–R4.10

**Deliverables:**
- [ ] `oracle/src/usgs.ts` — USGS API client with Zod validation
- [ ] `oracle/src/rule.ts` — acceptance check (reviewed, earthquake, magType, box, depth, cooling)
- [ ] `oracle/src/terms.ts` — terms file loading, JCS canonicalization, `termsHash`
- [ ] `oracle/src/attest.ts` — EIP-712 attestation signing
- [ ] `oracle/src/hcs.ts` — HCS topic publishing (or mock file writer)
- [ ] `oracle/src/submit.ts` — on-chain `trigger.submit()` call
- [ ] `oracle/src/cli.ts` — CLI entry point
- [ ] `oracle/src/payout.ts` — linear interpolation, integer bps
- [ ] USGS id ledger (D8) — prevent duplicate attestations
- [ ] Replay mode (D10) — `timeOffsetSec` offset
- [ ] Synthetic test fixtures in `oracle/fixtures/`
- [ ] Oracle unit tests pass with `npm run oracle:test`

**UAT:**
- Acceptance rule matches ARCHITECTURE §6.2 exactly
- Payout curve is pure integer math (no floating point)
- termsHash matches on-chain computation
- HCS messages ≤ 1024 bytes
- Replay mode produces valid attestations for historical quakes

---

## P7 — HCS Spike (S5)

> **Goal:** Verify HCS topic create/publish/read on testnet.

**Requirements:** R8.1–R8.2

**Deliverables:**
- [ ] HCS topic created with submit key
- [ ] Sample attestation JSON published and read back from mirror node
- [ ] Chunking behavior tested (1500-byte message)
- [ ] Message latency measured
- [ ] Results recorded in `docs/LESSONS.md`

**UAT:**
- Message readable within seconds
- Only the submit key can post
- Topic id and HashScan link recorded

---

## P8 — Dashboard

> **Goal:** Build the Next.js dashboard for investor, sponsor, trustee, and replay views.

**Requirements:** R5.1–R5.6

**Deliverables:**
- [ ] Investor page — holdings, effective value, coupon, redeem/claim
- [ ] Sponsor page — fund coupons, write-down credit, claim, sweep
- [ ] Trustee page — pending events, veto, pause/unpause
- [ ] Replay page — historical quake replay with live updates
- [ ] REPLAY badge when `mode == "replay"`
- [ ] Contract reads via ethers (Pool + Trigger ABIs)
- [ ] Mirror node reads for HCS messages
- [ ] Responsive, production-quality UI

**UAT:**
- All contract views render correctly
- Actions (invest, redeem, claim, veto, etc.) create correct transactions
- Read `web/node_modules/next/dist/docs/` for Next.js 16 breaking changes before writing code

---

## P9 — End-to-End & Testnet Deploy

> **Goal:** Deploy to Hedera testnet and run the full lifecycle.

**Requirements:** R6.1–R6.4, R3.4

**Deliverables:**
- [ ] `scripts/deploy-local.ts` — local Hardhat deployment script
- [ ] `scripts/e2e-local.ts` — local full lifecycle demo
- [ ] `scripts/testnet/deploy.ts` — testnet deployment
- [ ] `scripts/testnet/setup.ts` — bond creation, role grants, KYC
- [ ] Contracts deployed to testnet chain 296
- [ ] Contracts verified on HashScan (Sourcify)
- [ ] Full lifecycle executed on testnet: fund → invest → replay quake → window → execute → redeem
- [ ] `docs/TESTNET-EVIDENCE.md` created with tx hashes

**UAT:**
- All contracts verified on HashScan
- Complete lifecycle runs without errors
- Every testnet transaction has owner's approval

---

## P10 — Demo Video & Polish

> **Goal:** Create the ≤5 min demo video and finalize the submission.

**Requirements:** R7.1–R7.4, R9

**Deliverables:**
- [ ] Demo video ≤ 5 min
- [ ] 20-second cat bond explainer opening
- [ ] Demo shows: KYC flow, investment, quake replay, challenge window, write-down, redemption
- [ ] Honest framing: prototype, trusted oracle, not a regulated product
- [ ] README finalized with architecture diagram, status table, trust assumptions
- [ ] ATS enhancement proposal (upstream contribution)
- [ ] Force Redeem SDK bug report

**UAT:**
- Video covers all qualification requirements
- Private GitHub repo (created and pushed by the owner) is clean and documented
- README status table fully updated
