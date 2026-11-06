# Remaining tests

First version, 2026-10-30 (assessment session 1). Ordered by severity. Sources: the revert map and gaps in
`docs/TEST-INVENTORY.md` sections 5, 6 and 9.

Nothing here has been run unless it says so. In "Blocks", the hackathon means the Hedera testnet MVP demo; production means real
value.

**Session 2 update (2026-10-30).** Done, mock-tested: RT-01, RT-03, RT-04, RT-05, RT-07, RT-08, RT-09, RT-10, RT-14, RT-17, RT-18,
RT-19. Results: `docs/SECURITY-TEST-REPORT.md`. RT-01 proved the bug but SEC-15 stays open until the owner approves the fix. Still
to be written: every other file named under "Command". RT-24 and RT-26 got a first pass only (56 hand-picked mutants, a gas table).

**Session 3 update (2026-10-31).** Done, mock-tested: RT-06 (`test/invariants.fuzz.test.ts`), SEC-15 fix D18 (RT-01 closed), task 2D, 2E, 2F. RT-02 has a
script, not run. RT-20 has a likely cause and a fix, not yet confirmed by ten runs. RT-24 and RT-26 got a second pass.

Rules that apply to all items: a P0 or P1 proof comes first as a failing test, the contract changes only with the owner's
approval, and the owner runs `EXECUTE=1` for every testnet transaction after a dry run.

| ID | Severity | Item | Session | Blocks |
| --- | --- | --- | --- | --- |
| RT-01 | High | Failing test: supply decrease locks redemption (SEC-15) (**done; fixed by D18, session 3**) | 2 | Neither any more |
| RT-02 | High | Real testnet holder burn on the fixed build (**script written, not run**) | later, owner runs | Production |
| RT-03 | High | ATS holder-surface parity with MockBond (**done, session 2**) | 2 | Production |
| RT-04 | Medium | Bond paused, roles revoked mid-lifecycle (**done, session 2**) | 2 | Production |
| RT-05 | Medium | `redeem` re-entry through the bond (**done, session 2**) | 2 | Production |
| RT-06 | Medium | Stateful invariant fuzzing (**done, session 3**) | 3 | Production |
| RT-07 | Medium | Repeated and unbounded pause, lost trustees (**done, session 2**) | 2 | Production |
| RT-08 | Medium | Revision of a pending event at L = 10000 (**done, session 2**) | 2 | Production |
| RT-09 | Medium | Trigger not wired as `pool.trigger` (**done, session 2**) | 2 | Production |
| RT-10 | Medium | Exact boundaries on the real trigger (**done, session 2**) | 2 | Production |
| RT-11 | Medium | Testnet negative paths | later, owner runs | Production; part of the hackathon story |
| RT-12 | Medium | Cooling period through the oracle CLI | 3 | Production |
| RT-13 | Medium | Oracle unit gaps and coverage | 3 | Production |
| RT-14 | Medium | Strengthen weak tests (**done, session 2**) | 2 | Neither directly |
| RT-15 | Low | Dashboard post-deadline pause (SEC-16) | 3 | Neither directly |
| RT-16 | Low | Dashboard write paths, routes, wrong chain | 3 | Production |
| RT-17 | Low | KYC and token failure sites (**done, session 2**) | 2 | Production |
| RT-18 | Low | Arithmetic and calldata extremes (**done, session 2**) | 2 | Production |
| RT-19 | Low | Inherited role surface (**done, session 2**) | 2 | Production |
| RT-20 | Low | `web:e2e` flakiness (**likely cause fixed in `4a0ac09`, ten-run check still to do**) | 3 | Neither directly |
| RT-21 | Low | Coverage artifact guard (SEC-17) | 4 | Neither directly |
| RT-22 | Category | CI workflows | 4 | Production |
| RT-23 | Category | Lint and format | 4 | Neither directly |
| RT-24 | Category | Mutation testing | 3 | Production |
| RT-25 | Category | Formal verification | after session 4 | Production |
| RT-26 | Category | Gas baseline | 4 | Neither directly |
| RT-27 | Category | Deep secret and dependency scan | 4 | Production |
| RT-28 | Category | Fork tests | decide in session 3 | Neither directly |

---

## High

### RT-01 — Failing test: supply decrease locks redemption (SEC-15)

