# Technology Stack

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## Runtime & Language

| Layer | Technology | Version | Notes |
| --- | --- | --- | --- |
| Node.js | ≥22 (tested 24.16.0) | `engines` in root + oracle `package.json` | macOS arm64 |
| Language | TypeScript | 5.9.3 (pinned) | TS 7 (native port) avoided; Hardhat 2 needs ts-node |
| Solidity | 0.8.28 | `hardhat.config.ts` | EVM target `cancun` (OpenZeppelin 5.6 needs MCOPY) |

## Smart Contracts

| Component | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Hardhat | 2.29.1 | Dev framework | Compile, test, deploy, local chain |
| OpenZeppelin Contracts | 5.6.1 | `@openzeppelin/contracts` | AccessControl, ReentrancyGuardTransient, SafeERC20, Math, ECDSA, EIP712 |
| TypeChain | 8.3.2 + ethers-v6 0.5.1 | Type-safe contract bindings | `typechain-types/` output dir |
| ethers.js | 6.17.0 | EVM interactions | Shared across root, oracle, web |
| Solidity Coverage | 0.8.17 | Test coverage | `npm run coverage` |
| Hardhat Gas Reporter | 1.0.10 | Gas profiling | `REPORT_GAS=true` |
| fast-check | 4.10.2 | Property-based testing | Planned for invariant tests |
| Chai | 4.5.0 + hardhat-chai-matchers 2.1.2 | Assertion library | Contract test assertions |

## Oracle (TypeScript service)

| Component | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Package | `@faultline/oracle` | 0.1.0 | ESM module (`"type": "module"`) |
| Hashgraph SDK | `@hashgraph/sdk` 2.81.0 | Hedera native API | HCS publish, token operations |
| ethers.js | 6.17.0 | EIP-712 signing, contract calls | Attestation signing |
| Zod | 4.6.7 | Runtime validation | USGS response parsing |
| Vitest | 5.0.5 | Test runner | `npm run oracle:test` |
| tsx | 4.23.15 | TypeScript execution | Dev runner |

## Web Dashboard

| Component | Technology | Version | Purpose |
| --- | --- | --- | --- |
| Package | `@faultline/web` | 0.1.0 | Next.js app |
| Next.js | 16.4.3 | React framework | App Router, SSR |
| React | 19.3.0 | UI framework | Latest with concurrent features |
| Tailwind CSS | 4.x | Styling | With `@tailwindcss/turbopack` loader |
| ethers.js | 6.17.0 | Blockchain reads | Contract view calls |
| ESLint | 9.x + eslint-config-next | Linting | `npm run web:lint` |

## External Dependencies (Not in repo)

| Dependency | What | Notes |
| --- | --- | --- |
| Hedera Testnet | Chain ID 296 | RPC via `testnet.hashio.io/api` |
| Hedera Mirror Node | REST API | `testnet.mirrornode.hedera.com` |
| ATS v8 Factory | `0.0.9213391` | Bond deployment (ERC-1400/3643 diamond) |
| ATS v8 BLR | `0.0.9212226` | Business Logic Resolver |
| USGS ComCat API | Earthquake data | `earthquake.usgs.gov/fdsnws/event/1` |
| HCS Topics | Consensus Service | Attestation audit trail |
| HTS Stablecoin | Token Service | ERC-20 facade over native HTS token |

## Build & Tooling

| Tool | Version | Purpose |
| --- | --- | --- |
| npm | 11.13.0 (tested) | Package manager |
| ts-node | 10.9.2 | Hardhat TS loader |
| TypeScript | 5.9.3 | Type checking (`npm run typecheck`) |

## Configuration Files

| File | Purpose |
| --- | --- |
| `hardhat.config.ts` | Solidity 0.8.28/cancun, optimizer 200 runs, hardhat + hederaTestnet networks |
| `tsconfig.json` (root) | ES2022 target, CommonJS (for Hardhat 2), strict |
| `oracle/tsconfig.json` | ES2022 target, NodeNext module (ESM), strict + noUncheckedIndexedAccess |
| `web/tsconfig.json` | Next.js managed |
| `web/next.config.ts` | Turbopack with pinned root (multi-lockfile fix), Tailwind loader |
| `.env.example` | Template for non-secret env vars (RPC URLs, ATS addresses, USGS base) |
| `.gitignore` | Excludes: `.env`, `node_modules/`, `artifacts/`, `cache/`, `typechain-types/`, `.next/`, `*.vc`, `*.pem` |

## Key Version Constraints

- **TypeScript pinned to 5.9.3**: TS 7 (native port) breaks Hardhat 2's ts-node loader
- **EVM target `cancun`**: OZ 5.6 requires MCOPY opcode; ATS v8 also uses cancun; Hedera supports it since v0.50
- **ethers 6.17.0**: Shared across all three packages for consistency
- **Hardhat 2 (not 3)**: ATS v8 itself uses Hardhat 2; spikes use Hardhat 3 in a separate repo
