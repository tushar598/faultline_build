# Requirements — Milestone 1: ETHGlobal Mumbai MVP

## Must Have (Core Demo)

### R1: Hedera Testnet Verification (Spikes S1–S3)
- **R1.1:** Deploy ATS v8 bond with nominal 1 USD, 6 decimals, controllable, internal KYC — [Spike S1]
- **R1.2:** Verify `mint` and `controllerRedeem` through a probe contract with correct roles — [S1]
- **R1.3:** Confirm `controllerRedeem` works after maturity and without holder KYC — [S1]
- **R1.4:** Confirm `controllerRedeem` reverts when bond is paused — [S2]
- **R1.5:** Create HTS stablecoin (6 dec, KYC key, no wipe key), verify contract association + ERC-20 facade — [S3]
- **R1.6:** Verify KYC requirement on contract accounts for HTS transfers — [S3]
- **R1.7:** Record every revert selector, gas cost, and failure mode — [S1–S3]

### R2: Smart Contracts
- **R2.1:** `IAtsBond.sol` interface — `mint`, `controllerRedeem`, `balanceOf`, `totalSupply`, `decimals`, `hasRole`, `getRoleMemberCount`, `isControllable`
- **R2.2:** `IHRC719.sol` interface — `associate()` for HTS token
- **R2.3:** `MockBond.sol` — mimics ATS v8 with KYC flag, role checks, pause behavior (matched to spike results)
- **R2.4:** `MockUSD.sol` — ERC-20 with KYC flag, association check, failure modes matching HTS facade
- **R2.5:** `FaultlinePool.sol` — collateral management, issuance, loss index, coupon accrual, redemption, claims, sweeps. All functions O(1), all invariants from ARCHITECTURE §5
- **R2.6:** `FaultlineTrigger.sol` — EIP-712 attestation intake, challenge window with pause-time accounting, veto, execute, oracle rotation
- **R2.7:** Supply guard (D4) — revert if `bond.totalSupply() != unitsIssued - unitsRedeemed`
- **R2.8:** Per-event loss aggregation (D1) — `min(10000, L + lossBps)`
- **R2.9:** Dynamic submission deadline (D2) — `maturity + grace + totalPausedSeconds`
- **R2.10:** Balance-delta checks on all stablecoin transfers

### R3: Tests
- **R3.1:** Unit tests for every FaultlinePool function — happy path, all custom error reverts, event emissions
- **R3.2:** Unit tests for every FaultlineTrigger function — same coverage
- **R3.3:** Property-based invariant tests (fast-check) — all 11 invariants from ARCHITECTURE §5
- **R3.4:** End-to-end local test — full lifecycle: fund → invest → quake → window → execute → redeem → sweep
- **R3.5:** Edge cases: 100% loss, 0% loss, boundary magnitudes, 1-unit holders, max supply, concurrent events

### R4: Oracle
- **R4.1:** USGS reader — fetch + parse GeoJSON with Zod validation
- **R4.2:** Trigger rule engine — acceptance check (reviewed, earthquake, magType, box, depth, cooling period)
- **R4.3:** Payout curve — linear interpolation floor→ceil magnitude, integer bps, round down
- **R4.4:** Terms file — JCS-canonicalized JSON, `termsHash = keccak256(bytes)`
- **R4.5:** EIP-712 attestation signer — sign with ethers, matching on-chain domain
- **R4.6:** HCS publisher — submit attestation JSON to topic (≤1024 bytes)
- **R4.7:** On-chain submitter — call `trigger.submit(att, sig)`
- **R4.8:** USGS id ledger (D8) — prevent duplicate attestations for merged events
- **R4.9:** Replay mode (D10) — `timeOffsetSec` for demo with historical quakes
- **R4.10:** Oracle unit tests — acceptance rule, payout curve, terms hash, signing

### R5: Dashboard
- **R5.1:** Investor view — bond holdings, effective value (post-loss), accrued coupon, redeem/claim actions
- **R5.2:** Sponsor view — coupon funding, write-down proceeds, claim, sweep
- **R5.3:** Trustee view — pending events, veto button, pause/unpause
- **R5.4:** Replay view — feed historical quake, watch challenge window, see write-down
- **R5.5:** REPLAY badge when in replay mode
- **R5.6:** Read from Pool + Trigger contracts and Mirror node for HCS messages

### R6: Testnet Deployment
- **R6.1:** Deploy FaultlinePool and FaultlineTrigger to Hedera testnet (chain 296)
- **R6.2:** Wire to ATS v8 bond and HTS stablecoin created in spikes
- **R6.3:** Verify contracts on HashScan (Sourcify)
- **R6.4:** Run full lifecycle on testnet (fund → invest → replay quake → window → execute → redeem)

### R7: Demo Video
- **R7.1:** ≤5 min video covering: issuance, configuration, lifecycle operation (write-down + redemption)
- **R7.2:** Open with 20-second cat bond explainer
- **R7.3:** Show: non-KYC transfer blocked, replay of real Bhuj quake, trustee window, sponsor payout
- **R7.4:** Closing: honest framing (prototype, not regulated product)

## Should Have

### R8: HCS Spike (S5)
- **R8.1:** Create HCS topic with submit key, publish attestation JSON, read back from mirror node
- **R8.2:** Verify message latency and chunking behavior

### R9: Upstream Contribution
- **R9.1:** ATS enhancement proposal for event-linked instruments
- **R9.2:** Force Redeem SDK bug report

## Nice to Have

### R10: Coupon Snapshots (Spike S6)
- **R10.1:** ATS coupon entitlement and snapshot reading for interim coupons

### R11: Schedule Service (Spike S4)
- **R11.1:** Recursive self-scheduling for keeper-free coupon payments

### R12: Security
- **R12.1:** Formal security review checklist
- **R12.2:** Trust assumptions document in README
