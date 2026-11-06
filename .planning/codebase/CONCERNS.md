# Concerns

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. Critical: Unverified Assumptions

The design rests on **14 assumptions** (U1–U14 in `docs/ARCHITECTURE.md` §10) that have not been testnet-verified. Spikes S1–S3 (must) and S4–S6 (stretch) are planned to verify them. **No contract code should be written until the must-spikes confirm the key assumptions.**

| Assumption | Risk if Wrong | Spike |
| --- | --- | --- |
| U1: ATS v8 `mint` function signature | Wrong interface → deployment fails | S1 |
| U2: `controllerRedeem` reverts when bond paused | Pool strategy breaks if it doesn't | S2 |
| U3: `controllerRedeem` works after maturity, without holder KYC | Core redemption flow breaks | S1 |
| U4: ATS bond accepts nominal 1 USD / 6 decimals | Bond creation fails | S1 |
| U5: HIP-719 association + ERC-20 facade in/out works from contract | Pool can't hold stablecoin | S3 |
| U6: HTS KYC required on pool contract | Pool setup needs extra step | S3 |
| U14: EVM-created contracts have unlimited auto-association | May need explicit association | S3 |

## 2. High: No Code Exists Yet

The project is **100% scaffold and documentation**. Zero business logic has been written:
- No `FaultlinePool.sol` or `FaultlineTrigger.sol`
- No tests, no deployment scripts
- Oracle is a placeholder empty export
- Dashboard is the default Next.js starter

**Risk:** The gap between detailed design (535-line ARCHITECTURE.md, 75KB HANDOVER.md) and zero implementation is large. Implementation may surface design issues not visible in spec review.

## 3. High: Hackathon Time Pressure

- **Target:** ETHGlobal Mumbai (Nov 5–7, 2026)
- **Qualification requirements:** Testnet deploy, HashScan verification, ≤5 min demo video
- **Current state:** Scaffold only; spikes not yet run
- **Build phases:** Spikes S1–S3 → Contracts → Tests → Oracle → Dashboard → Testnet deploy → Demo video
- **Risk:** The build order has many serial dependencies (spikes must complete before contracts can be finalized)

## 4. High: Oracle Trust Model

The oracle is a **single trusted key**. Mitigations exist (challenge window, trustee veto, pause, key rotation) but:
- No decentralized oracle network
- No threshold signing or multi-sig
- If the oracle key is compromised and the trustee doesn't veto within the window, loss is irreversible
- This is an acknowledged trust assumption, explicitly stated as "not an apology"

## 5. Medium: Hedera-Specific Quirks

### Hashio Provider Issues
- Large `eth_call` / `eth_estimateGas` calls fail via Hardhat 3's HTTP provider
- Workaround: plain ethers `JsonRpcProvider` for reads
- May affect deployment scripts using Hardhat 2's provider similarly

### Gas Estimation
- `deployBond` costs ~7.8M gas (~9 HBAR)
- 15M gas limit per transaction is tight for complex operations
- All Faultline functions are O(1) but total deployment gas needs monitoring

### HTS Token Behavior (Unconfirmed)
- ERC-20 facade failure mode: revert vs `return false` → affects `SafeERC20` usage
- KYC/association requirements on contract accounts → affects pool setup
- `freezeDefault: false` chosen but freeze key exists → trust assumption

## 6. Medium: ATS Bond Complexity

### Diamond Pattern
- ATS v8 bond is a diamond proxy (94 facets for BOND config)
- Complex upgrade surface; Faultline has no control over ATS upgrades
- `ROLE_AGENT` can mint and `controllerRedeem` — must ensure nobody holds it (D4 supply guard)
- `ROLE_ADJUSTMENT_BALANCE` could alter supplies — must ensure nobody holds it

### Bond Pause Risk
- If the ATS bond is paused, `controllerRedeem` reverts
- Faultline must **never** pause the bond, but `DEFAULT_ADMIN_ROLE` holder could
- This is an explicit trust assumption: "the bond admin could re-grant `ROLE_ISSUER` or pause the bond and block redemption"

## 7. Medium: Rounding and Financial Precision

- All rounding goes "against the holder" (floor)
- `sum of per-holder floors <= floor(total)` guarantees solvency
- Coupon index uses 1e18 scaling factor
- Basis points (uint16) for loss: 0–10000
- Must test edge cases: 1 unit holders, max supply, 100% loss, 0% loss, boundary magnitudes

## 8. Medium: Stablecoin Trust Assumptions

- No wipe key (prevents draining)
- Admin key exists (can change token properties)
- KYC key exists (can revoke KYC and block transfers)
- Freeze key exists (can freeze individual accounts)
- No custom fees (balance-delta check catches unexpected fees)
- These are stated trust assumptions, not bugs

## 9. Low: Dependency & Tooling Risks

| Risk | Detail | Mitigation |
| --- | --- | --- |
| TypeScript 7 incompatibility | TS 7 (native port) breaks Hardhat 2's ts-node | Pinned to 5.9.3 |
| Next.js 16 breaking changes | `web/AGENTS.md` warns APIs may differ from training data | Read `node_modules/next/dist/docs/` before writing dashboard code |
| ethers 6.17.0 shared | Any version drift between packages could cause issues | Pinned with `--save-exact` |
| No CI/CD | No automated testing pipeline | `npm run check` is local-only pre-commit gate |
| Three separate lockfiles | web + oracle + root each have own `node_modules` | `npm run setup` handles all three |

## 10. Low: Design Gaps Pending Owner Input

| Gap | Status | Depends On |
| --- | --- | --- |
| Geographic box parameters (lat/lon) | Not set | After spikes S1–S3 |
| Payout curve (floor/ceil magnitude) | Placeholder 6.5–7.5 | After spikes |
| Grace period duration | Not set | After USGS review timing research |
| Coupon rate (bps) | Not set | After spikes |
| Challenge window duration | Not set | After spikes |
| Cooling period | Placeholder 6h | After USGS research |

## 11. Low: Cleanup Debt

| Item | Location | Notes |
| --- | --- | --- |
| `SetupCheck.sol` | `contracts/` | Delete when `FaultlinePool` lands |
| Default Next.js page | `web/src/app/page.tsx` | Replace with dashboard |
| S0: Revoke Redeemer's ROLE_CONTROLLER on TCB | Old test bond | Owner must confirm; runs after spikes |
| Hollow accounts | the `FLH_*` accounts (docs/ACCOUNTS.md) | Each completes on its first signed tx; verified in this repo's smoke run (2026-11-05) |

## 12. Observations

### Strengths
- **Exceptionally thorough design documentation** — 75KB handover, 33KB architecture, all design decisions numbered and approved
- **Clean separation** — contracts/oracle/web as independent packages
- **Security-first thinking** — supply guard, per-event loss, dynamic deadline, explicit trust assumptions
- **Real test data** — actual USGS Bhuj earthquake fixture
- **Honest status tracking** — README clearly shows what's verified, mock-tested, and not written

### Weaknesses
- **No code to validate the design** — everything is theoretical until implementation
- **Serial spike dependencies** — can't finalize contracts until S1–S3 complete
- **Single developer** — no peer review process beyond AI assistance
- **No CI pipeline** — manual `npm run check` only
