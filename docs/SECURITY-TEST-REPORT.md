# Security test report

Assessment sessions 2 and 3, 2026-10-30 and 2026-10-31. Branch `test-assessment`. Session 3 applied D18 (the SEC-15 fix), so
`FaultlinePool` now differs from the testnet build: creation keccak `0x78712136…09563f6d`, against `0x13a97433…69957f43` on testnet.
`FaultlineTrigger` is byte-identical (`0x3205b3ca…aa8fcf3`). No testnet transaction was sent in either session.

**State of the testnet evidence: all of it is from build `e617570`, before D18.** The fixed pool is deployed on no chain, a holder
burn was never mined, and a re-run on the fixed build is still to do. Everything about D18 below is mock-tested.

**Labels.** *Mock-tested*: local Hardhat chain with MockBond, MockUSD and MockHTS. *Testnet-simulated*: a read-only mirror-node
`contracts/call` against a real bond, which proves the guard answers but mines nothing. *Testnet-verified*: a mined transaction.
Everything added in this session is mock-tested or testnet-simulated. Severity: P0 = Critical, P1 = High.

## 1. Findings

| ID | Severity | Summary | State |
| --- | --- | --- | --- |
| SEC-15 | **High (P1)** | Any KYC'd holder burned 1 base unit and locked `redeem`, `sweepExcess` and `invest` for everyone. An approved spender or an authorised operator could do the same | **Fixed by D18, mock-tested.** Tests in `test/pool.supplyburn.test.ts`. The burn was never mined; RT-02 mines it on the fixed build |
| SEC-19 | Medium | A pause has no maximum and only the admin ends it. A lost admin key during a pause begun before the deadline locks redemption and both sweeps for ever. A lost admin key with a pending event past its window locks them too, even for a pause begun after the deadline | **Accepted as a trust assumption, no contract change** (owner, 2026-10-31). ARCHITECTURE §9, README. Production needs the admin in a multisig. Characterised in `test/trigger.griefing.test.ts` |
| SEC-20 | Low | The testnet deploy check covered `ROLE_AGENT`, `ROLE_ADJUSTMENT_BALANCE` and `ROLE_PAUSER` only. `ROLE_CORPORATE_ACTION` can schedule a balance adjustment that anyone then triggers, and `ROLE_MATURITY_REDEEMER` can burn | **Fixed in the scripts.** `demo-2-deploy.ts` and `smoke-3-deploy.ts` in the spikes repo now fail on `auditBondRoles`. Not run in a deployment yet; read-only against the real FLDMO bond it returned no problem |
| SEC-21 | Low | D9 ("no hold roles") does not stop holds: a holder creates one with no role and no KYC. Units leave `balanceOf` but stay in `totalSupply`. `redeem` then pays only the free balance and `effectiveValue` shows less. Harm stays with that holder | **Documented, no change** (ARCHITECTURE §9, README) |
| SEC-22 | Info | New. `maturity` has no upper bound, so at 2^64 - 1 `submissionDeadline()` overflows and `submit` and `redeem` panic. The D17 comment says the deadline can never overflow. A deploy-time typo with no live path: a bond maturing in that year never redeems anyway | Open, no action proposed. Pinned in `test/arithmetic.values.test.ts` |
| SEC-16 | Low | Dashboard blocks a valid redemption during a post-deadline pause | Open (RT-15) |
| SEC-17 | Low | `npm run coverage` leaves instrumented artifacts | Open, reproduced again; `npm run compile` repaired it |
| SEC-18 | Info | Documentation drift. New row in section 9: the `SupplyMismatch` NatSpec | Open |
| SEC-12 | Info | Unrated rate limit on `/api/usgs` | Open from the earlier review |

Critical: 0. High: 0 open (SEC-15 fixed, not proven on a real bond). Medium: 1 accepted. Low: 2 open, 2 closed. Informational: 3.
SEC-02, SEC-06 and SEC-07 stay accepted. No new Critical or High came out of tasks 2D, 2E, 2F or 3.

## 2. SEC-15 fix: D18, approved by the owner on 2026-10-31

`_checkSupply` reverts only when `actual > expected`. `isSolvent` uses `min(unitsIssued - unitsRedeemed, bond.totalSupply())`. Nothing
else in the contract changes. Decision record: ARCHITECTURE §12 D18, HANDOVER §15.

With the fix, the 15 SEC-15 pins failed, as predicted, and every other test passed. The pins and the five `[SEC-15 OPEN]` tests are now tests
of the new behaviour.

