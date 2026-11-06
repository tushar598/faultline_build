# Security review (HANDOVER §10 step 8) — self-review, not an audit

Date 2026-10-27 (owner decisions and fixes the same day, §3). Reviewer: Claude (the same model family that wrote the code; this is **not** an independent audit).
No testnet transaction was sent. Contracts and interfaces were **not changed**; every contract finding below is
**open — owner decision**. **Update 2026-10-31:** the later test assessment found one High this review missed, SEC-15 (a
holder's own ATS burn locked redemption), fixed by D18, and found SEC-19 to SEC-21. Current list:
`docs/SECURITY-TEST-REPORT.md`. Where this document says the guard needs equality, read D18: it reverts only above the books. Non-design fixes in the oracle, web and scripts are listed separately.

## 1. Scope

| Repo | Commit reviewed | What |
| --- | --- | --- |
| `faultline` | `cc31319` | `contracts/` (FaultlinePool, FaultlineTrigger, interfaces; mocks only where they could hide a bug), `shared/ts`, `oracle/src`, `web/src`, `scripts/` |
| `~/Desktop/faultline-spikes` | `786c431` | `scripts/lib`, `scripts/smoke`, `scripts/s7` (EXECUTE gating, key handling, what is written to `out/`) |

Read first: HANDOVER §7, §9, §15; ARCHITECTURE §3–§6, §8, §9, §12 (D1–D16), §6.6; LESSONS; README trust notes;
TESTNET-EVIDENCE.

## 2. Tools

| Tool | Version | Command | Result |
| --- | --- | --- | --- |
| Slither | slither-analyzer 0.11.4, crytic-compile 0.3.11 (Python venv) | `slither . --hardhat-ignore-compile --filter-paths node_modules` | 41 detector hits, **no true positive in FaultlinePool / FaultlineTrigger** (triage below) |
| solidity-coverage | 0.8.17 | `npm run coverage` | FaultlinePool lines 100 %, **branches 95/96** (after D17: 97/98, same uncovered branch); FaultlineTrigger 100 % everywhere (after D17: 74/74 branches) |
| npm audit | npm 11.13.0 | `npm audit --omit=dev` in `.`, `oracle/`, `web/` | root 0, web 0, **oracle 11 (1 critical, 3 high, 7 low), all through `@hashgraph/sdk` 2.81.0** → SEC-09 |
| gitleaks | 8.30.1 (Homebrew) | `gitleaks git <repo>` and `gitleaks dir <repo>` for both repos | **history of both repos: no leaks**. Working tree: 12 hits, all in `web/.next/` (Next.js generated preview/encryption ids; build output, gitignored, never committed) |

### 2.1 Slither triage (contracts outside `mocks/`)

| Detector | Where | Verdict | Reason |
| --- | --- | --- | --- |
| reentrancy-no-eth (2), reentrancy-benign (2) | `FaultlinePool` `invest`, `claim`, `fundCoupons` | false positive | the "external call" is the HTS system contract `0x167` `isKyc` (a precompile, no callback); all three are `nonReentrant` (`FaultlinePool.sol:169,187,255`) |
| reentrancy-events | `initialize` (`:162-164`), `FaultlineTrigger.execute` (`:172-173`) | false positive | event after a call to the stablecoin's HIP-719 `associate()` / the trusted pool; status and `pendingCount` are final before the call |
| unused-return | `FaultlineTrigger.submit` `tryRecoverCalldata` (`:99`) | false positive | the ignored third value is the error argument; `err` itself is checked on `:100` |
| incorrect-equality | `redeem` `units == 0` (`:239`) | false positive | exact zero balance is the intended check |
| timestamp (11) | schedule, window, accrual | accepted by design | Hedera `block.timestamp` is the consensus time; every rule is time-based on purpose |
| naming-convention (2), cyclomatic-complexity (1), unindexed-event-address (1) | interfaces, `submit` | informational | `TRUSTEE_ROLE` / `ATTESTATION_TYPEHASH` are constants; `submit` is a checklist by design |

Mock hits (`MockVariants`, `MockBond`, `RawCaller`, `MockTrigger`, `MockUSD`: low-level calls, zero checks, naming,
benign reentrancy in the deliberately re-entrant token) are test-only. None could hide a real bug: the re-entrant token
is what proves the guards (test/pool.reentrancy.test.ts), and MockBond's `test_adjustBalance` is the D4 attack itself.

### 2.2 Coverage gap

The one uncovered pool branch is the "already entered" side of `nonReentrant` on `redeem()` (`FaultlinePool.sol:235`,
`:237` after D17).
Reaching it needs a bond whose `controllerRedeem` calls back into the pool; the re-entrant mock re-enters through the
stablecoin only (fundCoupons, invest, claim are covered). `redeem` uses the same OpenZeppelin modifier and follows CEI
(state written before `controllerRedeem`, `:244-248`), so the risk is low; a re-entrant MockBond variant would close it.

### 2.3 npm audit

- **oracle (production)**: `@hashgraph/sdk@2.81.0` → `protobufjs` 7.5.4 / 8.0.0 (GHSA-xq3m-2v4x-88gg, critical: code
  execution when *parsing attacker-supplied schema definitions*), `@grpc/grpc-js` 1.12.6 (crash on malformed
  messages), `elliptic` 6.6.1 via `@ethersproject/*` 5.x. npm's suggested "fix" is a downgrade of the SDK. → SEC-09.
- **root (dev only)**: 41 (Hardhat 2 toolchain, solidity-coverage, gas reporter, mocha): never shipped, never handles keys.
- **web**: 0 (production and dev). Direct dependencies pinned; `tailwindcss`, `eslint`, `typescript`, `@types/*`
  use caret ranges in `package.json` (lockfile pins them; dev-only).

### 2.4 Secrets and ignore rules

- `faultline/.gitignore` covers `.env*`, `*.pem`, `*.key`, `keystore*/`, `**/keystore.json`, `*.vc`, `oracle/out/`,
  `oracle/.hcs-mock/`, `oracle/config.local.json`, `oracle/terms/local.json`, `.next/`, `web/out/`.
- `faultline-spikes/.gitignore` covers `.env*`, `*.key`, `*.pem`, `*.vc`, `out/`; keystore patterns added (SEC-13).
- The only mnemonic in the code is Hardhat's public test mnemonic (`oracle/src/keys.ts:12`), refused on every chain
  except 31337 (`keys.ts:48-58`).

## 3. Findings

Severity: Critical / High / Medium / Low / Info. "Open" = needs an owner decision (contract or design change).

| ID | Sev. | Component | Location | Description | Impact | PoC | Proposed fix | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | Medium | FaultlineTrigger | `FaultlineTrigger.sol:85-86, 197-201`; OZ `AccessControl` (DEFAULT_ADMIN is TRUSTEE_ROLE's admin) | The trigger admin alone can revoke the trustee, rotate the oracle to its own key, submit a 10,000 bps attestation and execute it after one window. The trustee's veto is not independent of the admin. | All collateral moves to the sponsor (holders lose 100 %) within one challenge window, with one key. README/ARCHITECTURE §9 describe the admin only as "unpause and rotate the oracle". | `test/security.contracts.test.ts` SEC-01 (now a regression test) | (a) make TRUSTEE_ROLE self-administered (`_setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE)`), so the admin cannot remove the veto; and/or (b) a delay ≥ `challengeWindow` on `setOracle` and role changes; (c) admin and trustee as separate multisigs in production. At minimum: a README trust line (§5). | **fixed (D17):** `_setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE)`; local deploy adds a backup trustee |
| SEC-02 | Medium | FaultlinePool (D4) + ATS bond admin | `FaultlinePool.sol:236-237, 271-272, 348-352` | One foreign mint or ATS balance adjustment (bond `DEFAULT_ADMIN_ROLE` re-grants `ROLE_ISSUER` / `ROLE_ADJUSTMENT_BALANCE`) makes `redeem` and `sweepExcess` revert `SupplyMismatch` for every holder; `sweepDust` needs supply 0. No recovery path unless the foreign units are burned again. | Collateral and coupon reserve locked for as long as the attacker keeps the foreign units (D4 chose "stop" over "drain"; nothing is stolen). | SEC-02 test (accepted behaviour) | Accept and document (D4 as designed), or add an owner-approved recovery path (e.g. redeem by `min(balance, holder's pro-rata of unitsIssued − unitsRedeemed)`, or a time-locked admin "freeze foreign units" mode). Contract change. | **accepted (D4)**, documented in README and ARCHITECTURE §9; production bond admin = multisig or timelock |
| SEC-03 | Low | Both constructors | `FaultlineTrigger.sol:77, 160, 148, 214-216`; `FaultlinePool.sol:127-131` | `challengeWindow` and `grace` have no upper bound. With a window near 2^64 `windowStart + challengeWindow` overflows: the event can never be vetoed or executed (panic 0x11), `pendingCount` stays > 0 and redemption never opens. A huge `grace` makes `submissionDeadline()` overflow (submit and redeem revert). | Deploy-time misconfiguration bricks the bond permanently. Not reachable after deploy. | SEC-03 regression + boundary tests in `test/{trigger,pool}.setup.test.ts` | Bounds in the constructors (e.g. window ≤ 30 days, grace ≤ 365 days) **or**, without a contract change, a bound check in every deploy script next to `assertReplayAllowed`. | **fixed (D17):** window ≤ 30 days, grace ≤ 365 days, `InvalidSchedule` otherwise |
| SEC-04 | Low | FaultlinePool (D11) | `FaultlinePool.sol:255-263` | `claim()` pre-checks only the recipient's stablecoin KYC. If the stablecoin's KYC key revokes the **pool's** KYC (or freezes the pool), every claim fails with the facade's empty revert; `invest`/`fundCoupons` report `NotKycForToken(pool)`, `claim` does not. | Every payout stuck until the token admin restores KYC (stated trust in "stablecoin admin keys"), and users see no reason. | SEC-04 regression + `test/pool.claim.test.ts` | Add `_requireKyc(address(this))` in `claim` (one more `isKyc` call, ~25k gas). Extends D11's list → owner decision. Document in README either way. | **fixed (D17)** |
| SEC-05 | Info | Docs vs code (D2) | `FaultlinePool.sol:354-355` comment; HANDOVER §15 D2 / ARCHITECTURE §12 D2 "never while paused" | A pause that **starts after** the submission deadline does not close redemption (ARCHITECTURE §4.2 says so; `test/trigger.integration.test.ts` "a pause after the deadline does not block redeem"). The pool comment and the short D2 wording say redemption is closed "while paused". | Wrong expectation for readers; behaviour is correct and safe (submissions stay closed). | existing integration test | Reword: "never while a pause that began before the deadline is running". Contract comment needs the owner's OK to touch the file. | **fixed** (pool comment, HANDOVER §15, ARCHITECTURE §2/§12, README) |
| SEC-06 | Info | FaultlineTrigger | `FaultlineTrigger.sol:108-130` | A revision (higher nonce, newer `usgsUpdatedAt`) is accepted after the window has completed but before anyone executes, and restarts the window. Whoever lands first (execute by anyone, or the revision) wins. | Finality is "the first execute after the window", not "the end of the window". Matches §4.3 (revisions allowed while Pending); with an honest oracle a revision only follows a real USGS change. | `it` "SEC-06 characterisation" (passes) | Keep; have the keeper execute promptly; state it in the README finality note. | **accepted**, README + ARCHITECTURE §9 |
| SEC-07 | Info | FaultlinePool (D3) | `FaultlinePool.sol:270-292` | Units held by an address that never redeems (lost key, a contract) keep their owed value in the pool forever and block `sweepDust`. `sweepExcess` releases everything else. | Accepted by D3. | — | None. | accepted (D3) |
| SEC-08 | Medium | Oracle (D8) | `oracle/src/service.ts:48-55` (before the fix) | D8 identity relied on the local ledger file only. If the ledger is lost (fresh machine for step 9, deleted `out/`) and USGS has changed the preferred id of a quake the trigger already knows, the oracle attested it as a **new** eventId; D1 adds both losses. | Double write-down of one quake unless the trustee vetoes in time. | `oracle/test/security.identity.test.ts`; `npm run oracle:e2e:local` scenario 4 (fails without the fix: "synthetic-kutch-2b → submit-new") | Before treating a record as new, check `eventIdOf(id)` on chain for **every** id in `properties.ids`; any known one is the event, two are a conflict (refuse). | **fixed** (non-design: strengthens D8) |
| SEC-09 | Medium | Oracle dependencies | `oracle/package.json` (`@hashgraph/sdk` 2.81.0) | Transitive `protobufjs` (critical advisory), `@grpc/grpc-js` (high), `elliptic` (low) in the process that holds the relayer and oracle keys during step 9. The SDK uses compiled protos and talks only to Hedera nodes over TLS, so the critical advisory's precondition (attacker-supplied schemas) is unlikely to be met. | Supply-chain exposure of the key-holding process. | `npm audit --omit=dev` in `oracle/` | `overrides` for `protobufjs` ≥ 7.5.5 / ≥ 8.0.1 and `@grpc/grpc-js` ≥ 1.12.7 (or a newer SDK), then re-run spike S7 before step 9. Not applied: it changes the HCS path right before the testnet demo. | **fixed:** `@hashgraph/sdk` 2.81.0 is the latest (2026-03-13), so `overrides` pin `protobufjs` 7.6.6 / 8.6.6 and `@grpc/grpc-js` 1.13.7; `npm audit --omit=dev` 11 (1 critical, 3 high, 7 low) → 8 low (`elliptic` ≤ 6.6.1 via `@ethersproject/*` 5.x, no fixed version exists); oracle tests green, offline SDK build/sign/serialise of a TopicMessageSubmit OK; S7 not re-run (first real HCS tx of step 9 verifies) |
| SEC-10 | Low | Web route handlers | `web/src/app/api/local/*`, `web/src/app/api/usgs/[id]/route.ts` | The local-network routes (and the saved-fixture fallback) answered in production builds too (`next start`, a deployed site). Inputs were already validated (`SAFE_ID`, fixed host for USGS, no path separators) and the files are public data. | A deployed dashboard would expose a developer-only surface. | `web/test/security.web.test.ts` | Local routes answer only in `next dev` or with `FAULTLINE_LOCAL_API=1` (the Playwright run sets it); SYNTHETIC fixtures are refused elsewhere. | **fixed** |
| SEC-11 | Low | Web wallet flow | `web/src/state/wallet.tsx` `run()` | Buttons were gated on the wallet's chain at render time, but `run()` did not re-check it. A wallet that switched chain in between would sign the approve/invest for the same address on another chain. | Mis-sent transaction (wrong chain), user funds at the same address elsewhere. | — (UI path; covered by `npm run web:e2e`) | `run()` reads `eth_chainId` before every step and stops with a plain message on a mismatch. | **fixed** |
| SEC-12 | Info | Web `/api/usgs/[id]` | route handler | Anyone can make the server fetch one USGS event (fixed host, id regex, query-encoded: no SSRF). | Request amplification toward USGS if deployed publicly. | — | Cache responses / rate-limit if the dashboard is ever deployed. | open — owner decision |
| SEC-13 | Info | Spikes repo | `faultline-spikes/.gitignore` | No keystore patterns (the Hardhat 3 keystore is global, outside the repo, so nothing leaked). | Safety net only. | gitleaks: clean | Added `keystore*/`, `**/keystore.json` (spikes commit `8de1222`). | **fixed** |
| SEC-14 | Info | Testnet demo profile | ARCHITECTURE §12.1 (60 s window) | On the testnet demo bond a leaked oracle key needs only a 60 s window; the trustee has 60 s to veto. | Demo-only (documented as such); never use the demo profile with value. | — | Keep 60 s for the demo; production 48–72 h (D13). | accepted (demo-only) |

**Count:** Critical 0, High 0, Medium 4 (SEC-01 fixed, SEC-02 accepted, SEC-08 fixed, SEC-09 fixed), Low 4 (SEC-03,
SEC-04, SEC-10, SEC-11 all fixed), Info 6 (SEC-05 fixed, SEC-06/07/14 accepted, SEC-12 open, SEC-13 fixed).

**Owner decisions (2026-10-27)** are recorded as D17 (ARCHITECTURE §12, HANDOVER §15). New consequence of D17 to keep in
mind: the admin can no longer remove a rogue trustee; only another trustee can, and a compromised trustee could revoke
the backup first. Keep the backup trustee key in separate custody (README trust notes).

### 3.1 PoC tests

During the review (`9d08aa2`) every open contract finding had an expected-failure PoC (`openFinding`: asserts the secure
behaviour, passes only on an `AssertionError`). After the owner's decisions the file holds regression tests for SEC-01,
SEC-03, SEC-04 and tests that pin the accepted behaviour of SEC-02 and SEC-06. The oracle and web tests cover SEC-08,
SEC-10.

## 4. Manual checklist (HANDOVER §7), with evidence

| Item | Result |
| --- | --- |
| Reentrancy | `fundCoupons`, `invest`, `redeem`, `claim` are `nonReentrant` (`FaultlinePool.sol:169,187,235,255`; ReentrancyGuardTransient, TSTORE confirmed on Hedera by the smoke run, U7). CEI: `redeem` writes books before `controllerRedeem` (`:244-248`), `claim` zeroes before `safeTransfer` (`:260-262`). `applyLoss` makes no external call; `execute` finalises status and `pendingCount` before `applyLoss` (`FaultlineTrigger.sol:162-172`). Sweeps call only `balanceOf`/`totalSupply`/trigger views. Tested: `test/pool.reentrancy.test.ts`. |
| Access control | Pool: `initialize` admin-only and once (`:156-157`); `fundCoupons` sponsor-only (`:170`); `applyLoss` trigger-only (`:213`); everything else permissionless by design. Pool admin has **no power after `initialize`**. Trigger: `veto`/`pause` TRUSTEE_ROLE, `unpause`/`setOracle` DEFAULT_ADMIN; DEFAULT_ADMIN is also TRUSTEE_ROLE's admin (→ SEC-01). |
| Rounding | Holder principal and coupon floor (`:242-243`, `:300-301`); sponsor credit `floor(U·L/10000)` from the cumulative L, path-independent (`:222-224`); required reserve ceils (`:311`); index increments floor (`:399`). `collateralLeft` cannot underflow: `U − floor(U·L/B) = ceil(U·(B−L)/B) ≥ Σ floor(bᵢ·(B−L)/B)`. Property and invariant tests: `test/pool.loss.test.ts`, `test/e2e.local.test.ts`. |
| Coupon maths / overflow | `rate = (10000 − L) · couponBps · dt` ≤ 1e4 · 65,535 · 2^64 < 2^256; `mulDiv` everywhere; `couponIndex ≤ couponBps·term·1e18/(1e4·YEAR)` (invariant 7). `couponBps` is unbounded up to 65,535 (655 %/year), but the sponsor pre-funds it, so it is a terms choice, not a risk. |
| Loss index | Monotonic and ≤ 10000 (`:215-217`); trigger caps `min(10000, L + lossBps)` (`FaultlineTrigger.sol:171`); `Superseded` at 10000 without revert (`:165-169`). |
| Supply guard D4 bypasses | Foreign mint / upward `adjustBalances` → caught, but locks funds (SEC-02); since D18 a foreign mint up to the amount holders burned is not caught. Forced transfers by a CONTROLLER/AGENT (`controllerTransfer`) do **not** change supply, so D4 cannot see them: a bond admin who grants itself CONTROLLER can move holders' units to itself and redeem them (key-compromise table). Locks/holds/clearing: D9 (never grant those roles); locked units stay outstanding and are covered by `sweepExcess`. ATS recovery moves units, supply unchanged. |
| Unexpected token transfers | Direct HTS transfers to the pool only raise the balance; they go to the sponsor via `sweepExcess`/`sweepDust` (`_surplus`, `:379-382`); `_pull` checks the exact balance delta (`:365-370`). |
| HTS facade / D11 | `isKyc` pre-checks in `fundCoupons`, `invest`, `claim`; gap for the pool's own KYC in `claim` (SEC-04). Freeze is not pre-checked (D11, stated). |
| Hedera specifics | No `payable`, no `receive()` in either contract; no HBAR or tinybar maths; every function O(1), far under 15M gas (smoke run max 2.25M at deploy); `block.timestamp` = consensus time. |
| Signatures | EIP-712 domain `FaultlineTrigger`/`1` with chainId and verifyingContract (OZ `EIP712`, chain-id re-check on forks); `tryRecoverCalldata` rejects high-s and non-65-byte signatures; tested: another trigger, another chain, high-s and 64-byte (`test/trigger.submit.test.ts:46-62`); typehash equals `shared/attestation.eip712.json` (`test/trigger.setup.test.ts:65-71`). Replay: terminal statuses are permanent (`:110-114`). |
| Pause clock | `effectiveTime` and `submissionDeadline` in uint64 with SafeCast; repeated pause/unpause sums correctly; pause after the deadline keeps submissions closed (§4.2; SEC-05 for the wording). Overflow only through constructor values (SEC-03). |
| Front-running | Veto vs execute at the boundary are mutually exclusive (`veto` needs `effective < end`, `execute` needs `≥ end`, `:148`, `:161`). Two relayers submitting the same attestation: the second reverts `StaleRevision` (harmless). Revision racing execute: SEC-06. Invest racing `issuanceEnd`: plain revert. |
| DoS | Only oracle-signed attestations create pending events; revisions are bounded by `submissionDeadline()` + one window; the trustee can veto any of them. A trustee who re-pauses can delay redemption until the admin revokes the role (ARCHITECTURE §9). `sweepExcess`/`sweepDust`/`claim` are idempotent and cannot hurt anyone. |
| Events | Every state change emits: `Initialized`, `CouponsFunded`, `Invested`, `LossApplied`, `Redeemed`, `Claimed`, `ExcessSwept`, `DustSwept`, `AttestationSubmitted`/`AttestationRevised`, `EventVetoed`, `EventExecuted`/`EventSuperseded`, `TriggerPaused`/`TriggerUnpaused`, `OracleRotated`, OZ `RoleGranted`/`RoleRevoked`. |

## 5. Key compromise

| Key leaked | What the attacker can do | What stops it | Time bound | README covers? |
| --- | --- | --- | --- | --- |
| **Oracle signer** | Sign fake events (any lossBps, any number of eventIds inside the terms) and fake revisions of pending events (restart their windows); publish fake HCS messages (it is the topic submit key, D16) | Trustee vetoes each event inside its window; trustee pauses (stops submit and execute, D2); admin `setOracle` + trustee `TopicUpdate` of the submit key (D16) | Trustee must react within one challenge window (48–72 h production; **60 s demo**, SEC-14); new submits stop at `submissionDeadline()` | Partly ("oracle key, bounded by window, veto, pause, rotation"); add the revision-restart and HCS-poisoning lines |
| **Relayer** | Spend its HBAR; stop relaying (liveness) | Cannot sign attestations or HCS messages alone (S7: relayer-only submit → `INVALID_SIGNATURE`); anyone can relay published signatures | Liveness only, until a new relayer is funded | **No** — propose a line |
| **Trustee** | Veto every genuine event inside its window (**permanent**: a vetoed real quake can never be resubmitted, the sponsor loses its protection); pause repeatedly (delays execute and redemption); revoke the backup trustee (D17); as topic admin key delete the HCS topic or rotate its submit key | Since D17 only ANOTHER trustee can revoke it (the admin can only unpause); the chain, not HCS, is the source of truth | Vetoes are irreversible; pauses last until the admin acts | Partly (pause delay); add the permanent-veto and topic-delete lines |
| **Trigger admin** | Rotate the oracle to its own key and submit fake events; unpause at will. Since D17 it can no longer remove or add trustees | The trustee's veto (D17, SEC-01 fixed) | One challenge window per event | Yes (README, D17) |
| Pool admin | Nothing after `initialize` (role has no other function) | — | — | — |
| **Bond `DEFAULT_ADMIN_ROLE` (deployer)** | Re-grant `ROLE_ISSUER` / adjust balances → D4 locks payouts (SEC-02); grant `ROLE_PAUSER` and pause the bond → `mint` and `controllerRedeem` revert (S2) → invest and redeem blocked; grant itself CONTROLLER/AGENT and `controllerTransfer` holders' units to itself, then redeem them (**theft**; D4 cannot see a transfer); revoke the pool's roles → redeem fails | Nothing on chain; only key custody | Any time before holders redeem | Partly (README "Bond roles after setup" covers re-grant and pause); add the forced-transfer theft and the D4 lock |
| **Stablecoin admin / KYC key** | Revoke the pool's KYC or freeze the pool → every claim, invest and fundCoupons fails (SEC-04); revoke or freeze one holder → only that holder; supply key can mint more test fUSD (no effect on pool accounting); no wipe key (cannot drain) | Restoring KYC / unfreezing | As long as the attacker holds the key | Partly ("stablecoin admin keys"); add "can stop every payout" |

**Proposed README trust lines (owner to approve):** (1) the trigger admin can remove the trustee and force a write-down
in one window (SEC-01) unless a fix is chosen; (2) a vetoed event is final even if the quake was real, so a trustee key
is as sensitive as the oracle key; (3) the relayer only pays fees and cannot sign; (4) a bond admin can stop payouts
(D4 lock) or move holders' units by forced transfer; (5) the stablecoin's KYC/freeze keys can stop every payout;
(6) finality is the first execute after the window (SEC-06).

## 6. Oracle, web, scripts (summary)

- **Oracle keys:** env only (`keys.ts:39-60`), never logged (the logger never receives them; errors say "value not
  shown"), Hardhat test keys refused off 31337 (`keys.ts:48-49, 57-58`). Refusal gate: chainId, code, termsHash,
  typehash, signer = `trigger.oracle()`, D14 replay allowlist (`config.ts:108-123`). `hashAttestation` gate and
  signature self-check before anything is published (`attest.ts:24-31`).
- **USGS trust:** TLS to a configured base URL, zod on every field used (`usgs.ts:15-33`), timeouts and bounded retries
  (`:116-141`), malformed search features skipped. A wrong or malicious USGS answer that passes the rule would be
  signed; the stops are the challenge window, the trustee veto and the D15 re-check loop. Response size is not capped
  (Info).
- **Ledger:** atomic temp-file + fsync + rename (`ledger.ts:92-103`); a corrupt file throws (the oracle stops rather
  than guess); a lost file is now recovered from the chain for identity (SEC-08). A lost ledger can still re-publish an
  already published-but-unsent (eventId, nonce) once with a new deadline (duplicate HCS line, no on-chain effect).
- **Web:** no `dangerouslySetInnerHTML`; React escapes every USGS/HCS string; the only `NEXT_PUBLIC_*` is the testnet
  RPC URL; no key ever reaches the browser; every write is the user's wallet with a `staticCall` pre-check, now also a
  chain check (SEC-11); route inputs `^[A-Za-z0-9._-]{1,80}$` (no separators, no scheme), USGS host fixed (SEC-10, SEC-12).
- **Spikes / smoke scripts:** dry run unless `EXECUTE=1` (`scripts/lib/common.ts:48`); keys only from the global Hardhat
  3 keystore, each derived address checked before sending (`scripts/lib/hedera.ts:46-72`); `out/` holds evidence (hashes,
  fees, ids) and is gitignored; gitleaks found nothing in the tree or history.

## 7. Not reviewed (and why)

- ATS v8 facets beyond `docs/reference/ats.md` and the spike results (large third-party codebase; integration verified
  on testnet in S1/S2 and the smoke run).
- The HTS stablecoin's own keys and the Hedera node software; the real `@hashgraph/sdk` HCS path (only unit-tested with
  a stub until step 9).
- Economic soundness of the terms (box, curve, coupon pricing) and USGS data quality itself.
- MetaMask behaviour on Hashio and the testnet read-only dashboard (Hashio answered 502 during step 7).
- Formal verification, fuzzing beyond the existing fast-check properties, gas griefing on Hedera fee markets.
- An independent second reviewer: this review was written by the same model family that wrote the code.