- **Why it matters:** one burned base unit stops every holder's `redeem`. All 338 tests pass today because no test lowers supply.
- **Scenario:** invest A and B, pass the deadline, call `bond.test_adjustBalance(holder, -1n)` to stand in for the ATS self-burn. Then:
  (1) another holder's `redeem` must still work, (2) `sweepExcess` must still work, (3) `invest` during issuance must still work,
  (4) `claim` of existing credit keeps working, (5) solvency holds and the burner gets nothing extra.
- **Prerequisites:** none. `test_adjustBalance` already exists, so no mock changes.
- **Command:** `npx hardhat test test/pool.supplyburn.test.ts`
- **Expected:** **FAIL today** with `SupplyMismatch` at steps 1–3, proving the finding. Passes only after an approved fix.
- **Evidence needed:** the failing output, then owner approval, then the fix and the green run.
- **Blocks:** production. Hackathon: the demo path does not hit it, but the README trust notes must disclose it or the fix must land.

### RT-02 — Real testnet holder burn

- **Why it matters:** the fix rests on simulated burns. A mined burn proves the ATS path, and that D18 keeps every holder paid on a real bond.
- **Owner decision (2026-10-31):** do not prove the bug on chain. The test runs on the next fixed deployment only.
- **Scenario:** on the next demo deployment of a build with D18, between phases 3 and 6, investor A calls ATS `redeem(1, "")`. Then every holder redeems and the books close through demo-6.
- **Prerequisites:** owner keystore, HBAR, a fresh deployment. The script refuses a pre-D18 deployment, so the finished `e617570` evidence cannot be touched.
- **Command:** `PART=burn EXECUTE=1 npm run ops:demo:rt02` (`ops/scripts/demo/rt02-holder-burn.ts`; it was in the spikes repo until 2026-11-03) (owner only, dry run first); `PART=check` after the deadline; then demo-6 `PART=a B_BY_SCRIPT=1` and `PART=sweep`. **Written, not run.**
- **Expected:** supply falls by 1; `pool.redeem()` for every holder succeeds; demo-6 final assertions pass with `unitsIssued - unitsRedeemed == 1`.
- **Evidence needed:** tx hash from the mirror, supply before and after, final books, on the fixed build.
- **Blocks:** production.

### RT-03 — ATS holder-surface parity with MockBond

- **Why it matters:** `MockBond` copied what the spikes measured, not everything a holder may call. SEC-15 is what that gap produced.
- **Scenario:** list every ATS v8 function callable without a role (source tag `v.8.0.0-ats`, `ops/abi/AtsBond.json`). Include `redeem`, `redeemFrom`,
  `redeemByPartition`, `operatorRedeemByPartition`, `authorizeOperator`, hold and clearing entry points. Simulate each on spike bond FLSPK, and on historical FLDMO blocks. Decide for each: does it change
  `totalSupply` or `balanceOf`? This also settles U13 (free balance) and whether D9 ("never grant hold roles") is enough if a holder can create a hold alone.
- **Prerequisites:** read-only, no keys.
- **Command:** a read-only script with `eth_call` and the mirror `contracts/call` endpoint.
- **Expected:** a table of holder-callable functions and their effect on D4 and `redeem`.
- **Evidence needed:** simulation results with control calls. The local bond-ABI test should compare with the real ATS ABI, not MockBond.
- **Blocks:** production.

---

## Medium

### RT-04 — Bond paused, roles revoked mid-lifecycle

- **Why it matters:** the pool depends on bond roles it does not own. These three states have no pool-level test, yet the bond admin can create them.
- **Scenario:** after invest: pause MockBond, or revoke `ROLE_CONTROLLER`, or make it non-controllable. `redeem` must revert, change no book, and work again after the state is restored. Same for `invest` with a paused bond.
- **Prerequisites:** MockBond already supports these.
- **Command:** `npx hardhat test test/pool.bondstate.test.ts`
- **Expected:** bond error bubbles; `claimable`, `unitsRedeemed` and `couponIndex` unchanged; recovery works.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-05 — `redeem` re-entry through the bond

