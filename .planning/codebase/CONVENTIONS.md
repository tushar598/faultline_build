# Conventions

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. Solidity Conventions

### Compiler Settings
- Solidity 0.8.28, EVM target `cancun`
- Optimizer enabled, 200 runs
- SPDX License: `MIT` (contracts) / `UNLICENSED` (project)

### Contract Patterns (from design docs)
- **NatSpec on every contract and public function** (`@title`, `@notice`, `@param`, `@return`)
- **Custom errors** over `require` strings (gas efficient, documented in §3.6 and §4.5 of ARCHITECTURE.md)
- **OpenZeppelin 5.6.1 inheritance:** `AccessControl` for roles, `ReentrancyGuardTransient` (TSTORE-based, `ReentrancyGuard` is deprecated in OZ 5.6), `SafeERC20`, `Math.mulDiv`, `ECDSA`, `EIP712`
- **CEI pattern:** Checks → Effects → Interactions; all state changes before external calls
- **No `receive()`**, no `payable` functions, no HBAR handling in Pool or Trigger
- **Immutables** for constructor parameters (timestamps, addresses, coupon rate, cap)
- **Balance-delta checks** for stablecoin transfers (catches fee-on-transfer or unexpected amounts)

### Naming
- Contracts: PascalCase (`FaultlinePool`, `FaultlineTrigger`, `MockUSD`)
- Interfaces: `I`-prefixed PascalCase (`IAtsBond`, `IFaultlinePool`, `IHRC719`)
- Events: PascalCase, past tense (`Invested`, `LossApplied`, `Redeemed`, `Claimed`)
- Custom errors: PascalCase, descriptive (`CapExceeded`, `SupplyMismatch`, `NotPending`)
- State variables: camelCase (`appliedLossBps`, `unitsIssued`, `couponReserve`)
- Constants: SCREAMING_SNAKE_CASE (`YEAR = 365 days`)
- Roles: `SCREAMING_SNAKE_CASE` (`TRUSTEE_ROLE`, `DEFAULT_ADMIN_ROLE`)
- Internal functions: `_` prefixed (`_accrue`, `_checkSupply`)

### Solidity Style
- `pragma solidity 0.8.28;` (exact version, not range)
- `// SPDX-License-Identifier: MIT` on line 1
- Imports: named imports (`import { AccessControl } from "@openzeppelin/..."`)
- Typed timestamp parameters: `uint64` for Unix seconds, `uint16` for basis points, `uint256` for token amounts

## 2. TypeScript Conventions

### Root (Hardhat scripts/tests)
- Module: CommonJS (required by ts-node for Hardhat 2)
- Target: ES2022
- Strict mode enabled
- `resolveJsonModule`, `esModuleInterop`, `skipLibCheck`

### Oracle
- Module: ESM (`"type": "module"`, `moduleResolution: "nodenext"`)
- Target: ES2022
- `noUncheckedIndexedAccess: true` (stricter index access)
- Strict mode + all additional strict checks

### Web (Next.js)
- Module: ESM (Next.js managed)
- TypeScript managed by Next.js config

### Naming
- Files: kebab-case for source, PascalCase for React components
- Functions: camelCase
- Types/Interfaces: PascalCase
- Constants: SCREAMING_SNAKE_CASE

## 3. Testing Conventions

### Contract Tests (Hardhat + Chai)
- Framework: Mocha (via Hardhat) + `@nomicfoundation/hardhat-chai-matchers`
- Test files: `test/pool.*.ts`, `test/trigger.*.ts`, `test/invariants.*.ts`
- Property-based testing with `fast-check` for invariant suites
- Gas reporting: `REPORT_GAS=true` env flag
- Timeout: 120,000ms (for Hedera testnet if needed)

### Oracle Tests
- Framework: Vitest 5.0.5
- Test files: `oracle/test/`
- Run: `npm run oracle:test` (also `vitest run`)

### Mock Strategy (Owner-decided)
- Real Hedera testnet wherever it can do the job; **no mocks there**
- Mocks **only** for tests needing time travel (maturity, challenge window, grace) or rapid iteration
- Every mock matched to a spike's real result; if not verified, label "not testnet-verified"
- Mock contracts: `MockUSD` (ERC-20 with KYC flag), `MockBond` (ATS interface subset), `MockHSS` (schedule service)
- Oracle fixtures: Labelled `real-*` or `synthetic-*` (never mix without labelling)

## 4. Security Conventions

- **Private keys never in chat, files, or repos** — `read -s` in terminal only
- **Testnet keys only** during development
- `.env` is git-ignored; `.env.example` has templates
- `*.vc`, `*.pem`, `*.key`, `keystore*/` all git-ignored
- Admin transactions through scripts (ethers + Hashio), never MetaMask
- Every testnet transaction needs owner confirmation

## 5. Documentation Conventions

### Docs Structure
- `HANDOVER.md` — master design document (source of truth, with §15 overriding older sections)
- `docs/ARCHITECTURE.md` — contract-level spec with mermaid diagrams, change log against HANDOVER §6
- `docs/LESSONS.md` — assumptions, problems hit, fixes (Phase 2 reads this before rebuilding)
- `docs/SPIKES.md` — testnet spike plan with ground rules
- `docs/reference/*.md` — sourced external API notes with ✅/🧪/❓ verification status
- `docs/COMMANDS.md` — exact reproducing commands, verified on owner's machine

### Verification Markers
- ✅ verified from source/testnet
- 🧪 needs testnet confirmation (spike)
- ❓ not verified
- Each reference doc marks verification status per fact

### Commit Messages
- Conventional-style prefixes: `docs:`, `feat:`, `fix:`, `test:`
- Descriptive bodies referencing design decisions (D1, D2, etc.)

## 6. Project-Specific Rules (from CLAUDE.md)

1. Production-grade code, no recycled ideas
2. Research before complex decisions
3. Be honest about mock-tested vs testnet-verified
4. Never ask for private keys
5. Answer owner short, step by step, in Hinglish
6. Read HANDOVER.md fully before doing anything

## 7. Dependency Pinning

- All dependencies use **exact versions** (`--save-exact`) in root and oracle
- Web uses caret ranges (Next.js convention)
- ethers pinned to 6.17.0 across all three packages for consistency
- TypeScript pinned to 5.9.3 (TS 7 breaks Hardhat 2)
