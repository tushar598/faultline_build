# Test inventory and baseline (assessment session 1)

Date: 2026-10-30. Repo commit `a98f806` (branch point `main`), with the owner's uncommitted edits to `HANDOVER.md`,
`README.md` and `docs/COMMANDS.md` left in place. Spikes repo: 27 commits, read only.
Environment: macOS 26.5.2 arm64, Node v24.16.0, npm 11.13.0.

This session was read-only on code. No contract, oracle or dashboard file changed, no test was written and no testnet
transaction was sent. All testnet checks below are mirror-node reads or `eth_call` simulations.

Status words: PASS — LOCAL, PASS — TESTNET, PASS — STATIC, PASS — REVIEWED, FAIL, BLOCKED, NOT IMPLEMENTED, NOT RUN,
INCONCLUSIVE. A pass here is evidence about the listed scenario only. It does not mean the project is secure, audited,
bug-free or production-ready.

Raw output of every command is in `docs/baseline-logs/*.log` (git-ignored, local only). `summary.log` holds name, exit
code and seconds for each command.

---

## 1. Headline numbers

| Suite | Files | Discovered | Passed | Failed | Skipped | Environment |
| --- | --- | --- | --- | --- | --- | --- |
| Hardhat (`npm test`) | 20 | 203 | 203 | 0 | 0 | in-process chain, mocks |
| Oracle Vitest (`npm run oracle:test`) | 14 | 84 | 83 | 0 | 1 (opt-in live USGS) | offline, stubs |
| Web Vitest (`npm run web:test`) | 9 | 44 | 44 | 0 | 0 | offline, stubs |
| Playwright (`npm run web:e2e`), run 1 | 1 | 8 | 8 | 0 | 0 | local node, test wallet |
| Playwright (`npm run web:e2e`), run 2 | 1 | 8 | 8 | 0 | 0 | local node, test wallet |
| **Distinct automated tests** | **44** | **339** | **338** | **0** | **1** | |

Local scripts `npm run e2e:local` (3 flows) and `npm run oracle:e2e:local` (4 scenarios) also passed; they are not counted
as tests above. `test/e2e.local.test.ts` runs the same 3 flows and is counted.

**One new High finding came out of this session: SEC-15, section 8.** All 338 tests pass with it present, because
`MockBond` does not have the function involved.

---

## 2. Test files

Exact counts come from per-file runs (`docs/baseline-logs/20-perfile-*.log`) and Vitest JSON output. They add up to the
full-suite totals (203, 84, 44).

### 2.1 Hardhat, chai, TypeScript

Reproduce one file: `npx hardhat test test/<file>`. All use the in-process Hardhat chain.

| File | Tests | Covers | Doubles | Security properties |
| --- | --- | --- | --- | --- |
| `test/pool.setup.test.ts` | 13 | constructor bounds, `initialize`, D5, D17 grace bound | MockBond, MockUSD, MockHTS, MockTrigger, MockTokenVariant | schedule validity, admin-only init, one-time init |
| `test/pool.fund.test.ts` | 9 | `fundCoupons`, D6, D11 | same + MockHtsVariant | sponsor-only, KYC pre-check, balance delta |
| `test/pool.invest.test.ts` | 16 | `invest`, cap, ticket, reserve, D4, D11 | same | supply guard (foreign mint side only), KYC, 1:1 mint |
| `test/pool.loss.test.ts` | 11 | `applyLoss`, D7, D12, one fast-check property | same, MockTrigger forwards the call | trigger-only, monotonic L, path-independent credit |
| `test/pool.redeem.test.ts` | 12 | `redeem`, D2, D4, rounding, transfer before loss | same, MockTrigger setters | deadline gate, pending gate, rounding against holder |
| `test/pool.claim.test.ts` | 7 | `claim`, D11, D17 | same + MockHtsVariant | pull payment, CEI, frozen claimant isolated |
| `test/pool.sweep.test.ts` | 6 | `sweepExcess`, `sweepDust`, D3 | same, MockTrigger setters | holder cover after sweep, gates |
| `test/pool.reentrancy.test.ts` | 3 | `nonReentrant` on `fundCoupons`, `invest`, `claim` | MockReentrantToken | reentrancy through the stablecoin only |
| `test/trigger.setup.test.ts` | 7 | constructor, D17 roles, EIP-712 domain | real pool, mocks | trustee self-admin, domain binding |
| `test/trigger.submit.test.ts` | 16 | `submit` rules, check order | real pool, mocks | signature binding, malleability, deadline, terms |
| `test/trigger.revision.test.ts` | 7 | revisions, replay of terminal events | real pool, mocks | replay protection, stale revisions |
| `test/trigger.pause.test.ts` | 13 | veto, pause clock, D2 deadline | real pool, mocks | pause never consumes the window |
| `test/trigger.execute.test.ts` | 9 | `execute`, D1, Superseded, `setOracle` | real pool, mocks | order independence, cap, permissionless execute |
| `test/trigger.integration.test.ts` | 6 | lifecycle with the real pool | real pool + real trigger, mock tokens | invariant 11, deadline + pending gates end to end |
| `test/security.contracts.test.ts` | 6 | SEC-01/02/03/04/06 regressions | real pool + real trigger, mock tokens | admin cannot remove veto, D4 lock (foreign mint) |
| `test/e2e.local.test.ts` | 3 | Flows A, B, C with independent numbers | real pool + real trigger, mock tokens, real Bhuj record | books close, cap, Superseded |
| `test/interfaces.test.ts` | 4 | role ids and attestation fields vs docs | none | drift between docs, JSON and Solidity |
| `test/mocks.test.ts` | 35 | the mocks themselves | MockBond, MockUSD, MockHTS, MockTrigger | none directly: proves mock rules match spike notes |
| `test/shared.attestation.test.ts` | 15 | terms, hashes, curve, acceptance rule, replay, signing | one on-chain digest check | cooling (controlled time, unit level), D14 chain allowlist |
| `test/shared.jcs.test.ts` | 5 | RFC 8785 canonical JSON | none | hash determinism |

Helpers: `test/helpers/{eip712,fixtures,pool,roles,time,trigger}.ts`. `expectInvariants` (`helpers/pool.ts`) checks
invariants 1, 3 and 4 after state-changing steps; `expectStatuses` (`helpers/trigger.ts`) checks the status model.

Of the 203, **35 test mocks** and **20 test off-chain helpers**, so 148 exercise `FaultlinePool` or `FaultlineTrigger`
(counting `interfaces`).

### 2.2 Oracle, Vitest

Reproduce one file: `cd oracle && npx vitest run test/<file>`. Offline unless stated.