- **Why it matters:** the only uncovered branch (`FaultlinePool.sol:237`).
- **Scenario:** a bond whose `controllerRedeem` calls back `redeem`, `claim`, `sweepExcess`. `sweepExcess` has no guard, so check its result during re-entry.
- **Prerequisites:** a new test-only re-entrant bond mock. It is new Solidity under `contracts/mocks/`, so ask the owner first.
- **Command:** `npx hardhat test test/pool.reentrancy.test.ts`
- **Expected:** `ReentrancyGuardReentrantCall` for guarded calls; no double credit. Pool branches 98/98.
- **Evidence needed:** coverage output.
- **Blocks:** production.

### RT-06 — Stateful invariant fuzzing

- **Done, session 3:** `docs/SECURITY-TEST-REPORT.md` "Financial invariants". Excluded from the sequences, by design: foreign mints (they break invariant 1 by definition; deterministic tests cover them) and holds (`test/bond.holdersurface.test.ts`).
- **Why it matters:** HANDOVER §7 asked for random holder splits and random transfers. Only one 15-run, 2-holder property exists.
- **Scenario:** random sequences of invest, transfer, submit, revise, veto, pause, unpause, execute, redeem, claim, sweep. Many holders and odd unit amounts. Check all ARCHITECTURE §5 invariants after each step, and every terminal state.
- **Prerequisites:** fast-check is installed. Foundry, Echidna and Medusa are not.
- **Command:** `FC_RUNS=500 npx hardhat test test/invariants.fuzz.test.ts`
- **Expected:** no invariant break. Failures print a seed.
- **Evidence needed:** runs, seeds, duration.
- **Blocks:** production.

### RT-07 — Repeated and unbounded pause, lost trustees

- **Why it matters:** since D17 only a trustee can remove a trustee, and a pause has no maximum. One trustee key can delay redemption with no bound.
- **Scenario:** trustee re-pauses after each unpause; rogue trustee revokes the backup; last trustee renounces; admin key lost during a pause.
- **Prerequisites:** none.
- **Command:** `npx hardhat test test/trigger.griefing.test.ts`
- **Expected:** characterises behaviour. The owner decides whether a limit is wanted.
- **Evidence needed:** test output; note in the security report.
- **Blocks:** production.

### RT-08 — Revision of a pending event at L = 10000

- **Why it matters:** an uncovered state on a covered line.
- **Scenario:** A and B pending, A executes to 10000, oracle revises B. Expect `FullyWrittenDown`; then B executes to Superseded; `pendingCount` returns to 0 and redemption opens.
- **Prerequisites:** none.
- **Command:** `npx hardhat test test/trigger.revision.test.ts`
- **Expected:** as described, no stuck event.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-09 — Trigger not wired as `pool.trigger`

- **Why it matters:** a deploy mistake could leave an event that can never execute, and `pendingCount` above 0 blocks redemption unless the trustee vetoes in time.
- **Scenario:** a second trigger for the same pool takes an event and tries to execute. Expect `OnlyTrigger` to bubble. The real pool is unaffected because it reads its own trigger only.
- **Prerequisites:** none.
- **Command:** `npx hardhat test test/trigger.integration.test.ts`
- **Expected:** revert bubbles, no state change on either side.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-10 — Exact boundaries on the real trigger

- **Why it matters:** the D and D + 1 checks for redemption run against MockTrigger.
- **Scenario:** with the real trigger: `redeem` and `sweepExcess` at D revert, at D + 1 work. `sweepDust` at D and D + 1 on both. Repeat with a pause that moved the deadline.
- **Prerequisites:** none.
- **Command:** `npx hardhat test test/trigger.integration.test.ts`
- **Expected:** same edges as with the mock.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-11 — Testnet negative paths

- **Why it matters:** these are mock-tested only, so the real ATS, HTS and relay behaviour is unknown.
- **Scenario:** revision with a window restart; D15 advisory on a real topic; two executed events; 10000 cap; Superseded; `NotKycForToken` from the real `0x167`; `submit` and `redeem` while paused;
  pause after the deadline; `setOracle`; backup trustee signing a tx; refused calls as real reverts; `hedera-sdk` transport.
- **Prerequisites:** a fresh demo profile, owner keystore, HBAR estimate, a new spikes script for each with a dry run.
- **Command:** new `ops/scripts/` phases, owner runs `EXECUTE=1`.
- **Expected:** same results as local, or a documented difference.
- **Evidence needed:** tx ids from the mirror on the **current** build, added to `docs/TESTNET-EVIDENCE.md`.
- **Blocks:** production. Hackathon: optional, HANDOVER §11 Flow B (two events) is the only item the pitch names.

