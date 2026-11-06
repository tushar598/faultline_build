# Test assessment state

Continuation note for the four-session assessment. Update at the end of every session.

Last update: 2026-10-31, end of session 3. **2026-11-03 (branch `ops-issuer`, from `test-assessment`):** testnet scripts moved into
`ops/` (dry runs match, not re-run on testnet: RT-30) and the dashboard issuer page added (local mock-tested, testnet NOT
testnet-verified: RT-29). Web Vitest 99, Playwright 11, `ops:typecheck` part of `npm run check`; Hardhat and oracle counts unchanged. Work branch: `test-assessment` (not pushed, no remote added). `.planning/` stays untouched and untracked.
No testnet transaction was sent. The spikes repo has one local commit, `b527729`, on `main`; its README keeps the owner's uncommitted edit.

## Session 3: done

| Item | Result | Where |
| --- | --- | --- |
| SEC-15 | **Fixed by D18**, mock-tested only. 15 pins replaced by tests of the new behaviour and downsides | `FaultlinePool.sol`, `test/pool.supplyburn.test.ts`, report section 2 |
| SEC-19 | Accepted as a trust assumption, no contract change | ARCHITECTURE §9, README |
| SEC-20 | Audit called from `demo-2-deploy.ts` and `smoke-3-deploy.ts`. Read-only on the real FLDMO: no problem | spikes `b527729` |
| SEC-21 | Docs only | ARCHITECTURE §9, README |
| RT-02 | Script written, **not run**; refuses a pre-D18 deployment | spikes `scripts/demo/rt02-holder-burn.ts` |
| Task 2D, 2E, 2F | 33, 29 and 14 tests. One new Info: SEC-22 | report sections 10 to 12 |
| Task 3, RT-06 | 13 invariants, 0 failures over 400 sequences, 12,108 transactions, 6,089 reverts | report section 13 |
| Mutation | 25 mutants: deterministic 25, fuzz alone 23, 2 by design | report section 8 |
| RT-20 | Likely cause fixed in `4a0ac09`; ten-run check not done | `docs/REMAINING-TESTS.md` |
| Sign in, Sign out | Documented from `b2f240b`. Local only; revoking on a real wallet is untested | COMMANDS §9, README |

**Build state.** `FaultlinePool` creation keccak `0x787121361e68862c7141ba31bf73adcc32d1744df207f28b0cad544d09563f6d`, deployed on no chain. `FaultlineTrigger`
`0x3205b3ca16a3d19b235bc245328dec4c6b65d44b996e789d0ae668419aa8fcf3`, byte-identical to the testnet build. **All testnet evidence is from `e617570`, before D18; a re-run on the fixed build is still to do.**

**Worth the owner's eye.** The downside of D18 is wider than session 2 said: after `sweepDust` a masked foreign mint is unbacked, so the last claimant is short, which can be a slow holder. It needs a bond role that
can already steal by forced transfer, so it stays Accepted-class, but the approval was given on the narrower text.

**The first prompt of session 2 is still missing.** Tasks came from later prompts, this file and `docs/REMAINING-TESTS.md`.

## Real test counts

| Suite | Discovered | Passed | Failed | Skipped | Environment |
| --- | --- | --- | --- | --- | --- |
| Hardhat | 420 | 420 | 0 | 0 | local, mocks |
| Oracle Vitest | 84 | 83 | 0 | 1 (opt-in live USGS) | offline |
| Web Vitest | 48 | 48 | 0 | 0 | offline |
| Playwright | 9 | 9 | 0 | 0 | local node, test wallet |
| **Total** | **561** | **560** | **0** | **1** | |

`e2e:local` and `oracle:e2e:local` pass. Coverage: pool branches 98/98, trigger 74/74. Fuzz by hand: `FC_SEED=20261031 FC_RUNS=400 FC_OPS=30`.

## Open findings

| ID | Severity | Summary | State |
| --- | --- | --- | --- |
| SEC-19 | Medium | Unbounded pause and a lost admin key | Accepted, production needs a multisig |
| SEC-16 | Low | Dashboard blocks a valid redemption during a post-deadline pause | RT-15 |
| SEC-17 | Low | `npm run coverage` leaves instrumented artifacts | RT-21 |
| SEC-18 | Info | Documentation drift, two new rows | Open |
| SEC-22 | Info | `maturity` near 2^64 overflows the deadline | Open, deploy-time only |
| SEC-12 | Info | Unrated rate limit on `/api/usgs` | Open |

Critical: 0. High: 0 open. SEC-02, SEC-06, SEC-07 accepted. SEC-15 fixed, not proven on a real bond. SEC-20 fixed in scripts, not run in a deployment. SEC-21 documented.

## Blocked or not run

| Item | Why |
| --- | --- |
| Fixed-build testnet re-run, RT-02 (mined burn), RT-11 | Owner runs `EXECUTE=1` later |
| RT-20 ten consecutive runs | About 20 minutes, not done since `4a0ac09` |
| RT-12, RT-13, RT-15, RT-16, RT-28 decision | Not reached |
| Full mutation tool run (RT-24) | Hand-picked sets only |
| `gitleaks dir` | Session 4, with exclusions |
| Live USGS test | Opt-in, not run |
| Foundry, Echidna, Medusa, solhint | Not installed |

## Exact commands

```bash
git status --short && git branch --show-current     # expect test-assessment
npm run check                                       # expect 420, 83 + 1 skipped, 48
npm run e2e:local
npm run oracle:e2e:local
npm run web:e2e                                     # about 2 minutes, 9 tests
npm run coverage && npm run compile                 # always recompile after coverage (SEC-17)
FC_SEED=20261031 FC_RUNS=400 FC_OPS=30 npx hardhat test test/invariants.fuzz.test.ts   # about 6 minutes
```

## Start point for the next session

1. Read this file, run `git status`, run `npm run check` to detect drift.
2. RT-12, RT-13, RT-15, RT-16, the ten runs of RT-20, RT-28, then session 4.
3. Before any claim about the fixed build on a real network: new deployment, RT-02, and an update to `docs/TESTNET-EVIDENCE.md`.