| Check | Result (mock-tested) |
| --- | --- |
| Foreign mint with no burn | Still reverts `SupplyMismatch`. D4 unchanged |
| Foreign mint above the burned amount | Still reverts |
| Foreign mint up to the burned amount | **Not detected** (downside 1) |
| `redeem` after a burn | Works for the other holders and for the burner's remainder |
| `invest` after a burn | Works. `cap` and `requiredReserve` still count on `unitsIssued`, so they stay conservative |
| `sweepExcess` after a burn | Works. Still reserves the burned units (downside 2) |
| `sweepDust` | Reads real supply and takes everything left once supply is 0 |
| `isSolvent` | True before and after the last claim |
| Burn before, between and after two losses | Every holder paid, pool ends at 0 |
| `unitsIssued - unitsRedeemed` underflow | Not reachable: supply stays at or below expected, and a redeem lowers both by the same amount |

**Accepted downsides.**

1. **A foreign mint up to the burned amount is not detected.** It needs a bond role D4 forbids and the deploy audit checks for.
   Until `sweepDust` the books still reserve those units, so honest holders are paid in full and the cost falls on what the sponsor would
   have swept. **Correction to session 2, which said honest holders are always paid:** after `sweepDust` nothing is reserved. A masked mint
   redeemed then is unbacked, `isSolvent` turns false, and whoever claims last is short, which can be a slow holder that redeemed but has
   not claimed. It stays inside this downside and is not a new High, because the bond admin needed for it can already take
   holders' units by forced transfer (SEC-02). Pinned in `test/pool.supplyburn.test.ts`.
2. **Burned collateral stays reserved until `sweepDust`.** `sweepExcess` counts `unitsIssued - unitsRedeemed`, so if one holder never
   redeems it stays in the pool for good (with SEC-07). Do not switch `sweepExcess` to real supply: after such a sweep a masked foreign
   mint would be paid from honest holders' money.
3. **Invariant 4 weakened** from `==` to `<=`, and to `==` only when nobody burned.
4. **A contract change needs a new deployment.** See the top of this report.

One comment-only change was left out on purpose: updating the NatSpec of `SupplyMismatch` in `IFaultlinePool.sol` changes the trigger's metadata hash, so its
bytecode would stop matching the verified build. See section 9.

## 3. RT-03: ATS holder-surface parity

Source: ATS `v.8.0.0-ats`, every state-changing `external` function in `contracts/facets` (270), checked against `BOND_FACETS`.
54 have no role modifier; the rest are role-gated and appear only where they matter. "Sim" is a read-only simulation on FLDMO at
block 42328936 (A 300, B 200) or on FLSPK inside the S2 pause. **Nothing here was mined.**

| Function (no role) | Sim result | `totalSupply` | `balanceOf` | Blocks `controllerRedeem` | MockBond | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `redeem(uint256,bytes)` | success | **falls** | falls | no | yes | **SEC-15** |
| `redeemByPartition` | success | **falls** | falls | no | yes | **SEC-15** |
| `redeemFrom` | no allowance: `InsufficientAllowance`, also for self and operators | **falls** | falls | no | yes | **SEC-15**, spender needs no KYC. Success path from source |
| `operatorRedeemByPartition` | unauthorised: `InsufficientAllowance`, or `Unauthorized` with an allowance | **falls** | falls | no | yes | **SEC-15**. Success path from source |
| `authorizeOperator`, `authorizeOperatorByPartition`, `revokeOperator*` | success | no | no | no | global form | Hands out the burn lever. No KYC on the operator |
| `approve`, `increaseAllowance`, `decreaseAllowance` | success | no | no | no | `approve` | Same lever through `redeemFrom` |
| ERC-20 `permit` | reachable: bad signature reverts in ECDSA | no | no | no | not modelled | Writes the same allowance as `approve` |
| `transfer`, `transferWithData`, `transferByPartition`, `batchTransfer` | success; non-KYC recipient `InvalidKycStatus` | no | moves | no | `transfer` | Safe: the buyer inherits the claim |
| `transferFrom`, `transferFromWithData`, `operatorTransferByPartition` | no allowance: `InsufficientAllowance` | no | moves | no | `transferFrom` | Safe |
| `createHoldByPartition` | **success, no role, no KYC** | no | **falls** | no | yes | **SEC-21.** Holder-only harm |
| `createHoldFromByPartition`, `operatorCreateHoldByPartition` | no allowance / `Unauthorized` | no | falls | no | not modelled | As above, through a spender |
| `executeHoldByPartition` | source | no | moves | no | yes | A transfer by the escrow; both sides need KYC |
| `releaseHoldByPartition`, `reclaimHoldByPartition` | source | no | rises | no | yes | Returns units to the holder |
| `release`, `releaseByPartition` | source | no | rises | no | no | Need a lock, and locks need `ROLE_LOCKER` |
| `clearing*`, `operatorClearing*`, `clearingCreateHold*`, `reclaimClearing*` | `ClearingIsDisabled` | no | no | no | no | Closed: activation needs `ROLE_CLEARING` |
| `delegate` | success | no | no | no | no | Voting only |
| `triggerPendingScheduledCrossOrderedTasks`, `triggerScheduledCrossOrderedTasks`, `triggerAndSyncAll` | success, nothing queued | only with a queued adjustment | same | no | no | **SEC-20**: a role queues it, anyone fires it |
| `renounceRole` | `CannotRenounceSoleAdmin` | no | no | no | no | New angle on SEC-02, section 4 |
| `applyRoles` | `AccountHasNoRole` | no | no | no | no | Gated inside the body |
| `forceReleaseByPartition` | source | no | no | no | no | Gated inside the body (`ROLE_LOCKER` or `ROLE_CONTROLLER`) |