### RT-12 — Cooling period through the oracle CLI

- **Why it matters:** replay never exercises the 6-hour rule (D14). It is tested only at helper level in `test/shared.attestation.test.ts`.
- **Scenario:** a live-mode record at ages 21,599 s and 21,600 s with an injected clock, through `watch` to the decision. Below the limit: nothing published or submitted. At the limit: attested.
- **Prerequisites:** a way to inject the clock in the service. Check whether that needs an oracle change; if so, ask first.
- **Command:** `cd oracle && npx vitest run test/cooling.test.ts`
- **Expected:** inclusive boundary as in ARCHITECTURE §6.2.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-13 — Oracle unit gaps and coverage

- **Why it matters:** `attest`, `cli`, `service`, `rule` and the keeper's sending path run only in one local e2e. Coverage is unknown.
- **Scenario:** add a coverage provider; unit-test the gate before publish, the re-check loop, ledger recovery, keeper failure and retry.
- **Prerequisites:** owner OK for a dev dependency.
- **Command:** `cd oracle && npx vitest run --coverage`
- **Expected:** a coverage number and tests for each decision path.
- **Evidence needed:** coverage report.
- **Blocks:** production.

### RT-14 — Strengthen weak tests

- **Why it matters:** `docs/TEST-INVENTORY.md` section 6 lists tests that pass when broken.
- **Scenario:** `web/test/gas.test.ts` must compare with the real peak of 317,337. `oracle/test/config.test.ts` must compare the type hash with the artifact constant. The SEC-06 test must cover execute-first and then assert the restarted window. Remove the conditional claim in `pool.sweep`.
- **Prerequisites:** none.
- **Command:** `npm run check`
- **Expected:** each stronger test fails against the old behaviour, checked once by hand.
- **Evidence needed:** the failing run, then the passing run.
- **Blocks:** neither directly.

---

## Low

### RT-15 — Dashboard post-deadline pause (SEC-16)

- **Why it matters:** the UI blocks a redemption the contract allows, and a test pins it.
- **Scenario:** snapshot paused with `pauseStart` after the deadline: `canRedeem` and `canSweep` allow, phase is not "grace". A pause begun before the deadline stays closed.
- **Prerequisites:** the snapshot already has `pauseStart`. A fix needs owner approval.
- **Command:** `npm run web:test`
- **Expected:** FAIL today.
- **Evidence needed:** failing output, then the fix.
- **Blocks:** neither directly.

### RT-16 — Dashboard write paths, routes, wrong chain

- **Why it matters:** only veto and execute are pressed in a browser. SEC-11's guard never fires in a test, and no route handler runs.
- **Scenario:** Playwright for invest, fund, redeem, claim, pause, unpause, sweep; wallet on the wrong chain; rejected transaction; call each `/api` route with bad ids and with the local API off.
- **Prerequisites:** a test wallet option that reports another chain.
- **Command:** `npm run web:e2e`, `npm run web:test`
- **Expected:** every write carries the buffered gas; the wrong chain stops before signing; routes return 400 or 404.
- **Evidence needed:** test output, screenshots.
- **Blocks:** production.

### RT-17 — KYC and token failure sites

- **Why it matters:** the shared helper is tested but several call sites are not.
- **Scenario:** `HtsCallFailed` in `invest`; frozen pool on `claim`; token returning `false` for `SafeERC20FailedOperation`.
- **Prerequisites:** `MockUSD` supports freeze. A false-returning token needs a new mock, so ask first.
- **Command:** `npx hardhat test test/pool.claim.test.ts test/pool.invest.test.ts`
- **Expected:** the named error, and no state change.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-18 — Arithmetic and calldata extremes

- **Why it matters:** these are uncovered, though most are unreachable or harmless. Checked explicitly, they stop being assumptions.
- **Scenario:** `invest(MaxUint256)`; `associate()` code at or above 2^63; constructors with no-code addresses; `riskStart > maturity`; a `submit` calldata with a dirty `uint16`.
- **Prerequisites:** `RawCaller` exists.
- **Command:** `npx hardhat test test/edge.values.test.ts`
- **Expected:** clean reverts, no state change.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-19 — Inherited role surface