| File | Tests | Covers | Doubles | Security properties |
| --- | --- | --- | --- | --- |
| `oracle/test/config.test.ts` | 15 | startup refusal gate, zod schemas | none, chain facts passed in | wrong chain, terms, signer refused; D14 |
| `oracle/test/decision.test.ts` | 19 | revision table §6.6, D8, D15 | pure function | loss-change-only revisions, advisory instead of cancel |
| `oracle/test/hcs.test.ts` | 8 | message format, signatures, publishers | stubbed SDK transaction | D16 in-payload signatures, 1024-byte limit |
| `oracle/test/hederaEvm.test.ts` | 5 | `hedera-sdk` transport | stubbed SDK calls | signed bytes, decoded reverts |
| `oracle/test/keeper.test.ts` | 2 | `selectExecutable` only | pure function | paused trigger selects nothing |
| `oracle/test/keys.test.ts` | 5 | key loading | none | Hardhat keys refused off 31337, no key echoed |
| `oracle/test/ledger.test.ts` | 4 | D8 ledger | temp directory | atomic write, wrong-trigger file refused |
| `oracle/test/loop.test.ts` | 1 | watch loop | real 1.2 s timer | failing task does not stop the loop |
| `oracle/test/security.identity.test.ts` | 4 | SEC-08 | stubbed chain read | lost ledger cannot create a second eventId |
| `oracle/test/submit.test.ts` | 8 | revert decoding, links | none | already-handled classification |
| `oracle/test/usgs.test.ts` | 9 | zod parsing, HTTP retries | stubbed fetch, real saved records | malformed input, 204/404/409 |
| `oracle/test/abi.test.ts` | 2 | ABI subset vs artifacts | none | ABI drift |
| `oracle/test/shared-import.test.ts` | 1 | ESM import of `shared/ts` | none | none |
| `oracle/test/usgs.live.test.ts` | 1 skipped | live `dataHash` | real USGS, needs `USGS_LIVE=1` | NOT RUN in this baseline |

No unit test for `oracle/src/{attest,cli,service,rule}.ts` or `keeper.ts` beyond selection. They run only through
`npm run oracle:e2e:local`. No Vitest coverage provider is installed, so oracle line coverage is unknown.

### 2.3 Web, Vitest

Reproduce one file: `cd web && npx vitest run test/<file>`. Offline, environment `node`, no component rendering.

| File | Tests | Covers | Security properties |
| --- | --- | --- | --- |
| `web/test/guards.test.ts` | 12 | button guards, phase | mirrors contract rules (see SEC-16) |
| `web/test/errors.test.ts` | 9 | revert decoding to sentences | none |
| `web/test/format.test.ts` | 6 | amounts, times | truncation never rounds up |
| `web/test/security.web.test.ts` | 4 | `localApiEnabled`, `SAFE_ID` | SEC-10, id regex only |
| `web/test/abi.test.ts` | 3 | ABI vs artifacts | bond ABI is compared with **MockBond**, not ATS |
| `web/test/describe.test.ts` | 3 | activity text | none |
| `web/test/hcs.test.ts` | 3 | HCS decode, D16 signature flag, testnet terms hash | forged messages flagged |
| `web/test/bondName.test.ts` | 2 | header title | none |
| `web/test/gas.test.ts` | 2 | gas buffer | weak, see section 6 |

### 2.4 Playwright

`npm run web:e2e` (`web/e2e/dashboard.spec.ts`, helper `web/e2e/wallet.ts`). 8 serial tests on a local Hardhat node with a
test-only EIP-1193 wallet over unlocked Hardhat accounts. Real browser (Chromium), real Next.js build, mock tokens. No
MetaMask, no Hedera. Only two writes are driven through the UI: veto and execute. The invest, redeem, claim, pause,
unpause, fund and sweep buttons are not pressed.

### 2.5 Local end-to-end scripts

| Command | What runs | Chain | Result |
| --- | --- | --- | --- |
| `npm run e2e:local` | Flows A (veto, replay), B (L = 9000), C (cap, Superseded) | in-process | exit 0, numbers equal COMMANDS §6 |
| `npm run oracle:e2e:local` | 1 Bhuj replay, 2 D15 advisory, 3 D8 merge, 4 SEC-08 lost ledger | local node, mock HCS, real oracle CLI | exit 0, L 7000, 5 HCS lines |
| `npm run dashboard:demo:local` | demo world for manual use; run by the Playwright setup | local node | exercised through `web:e2e` |

### 2.6 Production and support code inventory

| Area | Files |
| --- | --- |
| Production contracts | `contracts/FaultlinePool.sol` (406 lines), `contracts/FaultlineTrigger.sol` (254) |
| Interfaces | `IAtsBond`, `IFaultlinePool`, `IFaultlineTrigger`, `IHRC719`, `IHederaTokenServiceLite` |
| Mocks | `MockBond`, `MockUSD`, `MockHTS`, `MockTrigger`, `MockVariants` (token, HTS, re-entrant token), `ApplyLossRecorder`, `RawCaller` |
| Oracle | `oracle/src/`: abi, attest, chain, cli, config, decision, hcs, hederaEvm, identity, keeper, keys, ledger, log, rule, service, submit, usgs |
| Shared | `shared/ts/{attestation,hcsMessage,jcs}.ts`, `shared/attestation.eip712.json` |
| Fixtures | 2 real USGS records, 6 labelled SYNTHETIC records (`oracle/fixtures/README.md`) |
| Local scripts | `scripts/{e2e-local,deploy-local,oracle-e2e-local,dashboard-demo-local}.ts`, `scripts/with-local-node.mjs`, `scripts/lib/{e2e,fixtures,oracle-local}.ts` |
| Testnet scripts | `faultline-spikes/scripts/`: `s0, s1, s2, s3, s5, s7, smoke, demo`, `lib` (53 TypeScript files). They have no automated tests; they produce evidence |
| Dashboard | Views `/`, `/investor`, `/sponsor`, `/trustee`, `/replay`, `/evidence` (6). Routes `/api/local/config`, `/api/local/hcs`, `/api/usgs/[id]` |
| Package scripts | root `package.json`: setup, compile, clean, test, test:gas, coverage, node, e2e:local, deploy:local, oracle:e2e:local, typecheck, oracle:typecheck, oracle:test, web:dev, web:build, web:lint, check, web:test, web:e2e, dashboard:demo:local |
| CI workflows | **None** in either repo (no `.github/`). NOT IMPLEMENTED |
| Security docs | `docs/SECURITY-REVIEW.md`, README trust section, ARCHITECTURE §9 |
| Testnet evidence | `docs/TESTNET-EVIDENCE.md`, `faultline-spikes/out/` (git-ignored) |

Environment variable **names** (values were not read):

