# Testing

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. Current State

| Test Suite | Files | Tests | Status |
| --- | --- | --- | --- |
| Hardhat (contracts) | 0 | 0 | `test/` directory exists but empty |
| Vitest (oracle) | 0 | 0 | `oracle/test/` directory exists but empty |
| Web (lint only) | — | — | `npm run web:lint` passes; no test runner |
| Full check | — | — | `npm run check` runs compile + test + typecheck + oracle:typecheck + web:lint + web:build |

**All tooling is installed and verified to work.** `npm run check` succeeds on the owner's machine (Node 24.16.0, macOS arm64).

## 2. Test Infrastructure

### Contract Tests
| Tool | Version | Purpose |
| --- | --- | --- |
| Hardhat | 2.29.1 | Local EVM chain, test runner (Mocha) |
| Chai | 4.5.0 | Assertions |
| hardhat-chai-matchers | 2.1.2 | `.to.be.revertedWithCustomError()`, `.to.emit()`, etc. |
| hardhat-network-helpers | 1.1.2 | `time.increase()`, `mine()`, `loadFixture()` |
| fast-check | 4.10.2 | Property-based testing for invariant suites |
| ethers | 6.17.0 | Contract interaction in tests |
| TypeChain | 8.3.2 | Type-safe contract bindings |
| solidity-coverage | 0.8.17 | Line/branch coverage (`npm run coverage`) |
| hardhat-gas-reporter | 1.0.10 | Gas usage per function (`REPORT_GAS=true`) |

### Oracle Tests
| Tool | Version | Purpose |
| --- | --- | --- |
| Vitest | 5.0.5 | Test runner |
| tsx | 4.23.15 | TypeScript execution for dev |

### Timeouts
- Hardhat Mocha: 120,000ms (configured in `hardhat.config.ts`)
- This is for potential testnet tests; local tests are fast

## 3. Planned Test Strategy (from docs/ARCHITECTURE.md §5)

### Unit Tests
- `test/pool.*.ts` — FaultlinePool function-level tests
- `test/trigger.*.ts` — FaultlineTrigger function-level tests
- Each function tested for: happy path, all revert conditions (custom errors), edge cases, event emissions

### Property-Based / Invariant Tests
- `test/invariants.*.ts` — Using fast-check
- **Must assert after every step of every random sequence:**

| # | Invariant |
| --- | --- |
| 1 | `stablecoin.balanceOf(pool) >= collateralLeft + couponReserveLeft + totalClaimable` |
| 2 | `collateralLeft >= sum of redeemable(balance)` over unredeemed holders |
| 3 | Sponsor credit path-independent: `sponsorCredited == floor(U*L/10000)` for any event sequence |
| 4 | `bond.totalSupply() == unitsIssued - unitsRedeemed` (supply guard) |
| 5 | No holder receives more than `redeemable(balance) + coupon(balance)` |
| 6 | `appliedLossBps` never decreases; `<= 10000` |
| 7 | `couponReserveLeft >= sum of coupon(balance)` over unredeemed holders |
| 8 | `pendingCount == number of events with status Pending` |
| 9 | If `pendingCount > 0` or `now <= submissionDeadline()`, then `redeem`/`sweepExcess`/`sweepDust` revert |
| 10 | `L = min(10000, sum of lossBps of Executed events)` |
| 11 | No `submit` succeeds after first successful `redeem` |

### Integration Tests
- `scripts/e2e-local.ts` — Full lifecycle on local Hardhat node
- `scripts/deploy-local.ts` — Deployment script test

## 4. Mock Strategy

### Mock Contracts (planned in `contracts/mocks/`)
| Mock | Mimics | Purpose |
| --- | --- | --- |
| `MockUSD` | HTS stablecoin (ERC-20 facade) | KYC flag, association check, `transferFrom`/`transfer` |
| `MockBond` | ATS v8 bond (diamond) | `mint`, `controllerRedeem`, `balanceOf`, `totalSupply`, KYC revert on mint to non-KYC |
| `MockHSS` | Hedera Schedule Service | `scheduleCall` response codes |

### Mock Rules (Owner-mandated)
1. **Real testnet wherever possible** — mocks only for time travel or rapid iteration
2. **Every mock matched to spike results** — revert selectors, failure modes match real behavior
3. **Label unverified mocks** — say "not testnet-verified" if the spike hasn't run yet
4. **MockBond revert names** must match ATS v8 actual selectors (to be updated after spike S1)
5. **MockUSD failure mode** must match HTS ERC-20 facade behavior (revert vs `false`, to be confirmed in spike S3)

### Oracle Fixtures
| Category | Naming | Purpose |
| --- | --- | --- |
| Real USGS data | `real-usgs-<id>-*.geojson` | Captured from USGS API, re-fetch before demo |
| Synthetic test data | `synthetic-*.geojson` | Hand-written for edge cases; never presented as real |

**Synthetic fixtures needed (from docs):**
- Automatic status (should be rejected)
- Wrong magType (not moment magnitude)
- Outside geographic box
- Too deep
- Revisions (updated timestamp changes)
- Merged ids (event aliasing)

## 5. Test Commands

```bash
# Contract tests
npm test                    # Hardhat test on in-process chain
npm run test:gas           # With gas reporting (REPORT_GAS=true)
npm run coverage           # solidity-coverage

# Oracle tests
npm run oracle:test        # vitest run

# Type checking
npm run typecheck          # Root TypeScript
npm run oracle:typecheck   # Oracle TypeScript

# Web
npm run web:lint           # ESLint
npm run web:build          # Production build (validates)

# Everything
npm run check              # compile + test + typecheck + oracle:typecheck + web:lint + web:build
```

## 6. Verification Tiers

The project distinguishes between verification levels:

| Tier | Meaning | Applies to |
| --- | --- | --- |
| **Testnet verified** | Proven with a real transaction on Hedera testnet | Spike results (S1–S6) |
| **Mock tested** | Tested locally with mocks matching expected behavior | Unit/invariant tests |
| **Design only** | Specified in docs but no code or test exists yet | Most of the system currently |

The README maintains a status table tracking which areas are verified vs mock-tested vs not written.

## 7. Coverage Goals

No explicit coverage targets set, but the design implies:
- **100% custom error coverage** — every revert path tested
- **100% event emission coverage** — every event tested
- **All invariants hold under random sequences** — property-based testing
- **All design decisions (D1–D10) have dedicated test cases**

## 8. CI/CD

No CI pipeline configured yet. `npm run check` is the local pre-commit gate.