- **Why it matters:** HANDOVER §7 asks that strangers cannot touch roles. Only the trigger's trustee role is tested.
- **Scenario:** stranger `grantRole` and `revokeRole` on pool and trigger; `renounceRole` with a wrong confirmation; admin granting itself anything on the pool has no effect on funds.
- **Prerequisites:** none.
- **Command:** `npx hardhat test test/roles.test.ts`
- **Expected:** `AccessControlUnauthorizedAccount`, `AccessControlBadConfirmation`.
- **Evidence needed:** test output.
- **Blocks:** production.

### RT-20 — `web:e2e` flakiness

- **Why it matters:** one failure with no saved cause. Two passes cannot clear it.
- **Likely cause (review session, 2026-10-31), fixed in `4a0ac09`:** the oracle CLIs block `scripts/dashboard-demo-local.ts`, the node closes the idle keep-alive socket, and the next request, `evm_setIntervalMining`, fails with `ECONNRESET`. The script now retries that call once. **Likely, not proven:** the original failure left no log, and the ten-run check below has not been done since the fix.
- **Scenario:** 10 consecutive runs, each log saved; on failure keep the trace from `web/e2e/.results`.
- **Prerequisites:** about 20 minutes.
- **Command:** `for i in 1 2 3 4 5 6 7 8 9 10; do npm run web:e2e > docs/baseline-logs/web-e2e-$i.log 2>&1; echo $i $?; done`
- **Expected:** 10 of 10, or a captured cause.
- **Evidence needed:** the logs.
- **Blocks:** neither directly.

### RT-21 — Coverage artifact guard (SEC-17)

- **Why it matters:** instrumented bytecode could be deployed by mistake.
- **Scenario:** make `npm run coverage` recompile afterwards, or have deploy scripts refuse a keccak mismatch.
- **Prerequisites:** owner OK for the script change.
- **Command:** `npm run coverage && npm run compile`, then compare hashes.
- **Expected:** creation keccak equals the documented build.
- **Evidence needed:** hashes.
- **Blocks:** neither directly.

---

## Missing categories

### RT-22 — CI workflows

- **Why it matters:** nothing runs on its own. There is no `.github/` in either repo.
- **Scenario:** a workflow for `npm run check`, `e2e:local`, `oracle:e2e:local`, coverage thresholds, `npm audit`, gitleaks.
- **Prerequisites:** the repo is private and pushed by the owner. Never add a remote from the worker.
- **Command:** `.github/workflows/check.yml`, written after owner approval.
- **Expected:** green on a clean clone with no secrets.
- **Evidence needed:** the first run, from the owner.
- **Blocks:** production.

### RT-23 — Lint and format

- **Why it matters:** only `web/` has ESLint. No solhint, no root or oracle lint, no format check.
- **Scenario:** add solhint and a format check, report findings without bulk-rewriting files.
- **Prerequisites:** owner OK for dev dependencies.
- **Command:** `npx solhint 'contracts/**/*.sol'`
- **Expected:** a triaged list.
- **Evidence needed:** tool output.
- **Blocks:** neither directly.

### RT-24 — Mutation testing

- **Why it matters:** the only direct measure of "would a test catch this". SEC-15 shows line coverage is not enough.
- **Scenario:** mutate operators in both contracts, at least the comparisons in `docs/TEST-INVENTORY.md` section 9.4.
- **Prerequisites:** a tool choice, or a scripted hand-made set on a copy of the repo, never in place.
- **Command:** decided in session 3.
- **Expected:** a survivors list; each survivor becomes a test or is justified.
- **Evidence needed:** mutation report.
- **Blocks:** production.

### RT-25 — Formal verification

- **Why it matters:** solvency and rounding fit it well, but it is not needed for the MVP.
- **Scenario:** prove `sponsorCredited + sum of floors <= U`, and the deadline monotonicity.
- **Prerequisites:** a tool choice.
- **Command:** none yet.
- **Expected:** proofs or counterexamples.
- **Evidence needed:** tool output.
- **Blocks:** production.

### RT-26 — Gas baseline

- **Why it matters:** the step 9 failure was a gas limit problem, and nothing asserts gas today.
- **Scenario:** snapshot gas for each public function locally, and compare with the testnet numbers in the evidence.
- **Prerequisites:** none.
- **Command:** `npm run test:gas`
- **Expected:** a stored table and a threshold.
- **Evidence needed:** gas report.
- **Blocks:** neither directly.