- Main repo: `HEDERA_TESTNET_PK`, `HEDERA_TESTNET_RPC`, `HEDERA_MIRROR_URL`, `ATS_FACTORY_ID`, `ATS_RESOLVER_ID`, `BOND_ADDRESS`,
  `STABLECOIN_ADDRESS`, `POOL_ADDRESS`, `TRIGGER_ADDRESS`, `HCS_TOPIC_ID`, `USGS_API_BASE`, `ORACLE_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`,
  `ORACLE_RPC_URL`, `ORACLE_CONFIG`, `ORACLE_LOG_LEVEL`, `ORACLE_E2E_LIVE`, `USGS_LIVE`, `HARDHAT_ACCOUNT_ORACLE`, `HARDHAT_ACCOUNT_RELAYER`,
  `DEMO_ADVISORY`, `DEMO_WINDOW_SEC`, `FAULTLINE_LOCAL_API`, `FAULTLINE_REPO_DIR`, `NEXT_PUBLIC_TESTNET_RPC_URL`, `FC_RUNS`, `REPORT_GAS`, `SECURITY_VERBOSE`.
- Spikes repo: `EXECUTE`, `CHECK_KEYS`, `PART`, `PHASE`, `SEND_REVERT`, `B_BY_SCRIPT`, `BOND_MATURITY_MIN`, `MATURITY_MIN`, `MAX_WAIT_SEC`, `MIN_REMAINING_SEC`,
  `FORCE_SEND`, `FRESH_ADDRESS`, `FRESH_ID`, `VC_FILE`, `WHO`, `FL_RPC_URL`, and the keystore names `FL_{DEPLOYER,TRUSTEE,TRUSTEE_BACKUP,ORACLE,RELAYER,SPONSOR,INVESTOR_A,INVESTOR_B}_PRIVATE_KEY`.

---

## 3. Baseline results

| # | Command | Exit | Discovered | Passed | Failed | Skipped | Time | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `npm ci` (root) | 0 | n/a | n/a | n/a | n/a | 13 s | lockfile in sync; reports 41 dev-only advisories |
| 2 | `npm --prefix oracle ci` | 0 | n/a | n/a | n/a | n/a | 4 s | lockfile in sync; 8 low |
| 3 | `npm --prefix web ci` | 0 | n/a | n/a | n/a | n/a | 6 s | lockfile in sync; 0 |
| 4 | `npm run check` (drift check) | 0 | 331 | 330 | 0 | 1 | 23 s | compile, tests, typecheck, lint, web build; no drift |
| 5 | `npm run compile` | 0 | n/a | n/a | n/a | n/a | 1 s | up to date |
| 6 | `npm test` | 0 | 203 | 203 | 0 | 0 | 3 s | |
| 7 | `npm run typecheck` | 0 | n/a | n/a | n/a | n/a | 1 s | root |
| 8 | `npm run oracle:typecheck` | 0 | n/a | n/a | n/a | n/a | 2 s | |
| 9 | `npm --prefix web run typecheck` | 0 | n/a | n/a | n/a | n/a | 1 s | not part of `npm run check` |
| 10 | `npm run oracle:test` | 0 | 84 | 83 | 0 | 1 | 2 s | skipped = opt-in live USGS |
| 11 | `npm run web:lint` | 0 | n/a | n/a | n/a | n/a | 3 s | no warnings; ESLint on `web/` only |
| 12 | `npm run web:test` | 0 | 44 | 44 | 0 | 0 | 1 s | |
| 13 | `npm run web:build` | 0 | n/a | n/a | n/a | n/a | 2 s | incremental |
| 14 | `npm run e2e:local` | 0 | 3 flows | 3 | 0 | 0 | 2 s | summary equals COMMANDS §6 to the base unit |
| 15 | `npm run oracle:e2e:local` | 0 | 4 scenarios | 4 | 0 | 0 | 10 s | started its own node |
| 16 | `npm run web:e2e` run 1 | 0 | 8 | 8 | 0 | 0 | 111 s | |
| 17 | `npm run web:e2e` run 2 | 0 | 8 | 8 | 0 | 0 | 109 s | |
| 18 | `npm run coverage` | 0 | 203 | 203 | 0 | 0 | 11 s | section 3.2 |
| 19 | Slither 0.11.4 (COMMANDS §10) | 255 | 41 results | n/a | n/a | n/a | 4 s | exit 255 is Slither's code for "results found"; first attempt crashed, section 3.3 |
| 20 | `npm audit --omit=dev` (root, oracle, web) | 0, 1, 0 | n/a | n/a | n/a | n/a | n/a | production: 0, 8 low, 0. All (with dev): 41, 8, 0 |
| 21 | `gitleaks git` (both repos, redacted) | 0, 0 | 112 + 27 commits | no leaks | 0 | n/a | under 1 s | history only |
| 22 | Format check | n/a | n/a | n/a | n/a | n/a | n/a | **does not exist**: no Prettier or similar is configured |
| 23 | Solidity lint | n/a | n/a | n/a | n/a | n/a | n/a | **does not exist**: no solhint config |
| 24 | Oracle or root ESLint | n/a | n/a | n/a | n/a | n/a | n/a | **does not exist** |

`npm run check` counts: 203 + 83 + 44 = 330 passed, 1 skipped. It does not run Playwright, `e2e:local`, `oracle:e2e:local`,
coverage or the web typecheck.

### 3.1 Flakiness of `npm run web:e2e`

Two consecutive runs both passed 8 of 8 (111 s and 109 s), and a third in the end-of-session regression passed too (110 s).
The earlier failure with no saved cause **did not reproduce** and stays INCONCLUSIVE: three passes cannot rule out a low-rate
flake. Output is saved in `docs/baseline-logs/16-web-e2e-run1.log`, `17-web-e2e-run2.log` and `33-final-web-e2e.log`. Candidate
causes from reading the harness, none proven:

- The suite is serial, with a real 90 s challenge window. The veto test must finish inside that window.
- `scripts/with-local-node.mjs` stops the node with `node.kill()` on `npx`. In both runs the node was gone afterwards
  (`lsof` on 8545 and 3210 was empty), so a leaked node did not occur here. A run that does find a stale node reuses it.
- `oracle/test/loop.test.ts` also depends on real time (a 1.2 s sleep).

### 3.2 Coverage (`npm run coverage`, solidity-coverage 0.8.17)

| Contract | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| `FaultlinePool.sol` | 103/103 | **97/98** | 23/23 | 135/135 |
| `FaultlineTrigger.sol` | 55/55 | 74/74 | 14/14 | 84/84 |

The one uncovered branch is the "already entered" side of `nonReentrant` on `redeem()` (`FaultlinePool.sol:237`).

100 % branch coverage says a line ran, not that the rule is right. SEC-15 sits entirely inside fully covered code.

### 3.3 Static analysis