Role-gated, simulated as refused for a holder: `burn`, `batchBurn`, `controllerRedeem`, `mint`, `lock`, `transferAndLock`,
`fullRedeemAtMaturity`, `setAddressFrozen`, `activateClearing`, `protectPartitions`, `adjustBalances`,
`setScheduledBalanceAdjustment`, `pause`.

**Findings from the table.**

- No holder call can stop `controllerRedeem` for **another** holder, and none raises the supply.
- Every holder-reachable supply decrease goes through the same `ERC1410StorageWrapper.redeemByPartition`, so the SEC-15 fix covers all four paths.
- **`redeem` has no `onlyUnpaused` modifier, yet it reverts `IsPaused`.** ATS reaches the check later, in `triggerAndSyncAll`. So on a paused bond
  compliance errors win: stranger `InvalidKycStatus`, over balance `InsufficientBalance`, and only then `IsPaused` (simulated at FLSPK block 42232780, inside
  the S2 pause). MockBond copies that order. A bond pause would stop the burn, but it also blocks the pool's `controllerRedeem`, so it is no defence.
- `balanceOf` is the free balance: holds, locks, clearing and frozen units sit outside it, while `totalSupply` keeps them. Sum of `balanceOf` is not `totalSupply` once a hold exists.

## 4. Task 2A: deployer's `DEFAULT_ADMIN_ROLE`

SEC-02 stays accepted, and spike S2 already proved on testnet that a paused bond reverts `controllerRedeem` and `mint` with `IsPaused()`: that evidence stands and
was not repeated. SEC-01 is fixed by D17 and stays a regression in `test/security.contracts.test.ts`.

Added: `scripts/lib/bondAudit.ts`. `auditBondRoles` fails a deploy if anyone but the pool holds `ROLE_ISSUER` or `ROLE_CONTROLLER`, or anyone holds one of nine
forbidden roles; `scripts/lib/e2e.ts` now runs it. `handOverBondAdmin` moves the admin role in two steps. Tested in `test/deploy.bondaudit.test.ts`, mock-tested.
The testnet deploy scripts in `faultline-spikes` now call it (SEC-20, commit `b527729` there), through the same module.

New angles:

- The deployer **cannot simply renounce**: ATS reverts `CannotRenounceSoleAdmin` (simulated). The handover must grant first, then revoke.
- `ROLE_CORPORATE_ACTION`, `ROLE_MATURITY_REDEEMER` and `ROLE_TREX_OWNER` can each reach the supply or the burn path, and the demo's check did not cover them (SEC-20).

## 5. Task 2B: attestation binding

`test/attestation.binding.test.ts`. Coordinates and the zone are not signed fields, so there is no tamper test on them.

- All nine signed fields: changing any one reverts `InvalidSignature` before any other check.
- `dataHash` changes with 0.001 degree of latitude or longitude, 1 km of depth, magnitude, status and update time; volatile fields do not move it.
- `termsHash` changes with the box, curve floor and ceiling, depth limit, cooling period and magnitude types, and a correctly signed attestation on other terms reverts `TermsMismatch`.
- **Limit, pinned by a test:** the chain cannot read the record. An oracle-signed wrong `dataHash` is accepted, stored and emitted. Anyone re-hashing the USGS record sees the
  mismatch, and the defence is the public record, the window and the veto.

## 6. Task 2C: re-entrancy (mock-only)

**None of this can happen on real HTS:** the facade has no transfer hook (S3). On a real ATS bond the only outward call in `controllerRedeem` and `mint` is the ERC-3643
compliance contract, which Faultline leaves at the zero address; reaching it needs `ROLE_TREX_OWNER`, which the audit now forbids.

`MockReentrantBond` (test-only) calls back before and after the balance change. `redeem`, `claim` and `invest` stop with `ReentrancyGuardReentrantCall`, which closes the last
uncovered pool branch. `sweepExcess` and `sweepDust` have no guard: before the burn the supply guard stops `sweepExcess`; after the burn state is final, so both credit only the
true surplus and every holder stays covered.

## 7. Coverage matrix

