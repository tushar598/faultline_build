# Status: testnet-verified vs mock-tested

What has run on Hedera testnet with real transactions, and what is mock-tested only. Evidence:
[`TESTNET-EVIDENCE.md`](TESTNET-EVIDENCE.md); ids: [`DEPLOYMENTS.md`](DEPLOYMENTS.md); test state:
[`TEST-STATE.md`](TEST-STATE.md).

## Feature status

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
| Security review (HANDOVER §10 step 8) | **self-review, not an audit** (2026-10-27) | [`docs/SECURITY-REVIEW.md`](SECURITY-REVIEW.md): Slither, coverage, npm audit, gitleaks, manual checklist, key-compromise table. That review found 0 High. **The later test assessment found one High, SEC-15, fixed by D18**; [`docs/SECURITY-TEST-REPORT.md`](SECURITY-TEST-REPORT.md) holds the current list: 0 Critical, 0 open High. Fixed SEC-01/03/04 (contracts, D17), SEC-08 (oracle), SEC-09 (oracle dependency overrides), SEC-10/11 (web), SEC-15 (D18); accepted SEC-02 (D4 lock), SEC-06 (finality wording) and SEC-19 (unbounded pause). Regression tests in `test/security.contracts.test.ts` and `test/pool.supplyburn.test.ts` |

Test counts on 2026-11-06: `npm run check` → 436 Hardhat tests, 83 oracle tests (+ 1 skipped), 99 web tests, `ops/` typecheck; `npm run web:e2e` → 11. All local, on mocks.

## Issuer page

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
Commands: COMMANDS.md §9.