### RT-27 — Deep secret and dependency scan

- **Why it matters:** this session did a quick pattern scan and history scan only.
- **Scenario:** a working-tree scan excluding env files, Slither re-triage, dependency review of the 8 low oracle advisories, a check of both repos' ignore rules.
- **Prerequisites:** none. Never read env files or keystores.
- **Command:** session 4 decides the exclusions for `gitleaks dir`.
- **Expected:** no live secret; each advisory triaged.
- **Evidence needed:** redacted reports.
- **Blocks:** production.

### RT-28 — Fork tests

- **Why it matters:** a fork could run real ATS code locally, which would have shown SEC-15.
- **Scenario:** check whether a Hedera testnet fork can run the ATS diamond and the `0x167` system contract at all.
- **Prerequisites:** a time-boxed spike. Precompiles may not work on a fork.
- **Command:** decided in session 3.
- **Expected:** a yes or no with the reason. If no, this category is closed with that reason.
- **Evidence needed:** spike notes.
- **Blocks:** neither directly.

## Added 2026-11-03 (ops/ move and issuer page)

### RT-29 — Issuer page on Hedera testnet (owner)

- **Why it matters:** the `/issuer` page launches a bond from a browser wallet. On the local node the whole flow passes (Playwright,
  `web/e2e/issuer.spec.ts`), but **nothing of it is testnet-verified**: the ATS factory `deployBond`, `addIssuer`, `grantKyc`,
  the two contract creations, `initialize` and `applyRoles` have only ever been sent by scripts, never by MetaMask; HANDOVER §4
  records that Hashio once rejected a large-gas MetaMask transaction.
- **Scenario:** network "Hedera testnet (296)", MetaMask on the deployer account, the default parties (full-demo accounts) and the
  testnet demo schedule. Run every step in order (the backup trustee step with MetaMask on the trustee account): the HCS topic and the two HTS KYC steps with the `ops/` commands the page prints
  (dry run, then `EXECUTE=1`), every other step with the wallet. Then open the new bond through the header's Bond selector.
- **Prerequisites:** owner keystore for the ops steps, HBAR on the deployer (about 15 HBAR by the full-demo figures: bond about 8,
  pool and trigger about 4, the rest small), a clean `npm run compile` + `npm run web:build`.
- **Command:** `npm run web:build && npm --prefix web start`, then `/issuer`; ops steps: `npm run ops:issuer:topic`,
  `npm run ops:issuer:kyc` with the values the page fills in.
- **Expected:** all audit checks PASS, including both "creation code on chain equals the repo build" rows; the overview of the new
  bond reads it; the HCS topic's keys are the oracle signer and the trustee.
- **Evidence needed:** every tx hash, the topic id, the audit list, a row in docs/TESTNET-EVIDENCE.md.
- **Blocks:** neither the demo nor production directly; it is required before the README may call the issuer page testnet-verified.

### RT-30 — First real run of the moved scripts from ops/

> **Status 2026-11-05 (UTC): run from `ops/` on the FLH_* accounts.** The smoke run is complete
> (33/33 transactions SUCCESS), and the full demo ran phases 0–6 (Flow A vetoed, Flow B executed, L = 7000, settled at
> 501 = 500 + 1, investor B through the dashboard), on the D18 build (commit `a0b1dd5`), and both contracts are `exact_match` on Sourcify. **Done.** Ids and
> hashes: docs/DEPLOYMENTS.md and docs/TESTNET-EVIDENCE.md. The text below is the original plan.

- **Why it matters:** the scripts moved from the spikes repo on 2026-11-03. Their dry runs match the spikes copy, but no transaction
  has been sent from `ops/` (docs/TESTNET-EVIDENCE.md "Scripts moved to ops/").
- **Scenario:** the next owner-run testnet session (the fixed-build re-run with RT-02) runs from `ops/` with a fresh
  `ops/out/demo-state.json` (move the archived copy aside first).
- **Command:** `CHECK_KEYS=1 npm run ops:demo:0`, then the phases of COMMANDS §11 with `EXECUTE=1`.
- **Expected:** the same results as the 2026-10-27/28 run, on the D18 build.
- **Evidence needed:** the new evidence log and TESTNET-EVIDENCE rows that name the faultline commit instead of a spikes commit.
- **Blocks:** any claim that the fixed build ran on testnet.