Slither first crashed with "source code appears to be out of sync with the build artifacts". The cause is SEC-17:
`npm run coverage` had left instrumented artifacts. After `npm run compile` it reported 41 results for 44 contracts and 100
detectors, the same count as `docs/SECURITY-REVIEW.md` §2. Those detector classes are already triaged there. Session 4
re-triages them.

`gitleaks dir` was **not** run: it scans the working tree and would read any `.env` file, which the session rules forbid.
It is scheduled for session 4 with an explicit exclusion.

---

## 4. Evidence by environment

| Group | Mocks | Local chain | Fork | Real Hedera testnet |
| --- | --- | --- | --- | --- |
| `test/pool.*` | MockBond, MockUSD, MockHTS, MockTrigger | yes | no | no |
| `test/trigger.*`, `test/security.contracts` | real contracts, mock tokens | yes | no | no |
| `test/e2e.local`, `npm run e2e:local` | real contracts, mock tokens | yes | no | no |
| `npm run oracle:e2e:local` | real oracle CLI, mock HCS, mock tokens | yes | no | no |
| Oracle Vitest | stubbed SDK, fetch, chain | no | no | no |
| Web Vitest | stubbed provider | no | no | no |
| Playwright | test wallet, mock tokens | yes | no | no |
| Smoke run (spikes) | none | no | no | **yes, pre-D17 build `d07f7a5`** |
| Full demo (spikes) | none | no | no | **yes, D17 build `e617570`** |
| Spikes S0–S7 | none | no | no | yes, probes only, not Faultline contracts |

Fork tests do not exist. NOT IMPLEMENTED.

---

## 5. Security properties and missing categories

### 5.1 Property coverage

| Property | Local evidence | Testnet evidence | Gap |
| --- | --- | --- | --- |
| Access control | pool and trigger tests | trustee grant real; admin refusal simulated | strangers on pool `grantRole` untested |
| Signature and replay | `trigger.submit`, `trigger.revision` | replay revert real tx | none known |
| Pause clock | `trigger.pause` | pause, veto, unpause real | `submit` and `redeem` while paused not on testnet |
| Write-down maths | `pool.loss`, `e2e.local` | one event, L = 7000 | two events and cap not on testnet |
| Solvency | `expectInvariants` at fixed points | books closed twice | no random-sequence invariant test |
| Supply guard D4 | foreign mint only | never tripped | **supply decrease untested: SEC-15** |
| Reentrancy | 3 of 4 guards | n/a | `redeem` re-entry through the bond |
| Oracle rule | `shared.attestation`, `oracle` | one real record | cooling only at unit level |
| Key handling | `oracle/test/keys` | keystore preflight | CLI-level leak test absent |
| Secrets in repo | gitleaks history, pattern scan | n/a | working-tree scan for session 4 |

### 5.2 Missing or insufficient categories

| Category | State |
| --- | --- |
| CI workflows | **NOT IMPLEMENTED**, in both repos |
| Stateful invariant fuzzing | NOT IMPLEMENTED; one fast-check property, 15 runs by default, 2 holders, no transfers |
| HANDOVER §7 "random holder splits and random transfers" | NOT IMPLEMENTED in the repo |
| Mutation testing | NOT IMPLEMENTED |
| Formal verification | NOT IMPLEMENTED |
| Fork tests | NOT IMPLEMENTED |
| ATS parity tests (mock vs real ABI) | NOT IMPLEMENTED; root cause of SEC-15 staying hidden |
| Oracle and web code coverage | NOT IMPLEMENTED, no provider installed |
| Solidity lint, repo-wide format check | NOT IMPLEMENTED |
| Web route-handler tests | NOT IMPLEMENTED; only the id regex and the enable flag are tested |
| Web component tests | NOT IMPLEMENTED |
| Real wallet automation | NOT IMPLEMENTED; MetaMask was manual, once |
| Wrong-chain wallet test (SEC-11) | NOT IMPLEMENTED; the test wallet always reports the right chain, so the SEC-11 guard never fires |
| Gas regression baseline | NOT IMPLEMENTED; `test:gas` prints, nothing asserts |
| Testnet negative paths | see `docs/REMAINING-TESTS.md` |

---

## 6. Weak, duplicate or misleading tests

Read by hand. "Passes if broken" means the assertion would still hold after the behaviour it names regressed.

| Test | Problem | Severity for confidence |
| --- | --- | --- |
| `web/test/gas.test.ts:11` "covers the gas the failed step 9 redeem used" | **Passes if broken.** It asserts `gasLimitFor(311_684n) > 304_741n`, which holds even with no buffer at all. The transaction failed for a peak need of 317,337, not 304,741 | High |
| `oracle/test/config.test.ts:15` "the EIP-712 type hash is the trigger's constant" | **Passes if broken.** It checks only the hex format. Any wrong type string passes. The real comparison happens in `checkStartup` tests with a value derived from the same function | High |
| `test/security.contracts.test.ts:73` SEC-06 "whoever lands first" | Tests only the revision-first order and never executes afterwards | Medium |
| `test/pool.sweep.test.ts:42` | `if (claimable > 0n) claim()` makes that step conditional | Low |
| `web/test/guards.test.ts:69` | Pins behaviour that contradicts the contract: SEC-16 | Medium |
| `web/test/abi.test.ts:20` | Named "ATS v8 names" but compares with MockBond, so it cannot catch ATS drift | Medium |
| `web/test/security.web.test.ts` | Tests a regex and a flag; no route handler runs | Medium |
| `test/pool.redeem.test.ts:63` "pause case (D2)" | Sets a number on MockTrigger; a real pause is covered in `trigger.pause` (duplicate) | Low |
| `test/pool.redeem.test.ts:147` | `lte` check after both values were already asserted exactly (adds nothing) | Low |
| `test/pool.setup.test.ts:79`, `test/trigger.setup.test.ts:73` | bare `.to.be.reverted`: any revert passes | Low |
| `test/interfaces.test.ts` "exposes the D2/D4/D11 surface" | Name presence only | Low |
| `oracle/test/shared-import.test.ts` | Import smoke test with one fixed value | Low |
| `oracle/test/keeper.test.ts` | Selection only; the sending path has no unit test | Medium |
| `oracle/test/loop.test.ts` | Depends on a real 1.2 s timer | Low |
| `test/security.contracts.test.ts` SEC-03, SEC-04 | Duplicate `trigger.setup` and `pool.claim` (kept on purpose as regressions) | Low |
| `test/mocks.test.ts` | 35 tests that prove mock rules, not production behaviour; they raise the headline count | Note |
| `test/pool.loss.test.ts` property | 15 runs by default, increasing sequences only, 2 holders | Medium |