| Item | Severity | Test | Result | Environment |
| --- | --- | --- | --- | --- |
| RT-01 | High | `test/pool.supplyburn.test.ts` | fixed by D18, no open test left | mock-tested |
| RT-02 | High | `scripts/demo/rt02-holder-burn.ts` (spikes) | written, **not run** | not on any chain |
| RT-03 | High | `test/bond.holdersurface.test.ts`, section 3 | done | mock-tested + testnet-simulated |
| RT-04 | Medium | `test/pool.bondstate.test.ts` | pass | mock-tested |
| RT-05 | Medium | `test/pool.reentrancy.test.ts` | pass, pool branches 98/98 | mock-only |
| RT-06 | Medium | `test/invariants.fuzz.test.ts` | pass, section 13 | mock-tested |
| RT-07 | Medium | `test/trigger.griefing.test.ts` | characterised, SEC-19 accepted | mock-tested |
| RT-08 | Medium | `test/trigger.revision.test.ts` | pass | mock-tested |
| RT-09, RT-10 | Medium | `test/trigger.integration.test.ts` | pass | mock-tested |
| RT-14 | Medium | `web/test/gas.test.ts`, `oracle/test/config.test.ts`, `test/security.contracts.test.ts`, `test/pool.sweep.test.ts` | pass; gas and type-hash tests each failed once against a broken build, by hand | mock-tested |
| RT-17 | Low | `test/pool.claim.test.ts`, `test/pool.invest.test.ts` | pass | mock-tested |
| RT-18 | Low | `test/edge.values.test.ts` | pass | mock-tested |
| RT-19 | Low | `test/roles.test.ts` | pass | mock-tested |
| RT-20 | Low | `4a0ac09` retries `evm_setIntervalMining` after `ECONNRESET` | likely cause fixed; `web:e2e` passed once since, the ten-run check is not done | local |
| Task 2D | n/a | `test/arithmetic.values.test.ts` | pass, section 10 | mock-tested |
| Task 2E | n/a | `test/pause.emergency.test.ts` | pass, section 11 | mock-tested |
| Task 2F | n/a | `test/dos.gas.test.ts` | pass, section 12 | mock-tested |
| Sign in, Sign out (`b2f240b`) | n/a | `web/test/walletSession.test.ts`, Playwright | pass; revoking on a real wallet is untested | local, test wallet |

RT-14 also found that the "conditional claim" in `pool.sweep` never ran: `sweepExcess` already takes the dust, so the test now asserts 0.
Not done: RT-02 and RT-11 (need a mined transaction, owner only), RT-12, RT-13, RT-15, RT-16, the ten-run part of RT-20, and session 4.

## 8. Mutation and gas

**Mutation (hand-picked, not a full tool run).** Equivalent mutants were left out by hand, so neither set is a mutation score for the whole code. RT-24 stays open for a tool run.

| Set | Build | Test set | Killed | Survived |
| --- | --- | --- | --- | --- |
| Session 2, 56 mutants | D17 | Session 1 (203 tests) | 54 | `actual != expected` → `actual > expected`; `nonReentrant` removed from `redeem` |
| Session 2, 56 mutants | D17 | Session 2 | **56** | 0 |
| Session 3, 25 mutants | D18 | Deterministic tests, without the fuzz | **25** | 0 |
| Session 3, 25 mutants | D18 | Fuzz alone, up to 300 sequences | **23** | 2, both by design: a loosened mint guard (no foreign mints in the sequences), `RedemptionStarted` removed (not reachable through the real trigger) |

Both session 2 survivors were exactly SEC-15 and RT-05, which shows why 100 % trigger branch coverage did not catch SEC-15. The first session 3 fuzz let nine mutants through, seven of them real gaps: it rarely hit one-second edges, finalised-event replays or a pause inside a window. So it gained
edge operations, a forced signature replay, pause cycles and an edge check at settlement, and those seven are now killed; the hardest took 149 sequences, which the default
8-sequence `npm test` run would miss, so one-second edges rest on the deterministic tests there. All mutants ran on a throwaway copy outside the repo; the unmutated control passed every test.

**Coverage** (`npm run coverage`, then `npm run compile` for SEC-17, session 3, 420 tests): `FaultlinePool` branches 98/98, statements 103/103, functions 23/23, lines 135/135;
`FaultlineTrigger` branches 74/74, statements 55/55, functions 14/14, lines 84/84.
These numbers are on mocks and say nothing about real ATS.

**Gas** (`npm run test:gas`, local Hardhat EVM with MockBond). Compare with the mined numbers in `docs/TESTNET-EVIDENCE.md` for real costs; Hedera differs.

