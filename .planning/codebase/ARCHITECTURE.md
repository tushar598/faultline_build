# Architecture

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. System Overview

Faultline is a **parametric earthquake catastrophe bond on Hedera**. If a USGS-reviewed earthquake crosses a preset threshold inside an insured geographic zone, bond principal is written down through a global loss index and the matching collateral is credited to the sponsor once a challenge window ends.

**Current state:** Scaffold only. No contract, oracle, or dashboard code exists yet. All design is in `HANDOVER.md` and `docs/ARCHITECTURE.md`.

## 2. Component Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Off-Chain Layer                       │
│                                                          │
│  ┌───────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  USGS     │  │  Oracle      │  │  Dashboard       │  │
│  │  ComCat   │──│  (calc agent)│  │  (Next.js)       │  │
│  │  API      │  │  oracle/src/ │  │  web/src/        │  │
│  └───────────┘  └──────┬───────┘  └────────┬─────────┘  │
│                        │                   │             │
└────────────────────────│───────────────────│─────────────┘
                         │                   │
┌────────────────────────│───────────────────│─────────────┐
│            Hedera (EVM + Native Services)  │             │
│                        │                   │             │
│  ┌─────────────┐ ┌─────▼──────┐  ┌────────▼──────────┐  │
│  │  HCS Topic  │ │ Faultline  │  │  FaultlinePool    │  │
│  │  (audit log)│ │ Trigger    │──│  (collateral,     │  │
│  └─────────────┘ │ (EIP-712,  │  │   issuance,       │  │
│                  │  window,   │  │   loss index,     │  │
│                  │  veto)     │  │   coupons, claims) │  │
│                  └────────────┘  └────────┬──────────┘  │
│                                           │              │
│           ┌──────────────┐  ┌─────────────▼───────────┐  │
│           │ HTS Stable-  │  │ ATS Bond (diamond)      │  │
│           │ coin (ERC-20 │  │ ERC-1400/ERC-3643       │  │
│           │ facade)      │  │ 6 decimals, nominal 1USD│  │
│           └──────────────┘  └─────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 3. Contract Architecture

### FaultlinePool
- **Inherits:** OZ `AccessControl`, `ReentrancyGuardTransient`
- **Holds:** All collateral and coupon reserve (stablecoin)
- **ATS roles:** `ROLE_ISSUER` and `ROLE_CONTROLLER` on the bond (exclusive holder)
- **Key operations:** `invest`, `applyLoss`, `redeem`, `claim`, `sweepExcess`, `sweepDust`
- **State model:** Global loss index (`appliedLossBps`), coupon index (time-weighted), pull-pattern claims

### FaultlineTrigger
- **Inherits:** OZ `AccessControl`, `EIP712`
- **Holds:** No funds
- **Key operations:** `submit` (EIP-712 verified), `veto`, `execute`, `pause`/`unpause`
- **State model:** Per-event records with status machine (None → Pending → Executed/Vetoed/Superseded)
- **Custom pause:** Tracks `totalPausedSeconds` for dynamic submission deadline (D2)

### Deployment Order (D5)
1. Deploy `FaultlinePool(stablecoin, bond, sponsor, timestamps, couponBps, cap, minTicket)`
2. Deploy `FaultlineTrigger(pool, termsHash, challengeWindow, oracle, admin, trustee)` — reads schedule from pool
3. Admin calls `pool.initialize(trigger)` — one-time; also HTS association

## 4. Data Flow

### Happy Path
1. **Setup:** Sponsor funds coupon reserve → Pool pulls stablecoin
2. **Subscription:** Investors pay stablecoin → Pool mints bond units 1:1
3. **Risk period:** Coupon accrues on outstanding principal
4. **Event:** Oracle detects reviewed quake → Signs EIP-712 attestation → Publishes to HCS → Submits to Trigger
5. **Challenge:** Trustee may veto; oracle may revise (higher nonce); clock runs in unpaused time only
6. **Write-down:** Anyone calls `execute` after window → Trigger calls `pool.applyLoss()` → Sponsor credited
7. **Redemption:** After `submissionDeadline()`, no pending events → Holders `redeem()` then `claim()`
8. **Cleanup:** `sweepExcess()` then `sweepDust()` (when supply = 0) → Sponsor gets remainder

### Lifecycle State Machine
```
[Setup] → [Subscription] → [Risk] → [Grace] → [Redemption] → [Closed]
                              ↕
                     (Pending events: submit/veto/execute cycle)
```

## 5. Security Model

### Access Control
| Role | Holder | Powers |
| --- | --- | --- |
| Pool admin | Deployer | `initialize` (once) |
| Trigger admin | Admin EOA | `unpause`, `setOracle`, manage trustees |
| Trustee | Trustee EOA | `veto` (inside window), `pause` |
| Oracle | Calc agent key | Signs attestations (not a contract role) |
| Sponsor | Sponsor EOA | `fundCoupons`, receives write-down proceeds |

### Key Defenses
- **Supply guard (D4):** Reverts if `bond.totalSupply() != unitsIssued - unitsRedeemed` — blocks foreign mints
- **Per-event loss (D1):** Each attestation carries its own `lossBps`; trigger aggregates with `min(10000, L + lossBps)` — fixes concurrent-event bug
- **Dynamic deadline (D2):** `submissionDeadline() = maturity + grace + totalPausedSeconds` — pause can't make legit quakes miss the cutoff, and can't allow redemption before a pending attestation resolves
- **Balance-delta checks:** Actual stablecoin received vs expected amount (catches fee-on-transfer tokens)
- **CEI + nonReentrant:** All state changes before external calls
- **No lock/hold roles (D9):** Never grant ATS lock/hold/clearing roles on the Faultline bond

### Trust Assumptions
- Oracle key (bounded by window + veto + pause + rotation)
- Trustee (veto is permanent per event, can delay redemption by re-pausing)
- Bond `DEFAULT_ADMIN_ROLE` (could re-grant dangerous roles)
- Stablecoin admin keys (KYC, freeze, but no wipe)
- ATS balance ≠ effective value after write-down

## 6. Module Boundaries

| Module | Owns | Talks to |
| --- | --- | --- |
| `contracts/` | Pool + Trigger + interfaces + mocks | ATS bond (diamond), HTS stablecoin |
| `oracle/` | USGS reading, trigger rules, EIP-712 signing, HCS publishing | USGS API, HCS, Trigger contract |
| `web/` | Investor/sponsor/trustee dashboards, replay view | Pool + Trigger (read views), Mirror node |
| `test/` | Hardhat unit/property/invariant tests | Contracts + mocks |
| `scripts/` | Deploy, local e2e, testnet helpers | All contracts |

## 7. State Invariants

1. `stablecoin.balanceOf(pool) >= totalClaimable + owed(outstanding)` (always)
2. `collateralLeft >= sum of redeemable(balance)` over unredeemed holders
3. Sponsor credit is path-independent: `sponsorCredited == floor(U*L/10000)` for any event sequence reaching L
4. `bond.totalSupply() == unitsIssued - unitsRedeemed` (enforced on-chain)
5. `appliedLossBps` never decreases, bounded by 10000
6. No `submit` succeeds after the first successful `redeem`
7. Terminal event statuses (`Vetoed`, `Executed`, `Superseded`) never change