No test is skipped, focused or marked `.only`, `.todo` or `.fixme`. The only skip is the opt-in live USGS test.
No test was found with no assertion at all.

---

## 7. README and evidence claims

Testnet evidence has two runs. They are not interchangeable.

| Run | Build | Contracts on testnet | What it proves | What it does not prove |
| --- | --- | --- | --- | --- |
| Smoke run, 2026-10-26 | `d07f7a5`, **pre-D17** | pool `0xEB64…Cf7E`, trigger `0xA4C8…7cCc` | Happy path on real ATS, HTS, `0x167`, signed by a script | Anything about D17. The deployed bytecode is not the current source |
| Full demo, 2026-10-27/28 | `e617570`, D17 | pool `0xC4Ba…B1a3`, trigger `0xED64…667A` | Pause, veto, replay revert, oracle, HCS, keeper, redeem, sweeps, one dashboard write | Revisions, two events, cap, Superseded, D15, D11 failures, post-deadline pause |

**Update 2026-10-31:** this no longer holds for the pool. D18 changed `FaultlinePool.sol` (creation keccak `0x78712136…09563f6d`), which
was never deployed; `FaultlineTrigger` stays byte-identical. The inventory below describes session 1 and is not rewritten.

**At session 1, current source equalled the D17 build.** `git diff e617570 HEAD -- contracts shared hardhat.config.ts oracle/src` was empty. A clean
compile gave creation keccak `0x13a97433…69957f43` (pool) and `0x3205b3ca…aa8fcf3` (trigger), equal to
`docs/TESTNET-EVIDENCE.md`.

### 7.1 Mirror-node spot check

All **68** transactions linked in the two evidence tables were looked up on the mirror node, far above the 10 required, plus
8 spike transactions. Read-only.

| Check | Claim | Mirror shows | Status |
| --- | --- | --- | --- |
| Smoke rows | 33 txs, all success | 33 found, 27 EVM + 6 SDK, 33 `SUCCESS` | PASS — TESTNET |
| Smoke fees | 35.14 HBAR | 35.1392 charged | PASS — TESTNET |
| Demo rows | 35 txs: 31 EVM + 4 SDK; 33 success, 2 reverts | exactly that; reverts are the replay and B's first redeem | PASS — TESTNET |
| Demo fees | 20.83 HBAR by balance drop; 20.8371 charged | 20.8371 charged | PASS — TESTNET |
| Signers | trustee pauses and vetoes, admin unpauses, relayer executes, B redeems | `from` matches each role | PASS — TESTNET |
| Replay revert | `EventFinalised(eventId, 2)` | selector `0x67e5eebc`, eventId of the SYNTHETIC record, status 2 | PASS — TESTNET |
| B's first redeem | gas limit 311,684, used 304,741, reverted | exactly that | PASS — TESTNET |
| B's retry | 1.3× limit | limit 405,190 = ceil(311,684 × 1.3) | PASS — TESTNET |
| HCS | topic holds exactly 2 messages, oracle signed | 2 messages, relayer paid, `verifyTypedData` recovers the oracle for both | PASS — TESTNET |
| Topic keys | submit = oracle, admin = trustee, not deleted | key prefixes match S7 values, `deleted` false | PASS — TESTNET |
| Sourcify | `exact_match` | both contracts: match, creation and runtime all `exact_match` | PASS — TESTNET |
| Final books | L 7000, 500 issued and redeemed, credited 350, claimable 0, solvent, pool 0 fUSD, supply 0 | `eth_call` and mirror agree | PASS — TESTNET |
| D17 roles | role admin is itself; trustee and backup yes, deployer no | `eth_call` agrees | PASS — TESTNET |
| Event records | SYNTHETIC Vetoed, Bhuj Executed | status 2 and 3, Bhuj `dataHash` `0xd604b4f7…` | PASS — TESTNET |
| Bond roles | ISSUER and CONTROLLER = pool; no AGENT, ADJUSTMENT, PAUSER | counts 1, 1, 0, 0, 0 | PASS — TESTNET |
| Spikes | S1, S2, S3 and HANDOVER §5 samples | 8 of 8 as documented; S2 reverted `0x1309a563` | PASS — TESTNET |

### 7.2 README claim table

| README claim | What the output shows | Status |
| --- | --- | --- |
| 203 Hardhat tests | 203 passing | PASS — LOCAL |
| 83 oracle tests + 1 skipped | 83 passed, 1 skipped | PASS — LOCAL |
| 44 web tests | 44 passed | PASS — LOCAL |
| 8 Playwright tests | 8 passed, twice | PASS — LOCAL |
| 77 tests in `test/pool.*` | 7+9+16+11+12+3+13+6 = 77 | PASS — LOCAL |
| 58 tests in `test/trigger.*`, 6 integration | 9+6+13+7+7+16 = 58, integration 6 | PASS — LOCAL |
| `npm run setup`, `npm run check` work | exit 0 | PASS — LOCAL |
| Coverage: pool 97/98, trigger 74/74 (COMMANDS §10) | identical | PASS — LOCAL |
| `npm run e2e:local` numbers (COMMANDS §6) | identical to the base unit | PASS — LOCAL |
| Full demo: 35 txs, 20.83 HBAR, books 501 = 500 + 1 | section 7.1 | PASS — TESTNET |
| Smoke run: 33 txs, 35.14 HBAR, pre-D17 | section 7.1 | PASS — TESTNET, pre-D17 build only |
| 60 s window, 26 min risk (smoke); 120 s, 25 min (demo) | 1,575 s and 1,523 s from the schedules | PASS — TESTNET |
| Pool lifecycle verified twice | section 7.1 | PASS — TESTNET, happy path only |
| Veto, while paused, status Vetoed | real tx, trustee signer, status 2 | PASS — TESTNET |
| Pause landed with 114 of 120 s left; 51 s paused | timestamps give it; `totalPausedSeconds` 51 | PASS — TESTNET |
| "only the admin unpaused" | the admin did unpause. That only the admin **can** is local evidence | PASS — TESTNET for what happened; exclusivity PASS — LOCAL |
| `execute` while paused simulated | evidence says simulation; no tx | PASS — STATIC, honest wording |
| Replay rejection | real reverted tx | PASS — TESTNET |
| Oracle end to end on testnet | chain and HCS side confirmed. That the real CLI produced them rests on the owner's run log | PASS — TESTNET for the chain side; CLI provenance PASS — REVIEWED |
| D17 trustee and backup; backup never signed | role reads agree | PASS — TESTNET |
| Sourcify `exact_match` | re-checked today | PASS — TESTNET |
| Dashboard wrote through MetaMask | investor B signed, gas limit fits the fix. The chain cannot show which wallet app signed | PASS — TESTNET for the tx; MetaMask PASS — REVIEWED |
| HIP-1215 self-scheduling, alarm contract | contract `0.0.11157023` exists with 2 results; no tx row in TESTNET-EVIDENCE | INCONCLUSIVE, not used by Faultline |
| Layout: "unit, property, invariant" tests | one property test; invariants are fixed-point checks | INCONCLUSIVE wording: no stateful invariant suite exists |
| Security review: 0 Critical, 0 High, 4 Medium, 4 Low, 6 Info | matches the 2026-10-27 table, but **SEC-15 is a new High** | FAIL as a current statement until updated |
| Trust note 5 and "Bond roles": name the bond admin as the way to trip the supply guard | incomplete: a plain holder can too (SEC-15) | FAIL |
| "Still mock-tested only" list | the listed items have no testnet row | PASS — REVIEWED |
| Not audited, prototype | stated plainly | PASS — REVIEWED |