| Function | Min | Max |
| --- | --- | --- |
| `pool.fundCoupons` | 74,303 | 117,841 |
| `pool.invest` | 107,957 | 180,602 |
| `pool.redeem` | 86,770 | 283,859 |
| `pool.claim` | 46,235 | 84,041 |
| `pool.sweepExcess` | 56,685 | 123,176 |
| `pool.sweepDust` | 48,238 | 90,625 |
| `trigger.submit` | 64,565 | 137,626 |
| `trigger.execute` | 41,223 | 147,546 |
| `trigger.veto` | 38,168 | 42,968 |

Property tests log their seed: `test/pool.supplyburn.test.ts` and `test/invariants.fuzz.test.ts` print `fast-check seed`, and `FC_SEED` with `FC_RUNS` replays it.

## 9. Findings moved from session 1


#### SEC-15 — High — any holder can lock redemption for everyone, without a role

**Fixed by D18 on 2026-10-31, section 2.** The text below is the session 1 finding, kept as written. It describes the code before D18.

**Component:** `FaultlinePool._checkSupply` (D4, `FaultlinePool.sol:352-356`) with ATS v8 `Burn.redeem`
(`packages/ats/contracts/contracts/facets/burn/Burn.sol:50-66`, tag `v.8.0.0-ats`).

**What happens.** ATS v8 lets a KYC'd holder burn its own units with `redeem(uint256,bytes)` or
`redeemByPartition(bytes32,uint256,bytes)`. Neither needs a role. The pool requires `bond.totalSupply() == unitsIssued -
unitsRedeemed` in `invest`, `redeem` and `sweepExcess`, and it uses strict `!=`. One burned base unit makes all three revert
`SupplyMismatch` for every holder, for good. Principal and coupons stay locked, and so does the sponsor's unused reserve.
`sweepDust` also stays closed because supply is not zero. Write-down credits already in `claimable` can still be claimed.

**Why it was missed.** SEC-02 and the README treat this as a bond-admin power (a foreign mint or balance adjustment), and D4
was designed against supply going **up**. `MockBond` has no holder `redeem`, and no test lowers the supply before a pool
call, so all 338 tests pass with 100 % trigger branch coverage. SEC-02's test burns only to *undo* a foreign mint.

**Cost and recovery.** Cost is 1 base unit (0.000001 USD) plus gas. The attacker needs only a minimum ticket. The only
recovery is out of band: the bond admin grants itself `ROLE_ISSUER` and mints the missing units, which is what D4 assumes
never happens, and the attacker can repeat the burn. Nothing is stolen.

**Proof (read-only, no transaction).** Historical simulation on the **real Faultline demo bond** FLDMO at block 42328936
(2026-10-27 19:09:56 UTC). The pool held `ROLE_CONTROLLER`, A held 300 units and B held 200:

```bash
curl -s -X POST https://testnet.mirrornode.hedera.com/api/v1/contracts/call -H 'content-type: application/json' -d '{
  "block":"0x285e368","estimate":false,"gas":500000,"gasPrice":0,"value":0,
  "from":"0x6d35b49d61045837Cb7F7a161c2712B68E4Fd145","to":"0xF227eF78813e5058C8B7Bfccfc86dAF22087473e",
  "data":"0xe77c646d000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000"}'
```

| Simulated call at that block | Result |
| --- | --- |
| A `redeem(1, "")`, no role | **success** |
| B `redeem(1, "")`, no role | **success** |
| A `redeem(300e6, "")`, full balance | **success** |
| A `redeem(300e6 + 1, "")`, over balance (control) | reverts `InsufficientBalance` |
| Stranger `redeem(1, "")` (control) | reverts `InvalidKycStatus` |
| A `redeemFrom(B, 1, "")` without allowance (control) | reverts `InsufficientAllowance` |
| Unknown selector (control) | reverts `FunctionNotFound` |

Live `eth_call` on spike bond FLSPK gave the same: `redeem` and `redeemByPartition` succeed for the KYC'd holder and revert
for a stranger.

**Status:** INCONCLUSIVE until a real transaction confirms it; the simulations are strong evidence, not a mined burn. No
contract was changed. Rule 4 asks for a failing test first, and this session may not write tests, so that test is item
RT-01 in `docs/REMAINING-TESTS.md` and the first job of session 2. It needs no mock change:
`bond.test_adjustBalance(holder, -1n)` already lowers supply.

**Severity reasoning.** High: no privilege, negligible cost, and every holder's payout is frozen until an admin acts outside
the design. Not Critical: no funds move to the attacker, and the bond admin has a repair path.

**Fix options for the owner (none applied).** (a) Let the guard revert only when supply is **above** expected, so a burn
cannot lock anyone. `sweepExcess` would then over-reserve the burned units until `sweepDust`, and a later foreign mint up to
the burned amount would go unseen. (b) Enable ATS protected partitions, which `onlyUnProtectedPartitionsOrWildCardRole`
enforces; this needs a spike because it also touches transfers. Recommendation: (a), after the failing test, with the
invariants re-proved.