---

## 8. Findings from this session

Moved to `docs/SECURITY-TEST-REPORT.md` section 9 in session 2.

---

## 9. Revert-path map

Input for sessions 2 and 3. "Covered" means a test triggers that exact site; the citation is file and test title (shortened).
Line numbers are for `a98f806`.

### 9.1 FaultlinePool

| Line | Function | Condition | Reverts | Existing test |
| --- | --- | --- | --- | --- |
| 125-128 | constructor | zero admin, stablecoin, bond, sponsor | `ZeroAddress` | `pool.setup` "reverts ZeroAddress…" (all 4) |
| 129-132 | constructor | `issuanceStart >= issuanceEnd` | `InvalidSchedule` | `pool.setup` "unless issuanceStart < …" (== and >) |
| 129-132 | constructor | `issuanceEnd > riskStart` | `InvalidSchedule` | same |
| 129-132 | constructor | `riskStart >= maturity` | `InvalidSchedule` | same (== only; > uncovered, same comparison) |
| 129-132 | constructor | `grace == 0` | `InvalidSchedule` | same |
| 129-132 | constructor | `grace > 365 days` | `InvalidSchedule` | `pool.setup` "D17 (SEC-03)" boundary |
| 133 | constructor | zero `couponBps`, `cap`, `minTicket` | `InvalidSchedule` | `pool.setup` "couponBps, cap or minTicket" |
| 134-136 | constructor | decimals not 6 | `InvalidSchedule` | `pool.setup` "6 decimals" (both tokens) |
| 134 | constructor | token or bond has no code | empty revert | **uncovered** |
| 158 | `initialize` | not `DEFAULT_ADMIN_ROLE` | `AccessControlUnauthorizedAccount` | `pool.setup` "only DEFAULT_ADMIN_ROLE" |
| 159 | `initialize` | second call | `AlreadyInitialized` | `pool.setup` "runs once" |
| 160 | `initialize` | zero trigger | `ZeroAddress` | `pool.setup` "zero trigger" |
| 161 | `initialize` | `trigger.pool() != this` | `TriggerMismatch` | same test |
| 161 | `initialize` | trigger has no code | empty revert | **uncovered** |
| 164 | `initialize` | `associate()` code does not fit int64 | `SafeCast` error | **uncovered** (HTS never returns this) |
| 165 | `initialize` | code not 22 or 194 | `HtsCallFailed` | `pool.setup` "any other associate() code" |
| 171 | `fundCoupons` | re-entered | `ReentrancyGuardReentrantCall` | `pool.reentrancy` "fundCoupons" |
| 172 | `fundCoupons` | not sponsor | `OnlySponsor` | `pool.fund` "only the sponsor" |
| 173 | `fundCoupons` | `now >= issuanceEnd` | `IssuanceClosed` | `pool.fund` boundary |
| 174 | `fundCoupons` | `amount == 0` | `ZeroAmount` | `pool.fund` |
| 175-176 | `fundCoupons` | sponsor or pool lacks KYC | `NotKycForToken` | `pool.fund` (both) |
| 189 | `invest` | re-entered | `ReentrancyGuardReentrantCall` | `pool.reentrancy` "invest" |
| 190 | `invest` | no trigger | `NotInitialized` | `pool.invest` |
| 191 | `invest` | `now < issuanceStart` | `IssuanceNotOpen` | `pool.invest` "window edges" |
| 192 | `invest` | `now >= issuanceEnd` | `IssuanceClosed` | same |
| 193 | `invest` | `units < minTicket` | `BelowMinTicket` | `pool.invest` "minTicket" |
| 195 | `invest` | over cap | `CapExceeded` | `pool.invest` "cap" |
| 195 | `invest` | `issued + units` overflows | Panic 0x11 | **uncovered** |
| 197 | `invest` | reserve short | `CouponReserveInsufficient` | `pool.invest` "reserve" (2 tests) |
| 198 | `invest` | supply above expected | `SupplyMismatch` | `pool.invest` "D4" (2 tests) |
| 198 | `invest` | **supply below expected** | `SupplyMismatch` | **uncovered, SEC-15** |
| 199-200 | `invest` | investor or pool lacks KYC | `NotKycForToken` | `pool.invest` D11 (both) |
| 199-200 | `invest` | HTS code not 22 | `HtsCallFailed` | **uncovered at this site** (same helper covered in fund, claim) |
| 202 | `invest` | fee-on-transfer | `UnexpectedTransferAmount` | `pool.invest` |
| 204 | `invest` | no bond KYC | bond `InvalidKycStatus` | `pool.invest` "KYC'd on the stablecoin but not on the bond" |
| 204 | `invest` | pool lost `ROLE_ISSUER` | bond `AccountHasNoRoles` | `pool.invest` "does not let the pool mint" |
| 204 | `invest` | **bond paused** | bond `IsPaused` | **uncovered** |
| 215 | `applyLoss` | caller not trigger | `OnlyTrigger` | `pool.loss` |
| 216 | `applyLoss` | `now < riskStart` | `RiskPeriodNotStarted` | `pool.loss` D12 (MockTrigger; real trigger cannot reach it) |
| 217 | `applyLoss` | `> 10000` | `LossOutOfRange` | `pool.loss` (MockTrigger; same) |
| 219 | `applyLoss` | not increasing | `LossNotIncreasing` | `pool.loss` (MockTrigger; same) |
| 220 | `applyLoss` | a redemption happened | `RedemptionStarted` | `pool.loss` (MockTrigger; same) |
| 237 | `redeem` | re-entered | `ReentrancyGuardReentrantCall` | **uncovered** (the one uncovered branch) |
| 238 | `redeem` | see 363-365 | | see below |
| 239 | `redeem` | supply above expected | `SupplyMismatch` | `pool.redeem` "D4", `security.contracts` SEC-02 |
| 239 | `redeem` | **supply below expected** | `SupplyMismatch` | **uncovered, SEC-15** |
| 241 | `redeem` | zero balance | `NothingToRedeem` | `pool.redeem` |
| 250 | `redeem` | **bond paused** | bond `IsPaused` | **uncovered** (S2 shows the real bond reverts) |
| 250 | `redeem` | **pool lost `ROLE_CONTROLLER`** | bond `AccountHasNoRoles` | **uncovered** |
| 250 | `redeem` | bond not controllable | bond error | **uncovered** |
| 258 | `claim` | re-entered | `ReentrancyGuardReentrantCall` | `pool.reentrancy` "claim" |
| 260 | `claim` | nothing to claim | `NothingToClaim` | `pool.claim` (2 tests) |
| 261 | `claim` | claimant lacks KYC | `NotKycForToken` | `pool.claim` D11 |
| 262 | `claim` | pool lacks KYC | `NotKycForToken` | `pool.claim` D17, `security.contracts` SEC-04 |
| 266 | `claim` | frozen claimant | empty revert | `pool.claim` "frozen claimant" |
| 266 | `claim` | **frozen pool** | empty revert | **uncovered** |
| 266 | `claim` | token returns false | `SafeERC20FailedOperation` | **uncovered** (S3: HTS reverts instead) |
| 275 | `sweepExcess` | see 363-365 | | see below |
| 276 | `sweepExcess` | supply above expected | `SupplyMismatch` | `pool.sweep`, `security.contracts` |
| 276 | `sweepExcess` | **supply below expected** | `SupplyMismatch` | **uncovered, SEC-15** |
| 290 | `sweepDust` | see 363-365 | | see below |
| 292 | `sweepDust` | supply not 0 | `SupplyNotZero` | `pool.sweep`, `security.contracts` |
| 346 | `_requireKyc` | code not 22 | `HtsCallFailed` | `pool.fund`, `pool.claim` |
| 347 | `_requireKyc` | no KYC | `NotKycForToken` | as above |
| 355 | `_checkSupply` | supply differs | `SupplyMismatch` | as above |
| 363 | `_requireRedemptionOpen` | no trigger | `NotInitialized` | `pool.redeem`, `pool.sweep` (both sweeps) |
| 364 | `_requireRedemptionOpen` | `now <= deadline` | `RedemptionNotOpen` | `pool.redeem` boundary, `pool.sweep` `sweepExcess` boundary, `trigger.integration`; `sweepDust` exact boundary **uncovered** |
| 365 | `_requireRedemptionOpen` | pending event | `EventPending` | `pool.redeem`, `pool.sweep`, `trigger.integration`, `trigger.pause` |
| 372 | `_pull` | no allowance or balance | empty revert | `pool.fund` "missing allowance" |
| 373 | `_pull` | pool balance falls | Panic 0x11 | **uncovered** (not possible on HTS) |
| 374 | `_pull` | delta differs | `UnexpectedTransferAmount` | `pool.fund`, `pool.invest` |
| 401 | `_accruedIndex` | `SafeCast.toUint64` | unreachable, clamped to `maturity` | n/a |