#### SEC-16 — Low — dashboard blocks a valid redemption during a post-deadline pause

`web/src/lib/guards.ts:47-50`, `web/src/lib/phase.ts:27`, `web/src/lib/errors.ts:82`. The dashboard treats any pause as closing
redemption and sweeps. SEC-05 and ARCHITECTURE §4.2 say a pause that starts after the deadline does not, and
`test/trigger.pause.test.ts` proves the contract redeems then. `web/test/guards.test.ts:69` pins the wrong behaviour: its
snapshot is exactly that state. Impact: the button stays disabled and the phase shows "grace". Funds are not at risk; the
contract call works. Proof: reading those lines against `trigger.pause` "a pause that starts AFTER the deadline". PASS — REVIEWED,
failing test planned as RT-15.

#### SEC-17 — Low — `npm run coverage` leaves instrumented artifacts in `artifacts/`

After `npm run coverage`, `artifacts/` holds instrumented bytecode: the pool's creation keccak was `0x60d41727…` instead of
`0x13a97433…`, runtime size 21,353 bytes instead of 9,662, and `npm run compile` recompiled 43 files. Slither crashed on this.
The spikes deploy from these artifacts, so deploying straight after coverage would ship instrumented code. The COMMANDS
runbooks start with `npm run compile`, which repairs it, so this is a procedure risk. Proof: commands in section 3.3.
The per-file Hardhat counts in section 2.1 ran after coverage with `--no-compile`, on instrumented bytecode. Their sum equals
the clean full run.

#### SEC-18 — Informational — documentation drift

| Place | Says | Reality |
| --- | --- | --- |
| ARCHITECTURE §3.3 `redeem` row (line 163), §5 invariant 9 (line 322) | redemption closed "while the trigger is paused" | only a pause begun before the deadline (SEC-05) |
| HANDOVER §6 (line 206), §12 (line 451) | "never while the trigger is paused" | same |
| HANDOVER §13 glossary, Superseded (line 500) | loss "no longer above the applied loss" | means `L == 10000` (D1) |
| SECURITY-REVIEW §4 DoS (line 117) | a re-pausing trustee lasts "until the admin revokes the role" | since D17 the admin cannot; ARCHITECTURE §9 is right |
| SECURITY-REVIEW §4 access control (line 106) | DEFAULT_ADMIN is TRUSTEE_ROLE's admin | fixed by D17 |
| COMMANDS §4 (lines 103-104) | coverage 134/134, 95/96, 83/83, 72/72 | today 135/135, 97/98, 84/84, 74/74 |
| COMMANDS §1 (line 19) | `check` = compile, test, typecheck, oracle typecheck, web lint, web build | also runs `oracle:test` and `web:test` |
| `IFaultlinePool.sol`, `SupplyMismatch` NatSpec | supply "differs from" the books | since D18, is above them. Left on purpose: the edit changes the trigger's bytecode through its metadata hash. Fix with the next real interface change |
| `FaultlinePool.sol` `MAX_GRACE`, `FaultlineTrigger.sol` `MAX_CHALLENGE_WINDOW` comments | the deadline and window sum can never overflow | true for those terms, not for `maturity` itself (SEC-22) |

`HANDOVER.md`, `README.md` and `docs/COMMANDS.md` carry uncommitted owner edits, so nothing was changed here. A pause has no
upper bound and, since D17, a rogue trustee can re-pause after every unpause. ARCHITECTURE §9 states this as a trust
assumption, so it is not a new finding; RT-07 tests it.

#### Attacks tried that found nothing

Reviewed by hand only (PASS — REVIEWED); sessions 2 and 3 execute them.

- Reopening redemption after it opened: `now - submissionDeadline()` never falls, so a pause cannot close it again.
- Submitting after the first redeem by pausing after the deadline: the deadline stays below `now` (`trigger.integration` proves it).
- Veto and execute at the same instant: `>=` and `<` on one value are mutually exclusive.
- Submit and redeem at the same instant: `>` and `<=` on `submissionDeadline()` are mutually exclusive.
- Zero address as recovered signer: the oracle cannot be zero (constructor, `setOracle`).
- Malleable or short signature: `tryRecoverCalldata` rejects, tested.
- Cross-trigger and cross-chain replay: domain binding, tested.
- Forged Superseded: needs `L == 10000`, set only through `applyLoss`.
- `applyLoss` after redemption through the real trigger: unreachable, `pendingCount` blocks redemption.
- Coupon reserve shortfall: `requiredReserve` ceils and index increments floor.
- Foreign mint draining collateral: D4 stops it (SEC-02 stands).
- `redeem` re-entry: same OpenZeppelin guard and state written first, but the path is unexecuted (RT-05).
- Stray stablecoin sent to the pool: only raises the sponsor's sweep.

## 10. Task 2D: arithmetic and input validation (D18 build, mock-tested)

`test/arithmetic.values.test.ts`, 33 tests. **Skipped because RT-18 and the setup tests cover them:** zero addresses in both constructors, `initialize` and `setOracle`; zero coupon, cap and
ticket; schedule order; the D17 bounds; `invest(MaxUint256)`; the exact cap; `associate()` casts; no-code addresses; dirty calldata; attestation time boundaries.

| Area | Result |
| --- | --- |
| Wrong decimals | 0, 5, 7, 18, 255 refused for both tokens, and a token with no `decimals()` |
| Zero and minimum | `invest(0)`; a 1-unit bond; `requiredReserve(1)` ceils to 1; one base unit short of the reserve reverts with the exact numbers |
| Very large values | U near 2^200 at 9,999 bps: credit, principal and coupon exact, no overflow. 65,535 bps over a term near 2^64 stays in range. `requiredReserve(MaxUint256)` panics, and `invest` cannot get there past the cap |
| uint64 edges | Nonce and update time at the maximum work and block further revisions. `maturity` at 2^64 - 1: SEC-22 |
| Losses 0, 1, 9,999, 10,000, 10,001 | 0 and 10,001 never reach state. 1, 9,999 and 10,000 go through the real trigger with exact credit, exact floors for both holders and books at zero. 9,999 + 9,999 caps at 10,000 |
| Rounding | Smallest holding at the smallest loss; splitting never gains; checkpoints never overpay; the full-term coupon stays inside the ceiled reserve for any unit count |
| Invalid config that deploys | A past schedule stays inert. `cap < minTicket` can never invest. `cap` above the bond's max: `MaxSupplyReached` bubbles and the pull is undone. Each is harmless but is caught only by a human reading the deploy |
| Signed fields the chain does not judge | Zero eventId, magnitude and dataHash and an update time before the origin time are accepted. Only the oracle signature vouches for them; the defence is the window and veto |

## 11. Task 2E: pause and emergency (D18 build, mock-tested)

`test/pause.emergency.test.ts`, 29 tests. Not repeated: the pause clock, repeated pauses and lost keys (`test/trigger.pause`, `test/trigger.griefing`).
Spike S2 and the full demo proved the bond-pause revert and one pause, veto, unpause cycle on testnet, on the pre-D18 build.

| While paused before the deadline | |
| --- | --- |
| **Stops** | `submit`, `execute` (`IsPaused`); `redeem`, `sweepExcess`, `sweepDust` (`RedemptionNotOpen`), for as long as the pause runs; a second pause. Each leaves every stored value unchanged |
| **Stays available** | `claim` of credits already earned, `veto`, bond transfers, all views, `setOracle`, trustee management, and `invest` and `fundCoupons` during issuance: the pause guards events, not subscriptions |

A pause begun after the deadline leaves `redeem`, `claim` and both sweeps open and `submit` closed.

- **Authorisation:** every non-trustee is refused `pause` and every non-admin `unpause`, oracle, sponsor, investor and relayer included. The pool has no pause at all.
- **No partial state:** a failed burn, mint, claim or `applyLoss` leaves all books as they were.
- **No extraction:** the public write surface of both contracts is pinned to an exact list, with no rescue, withdraw or emergency function. The stablecoin leaves the pool at one place, `claim`, to `msg.sender`. A stranger running a sweep gets nothing, and the admin and trustee cannot take funds with any pause or rotation.
- **The ATS bond is never paused by Faultline code:** `IAtsBond` has no pause, neither contract holds `ROLE_PAUSER`, the pool has no `pause()` selector, the trigger has no bond, and no module under `scripts`, `oracle/src`, `web/src` or `shared/ts` calls pause on a bond. A source scan cannot see a dynamic call; the role check is the stronger proof. The spikes repo's S2 pausing its own spike bond is out of scope.

## 12. Task 2F: DoS and gas (D18 build, mock-tested)

`test/dos.gas.test.ts`, 14 tests. Figures are local, on mocks. Real ATS and HTS cost more and Hedera charges differently, so they are ceilings against regressions, not predictions.

| Question | Result |
| --- | --- |
| Loops, arrays | No `for`, `while` or `do`, no dynamic storage array, in either contract |
| Repeated invalid submissions | 30 stranger signatures and 30 replays through a contract: every one refused, all state unchanged, gas flat. A rejected bad signature costs under 60,000 gas. An honest event still lands after the flood |
| Sweep spam | 20 repeats credit 0 at constant cost |
| Storage growth | One record per event, and only an oracle signature can add one. Event 2 and event 40 cost the same opcode steps and slots (5 or fewer). 40 pending events execute one by one at near-equal cost. A holder adds one `claimable` slot |
| **Loss application is O(1)** | Opcode-for-opcode identical with 2 holders and with 62: same steps, SLOADs and SSTOREs. Unchanged after units move, and the tenth loss costs no more than the second. `redeem` is the same for holder 1 and holder 60 |
| Gas ceilings | Each main operation has a ceiling about 20 % above its measured path. Far below Hedera's 15M limit |