### 9.2 FaultlineTrigger

| Line | Function | Condition | Reverts | Existing test |
| --- | --- | --- | --- | --- |
| 77-79 | constructor | zero pool, oracle, admin, trustee | `ZeroAddress` | `trigger.setup` (all 4) |
| 80 | constructor | window 0 | `InvalidSchedule` | `trigger.setup` |
| 80 | constructor | window over 30 days | `InvalidSchedule` | `trigger.setup` D17 boundary, `security.contracts` |
| 84-86 | constructor | pool has no code | empty revert | **uncovered** |
| 101 | `submit` | paused | `IsPaused` | `trigger.submit`, `trigger.pause` |
| 102 | `submit` | `now > submissionDeadline()` | `SubmissionClosed` | `trigger.submit` boundary, `trigger.integration` |
| 103-104 | `submit` | bad signature | `InvalidSignature` | `trigger.submit` (wrong signer, changed field, other trigger, other chain, high-s, 64 bytes) |
| 105 | `submit` | `now > att.deadline` | `AttestationExpired` | `trigger.submit` boundary |
| 106-108 | `submit` | `observedAt < riskStart` | `ObservedOutsideRiskPeriod` | `trigger.submit` boundary, `trigger.integration` |
| 106-108 | `submit` | `observedAt > min(now, maturity)` | `ObservedOutsideRiskPeriod` | `trigger.submit` (future, after maturity) |
| 109 | `submit` | wrong terms | `TermsMismatch` | `trigger.submit` |
| 110 | `submit` | loss 0 or above 10000 | `LossOutOfRange` | `trigger.submit` |
| 115 | `submit` | nonce not higher | `StaleRevision` | `trigger.revision` |
| 115 | `submit` | `usgsUpdatedAt` not newer | `StaleRevision` | `trigger.revision` |
| 117 | `submit` | terminal status | `EventFinalised` | `trigger.revision` (Vetoed, Executed, Superseded); `trigger.submit` order; **real tx on testnet (Vetoed)** |
| 119 | `submit` | new event at L = 10000 | `FullyWrittenDown` | `trigger.submit` |
| 119 | `submit` | **revision of a pending event at L = 10000** | `FullyWrittenDown` | **uncovered scenario** (same line, other state) |
| 150 | `veto` | no `TRUSTEE_ROLE` | `AccessControlUnauthorizedAccount` | `trigger.pause` (admin, oracle, other) |
| 151 | `veto` | not pending | `NotPending` | `trigger.pause`, `trigger.execute` |
| 152 | `veto` | `effective >= end` | `WindowClosed` | `trigger.pause` boundary |
| 162 | `execute` | paused | `IsPaused` | `trigger.pause`; simulated on testnet |
| 163 | `execute` | not pending | `NotPending` | `trigger.execute`, `security.contracts` |
| 165 | `execute` | `effective < end` | `WindowOpen` | `trigger.pause`, `trigger.revision` boundary |
| 176 | `execute` | pool rejects: trigger not wired as `pool.trigger` | `OnlyTrigger` bubbled | **uncovered** (deploy-order mistake; would freeze the event) |
| 183 | `pause` | no `TRUSTEE_ROLE` | `AccessControlUnauthorizedAccount` | `trigger.pause` |
| 184 | `pause` | already paused | `IsPaused` | `trigger.pause` |
| 191 | `unpause` | not admin | `AccessControlUnauthorizedAccount` | `trigger.pause` |
| 192 | `unpause` | not paused | `NotPaused` | `trigger.pause` |
| 201 | `setOracle` | not admin | `AccessControlUnauthorizedAccount` | `trigger.execute` |
| 202 | `setOracle` | zero | `ZeroAddress` | `trigger.execute` |
| 186, 193, 211, 219 | clocks | `SafeCast.toUint64(block.timestamp)` | unreachable: a timestamp cannot exceed uint64 | n/a |

Every custom error in both interfaces is raised by the code and named by at least one test. The code uses custom errors
only: there is no `require`, `assert` or string `revert` in either contract. ABI decoding failures (a `uint16` field with
high bits set in raw calldata) are **uncovered** for both contracts.

### 9.3 Access control

| Guard | Applies to | Test | Status |
| --- | --- | --- | --- |
| `onlyRole(DEFAULT_ADMIN_ROLE)` (pool) | `initialize` | `pool.setup` | PASS — LOCAL; real admin tx on testnet |
| `msg.sender != sponsor` | `fundCoupons` | `pool.fund` | PASS — LOCAL |
| `msg.sender != trigger` | `applyLoss` | `pool.loss` | PASS — LOCAL |
| `nonReentrant` | `fundCoupons`, `invest`, `claim` | `pool.reentrancy` | PASS — LOCAL |
| `nonReentrant` | `redeem` | none | **uncovered** |
| none, by design | `sweepExcess`, `sweepDust` | `pool.sweep` "anyone" | PASS — LOCAL |
| `onlyRole(TRUSTEE_ROLE)` | `veto`, `pause` | `trigger.pause` | PASS — LOCAL; real trustee txs |
| `onlyRole(DEFAULT_ADMIN_ROLE)` (trigger) | `unpause`, `setOracle` | `trigger.pause`, `trigger.execute` | PASS — LOCAL; `unpause` real, `setOracle` never on testnet |
| `TRUSTEE_ROLE` self-admin | `grantRole`, `revokeRole` | `trigger.setup`, `security.contracts` | PASS — LOCAL; refused admin call simulated only |
| Inherited on pool | `grantRole`, `revokeRole`, `renounceRole` | none | **uncovered** (pool admin has no power after `initialize`) |
| `AccessControlBadConfirmation` | `renounceRole` both contracts | none | **uncovered** |
| Last trustee leaves | `renounceRole` | `trigger.setup` shows it works; consequence not asserted | partial |

### 9.4 Deadline and boundary comparisons

| Line | Comparison | Operator | Passing edge | Failing edge | Tested at both edges |
| --- | --- | --- | --- | --- | --- |
| Pool 130 | `issuanceStart`, `issuanceEnd` | `>=` reverts | start < end | start == end | yes |
| Pool 130 | `issuanceEnd`, `riskStart` | `>` reverts | end == riskStart | end > riskStart | yes |
| Pool 130 | `riskStart`, `maturity` | `>=` reverts | riskStart < maturity | equal | yes |
| Pool 131 | `grace`, `365 days` | `>` reverts | == 365 d | + 1 s | yes |
| Pool 173 | `now`, `issuanceEnd` (fund) | `>=` reverts | end - 1 | end | yes |
| Pool 191 | `now`, `issuanceStart` | `<` reverts | start | start - 1 | yes |
| Pool 192 | `now`, `issuanceEnd` (invest) | `>=` reverts | end - 1 | end | yes |
| Pool 193 | `units`, `minTicket` | `<` reverts | == ticket | ticket - 1 | yes |
| Pool 195 | `issued + units`, `cap` | `>` reverts | == cap | cap + 1 | yes |
| Pool 216 | `now`, `riskStart` | `<` reverts | riskStart | riskStart - 1 | yes |
| Pool 217 | `cumulativeBps`, 10000 | `>` reverts | 10000 | 10001 | yes |
| Pool 219 | `cumulativeBps`, `L` | `<=` reverts | L + 1 | equal and lower | yes |
| Pool 364 | `now`, `submissionDeadline()` | `<=` reverts | D + 1 | D | `redeem` and `sweepExcess` yes (MockTrigger). `sweepDust` no. Real trigger: D + 1 only |
| Pool 402 | `t`, `lastAccrual` | `<=` returns | n/a | n/a | through accrual tests |
| Trigger 80 | window, 30 days | `>` reverts | 30 d | + 1 s | yes |
| Trigger 102 | `now`, `submissionDeadline()` | `>` reverts | D | D + 1 | yes |
| Trigger 105 | `now`, `att.deadline` | `>` reverts | deadline | + 1 | yes |
| Trigger 106 | `observedAt`, `riskStart` | `<` reverts | riskStart | - 1 | yes |
| Trigger 106 | `observedAt`, `min(now, maturity)` | `>` reverts | == now, == maturity | + 1 | yes |
| Trigger 110 | `lossBps` | `== 0`, `>` | 1, 10000 | 0, 10001 | yes |
| Trigger 115 | nonce, `usgsUpdatedAt` | `<=` reverts | higher | equal and lower | yes |
| Trigger 119 | `L`, 10000 | `>=` reverts | below 10000 | 10000 | new event only |
| Trigger 152 | effective, window end (veto) | `>=` reverts | end - 1 | end | yes |
| Trigger 165 | effective, window end (execute) | `<` reverts | end | end - 1 | yes |
| Trigger 169 | `L`, 10000 (Superseded) | `>=` branches | n/a | n/a | yes |

The pairs are consistent. Submit is allowed at D and redemption opens at D + 1. Veto ends at the moment execute opens.

---

## 10. Hygiene

| Check | Result | Status |
| --- | --- | --- |
| `.gitignore` rules for env files (`.env`, `.env.*`, keeping `.env.example`) | present in the root file; also `.env*` in `web/.gitignore` | PASS — STATIC |
| Rules for `*.pem`, `*.key`, `keystore*/`, `**/keystore.json`, `*.vc` | `git check-ignore` confirms | PASS — STATIC |
| Build output: `artifacts/`, `cache/`, `coverage/`, `coverage.json`, `typechain-types/`, `.next/`, `oracle/out/`, `oracle/.hcs-mock/`, `oracle/dist/` | ignored; 0 tracked files under them | PASS — STATIC |
| Tracked secret-like files | only `.env.example`, which holds no key | PASS — STATIC |
| Key assignments with 64 hex characters in tracked files | none | PASS — STATIC |
| Secret-name assignments | `oracle/test/keys.test.ts:30`, `:32`: a deliberately malformed dummy string | PASS — REVIEWED, not a secret |
| PEM blocks or mnemonics | `oracle/src/keys.ts:12`: Hardhat's public test mnemonic, refused off chain 31337 | PASS — REVIEWED, not a secret |
| Vendor token patterns | none | PASS — STATIC |
| `gitleaks git` | 112 and 27 commits, no leaks | PASS — STATIC |

No `.env` file was opened. A session hook blocked one command that merely named `.env` in a probe list; the rule check above
was then made from `.gitignore` and `git ls-files`, without touching such a file.