A flood by the real oracle key is limited by the trustee's veto and by `submissionDeadline()`, not by a cap on `pendingCount`, which is unbounded. One veto or execute per event clears it, at O(1) each.

## 13. Financial invariants (task 3, RT-06)

`test/invariants.fuzz.test.ts`, with a separate bigint model in `test/helpers/model.ts`. **Mock-tested: real FaultlinePool and FaultlineTrigger on a local chain, with MockBond, MockUSD and MockHTS.**

**Method.** fast-check builds random sequences through issuance, risk, grace and after the deadline: 4 investors plus a stranger with no bond KYC, odd amounts, losses at the edges, four events, revisions, replays, vetoes,
executes, the exact second around window ends and the deadline, pauses, holder burns, redemptions, claims, sweeps and stray transfers. Each operation is mined at an exact time. The model first predicts success or the exact
error name, then the chain must agree and every stored value must equal the model. Each run ends in full settlement, and the event logs alone must rebuild the books.

| Final run | |
| --- | --- |
| Seed, command | `FC_SEED=20261031 FC_RUNS=400 FC_OPS=30 npx hardhat test test/invariants.fuzz.test.ts` |
| Sequences | 400, about 6 minutes |
| Transactions | 12,108: 6,019 succeeded and **6,089 reverted, each predicted to the error name** |
| Runs with a holder burn | 142 |
| Coverage of behaviour | 89 distinct final loss levels; statuses Vetoed, Executed, Superseded; 28 revert reasons |
| Event-order property | 400 cases, 2 and 3 events, every order |
| Floor maths | 200,000 random splits, off-chain |
| Failures | **0** |
| `npm test` default | 8 sequences, a new seed each time, printed |

| # | Invariant | How it is checked | Result |
| --- | --- | --- | --- |
| 1 | supply <= issued - redeemed, == when nobody burned | After every step; the gap must equal exactly what holders burned | pass |
| 2 | L never exceeds 10,000 | After every step, and L never falls | pass |
| 3 | A finalised event cannot apply twice | Immediate re-execute and signature replay after every execute and veto; L equals the capped sum of Executed losses | pass |
| 4 | A claim cannot be consumed twice | Immediate second claim after every success reverts `NothingToClaim` | pass |
| 5 | Redemption never exceeds entitlement or the pool allocation | Exact amount per holder; `principalPaid <= floor(U*(10000-L)/10000)`; `couponPaid` within the reserve; second redeem refused | pass |
| 6 | Everything reconciles exactly | Pool balance == deposits + reserve + stray - claims after every step; ends at exactly 0, with everything paid out | pass |
| 7 | Residue cannot be claimed twice, sweeps leave obligations covered | Repeat sweeps credit 0; solvency with `min(books, supply)` after every step; every later redemption and claim succeeds | pass |
| 8 | Proportional allocations | Exact floor per holder at settlement, for any transfers, burns and order | pass |
| 9 | Either event order gives the same loss and credit | Same state, every order of 2 and 3 events | pass |
| 10 | Sponsor credit + sum of floors <= units | After every step, plus the off-chain splits, with the gap at most one base unit per holder | pass |
| 11 | Reverted operations leave state unchanged | Full stored-state fingerprint before and after every revert | pass |
| 12 | Balances agree with accounting, logs with state | Per-account balances after every step; logs rebuild issued, redeemed, principal, coupon, credit, claims and statuses | pass |
| 13 | Invalid transitions are rejected | Status may only go None, Pending, terminal; the model names the error of every invalid call | pass |

**What this does not cover, so no test pretends to.**

- **Real ATS and HTS.** Every holder call runs on MockBond, which copies simulated behaviour. This is the same limit that hid SEC-15; only RT-02 and a fixed-build re-run close it.
- **Foreign mints** are left out of the sequences: they break invariant 1 by definition and need a role D4 forbids. Deterministic tests cover them and the D18 downside.
- **Holds** are left out of the model. `test/bond.holdersurface.test.ts` covers them.
- **Revert reasons not reached in sequences:** `FullyWrittenDown` (rare: it needs L at 10,000 with a submission still open), `InvalidSignature`, `AttestationExpired`, `TermsMismatch` (not generated), `SupplyMismatch`, and `RedemptionStarted`, `RiskPeriodNotStarted`, `LossNotIncreasing` (not reachable through the real trigger). Deterministic tests cover each.
- **Oracle and dashboard** are outside this fuzz.
- **A fuzz is not a proof.** RT-25 stays open.
