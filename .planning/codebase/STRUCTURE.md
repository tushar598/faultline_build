# Structure

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. Repository Layout

```
faultline/                          # Root (Hardhat 2 workspace)
├── HANDOVER.md                     # 75KB master design document (§1–§15)
├── CLAUDE.md                       # Claude Code instructions (short)
├── README.md                       # Project overview + status table
├── package.json                    # Root deps: Hardhat 2, OZ 5.6, ethers 6, testing
├── hardhat.config.ts               # Solidity 0.8.28/cancun, optimizer 200, networks
├── tsconfig.json                   # ES2022/CommonJS/strict (for Hardhat 2 + ts-node)
├── .env.example                    # Non-secret env template (RPC, mirror, ATS, USGS)
├── .gitignore                      # .env, node_modules, artifacts, cache, .next, *.vc
│
├── contracts/                      # Solidity source
│   ├── SetupCheck.sol              # Toolchain smoke test (delete when FaultlinePool lands)
│   ├── interfaces/                 # Empty — will hold IAtsBond, IFaultlinePool, IFaultlineTrigger, IHRC719
│   └── mocks/                      # Empty — will hold MockUSD, MockBond, MockHSS
│
├── test/                           # Empty — will hold pool.*.ts, trigger.*.ts, invariants.*.ts
│
├── scripts/                        # Empty — will hold deploy-local.ts, e2e-local.ts, testnet/*
│
├── oracle/                         # TypeScript oracle service (separate package, ESM)
│   ├── package.json                # @faultline/oracle: hashgraph/sdk, ethers, zod, vitest
│   ├── tsconfig.json               # ES2022/NodeNext/strict + noUncheckedIndexedAccess
│   ├── src/
│   │   └── index.ts                # Placeholder (empty export)
│   ├── test/                       # Empty — will hold oracle unit tests
│   └── fixtures/
│       ├── README.md               # Fixture labelling rules (real vs synthetic)
│       ├── real-usgs-usp000a8ds-detail.geojson    # 95KB real Bhuj M7.7 earthquake
│       └── real-usgs-usp000a8ds-search.geojson    # 1.5KB real USGS search result
│
├── web/                            # Next.js 16 dashboard (separate package)
│   ├── package.json                # @faultline/web: next 16, react 19, tailwind 4, ethers 6
│   ├── next.config.ts              # Turbopack with pinned root, Tailwind loader
│   ├── AGENTS.md                   # Next.js 16 breaking changes notice (auto-generated)
│   ├── eslint.config.mjs           # ESLint 9 + Next.js config
│   ├── tsconfig.json               # Next.js managed
│   ├── public/                     # Static assets (next.svg, vercel.svg, etc.)
│   └── src/app/
│       ├── layout.tsx              # Root layout (Geist fonts, antialiased)
│       ├── page.tsx                # Default Next.js starter page (to be replaced)
│       ├── globals.css             # Tailwind import + CSS custom properties
│       └── favicon.ico             # Default favicon
│
├── docs/                           # Design and reference documentation
│   ├── ARCHITECTURE.md             # 535-line contract-level spec with diagrams
│   ├── COMMANDS.md                 # Exact setup and daily commands
│   ├── CONTEXT.md                  # Digest from origin conversation
│   ├── LESSONS.md                  # Assumptions, problems hit, fixes, decisions
│   ├── SPIKES.md                   # Hedera testnet spike plan (S0–S6)
│   ├── TRACK.md                    # ETHGlobal Mumbai track requirements
│   └── reference/
│       ├── README.md               # Reference notes index
│       ├── ats.md                  # ATS v8 interfaces, roles, setup order
│       ├── hedera.md               # Hedera chain, gas, HTS, HCS, scheduling
│       ├── usgs.md                 # USGS API, GeoJSON fields, event status
│       ├── openzeppelin.md         # OZ 5.6.1 modules used
│       └── tooling.md              # Hardhat time travel, setCode, testing tools
│
├── artifacts/                      # Hardhat compile output (git-ignored)
├── cache/                          # Hardhat cache (git-ignored)
└── node_modules/                   # Dependencies (git-ignored)
```

## 2. Package Structure

This is a **monorepo with three independent packages** (no workspace manager like Lerna/Turborepo — they share only the git repo):

| Package | Path | Module System | Package Manager |
| --- | --- | --- | --- |
| Root (contracts) | `/` | CommonJS (ts-node for Hardhat 2) | npm |
| Oracle | `/oracle` | ESM (`"type": "module"`) | npm (own lockfile) |
| Web | `/web` | ESM (Next.js managed) | npm (own lockfile) |

`npm run setup` runs `npm ci` in all three. Each has its own `node_modules/` and `package-lock.json`.

## 3. File Size Distribution

| Category | Files | Total Size | Notes |
| --- | --- | --- | --- |
| Design docs | 8 | ~145 KB | HANDOVER.md alone is 75KB |
| Reference docs | 6 | ~34 KB | Sourced external API notes |
| Fixtures | 2 | ~96 KB | Real USGS GeoJSON |
| Config | 7 | ~5 KB | package.json, tsconfig, hardhat config |
| Source code | 1 | 184 B | SetupCheck.sol (smoke test) |
| Oracle source | 1 | 151 B | Placeholder export |
| Web source | 4 | ~4 KB | Default Next.js starter |

**Observation:** The project is ~99.7% documentation/design and ~0.3% code. The scaffold is verified to compile and type-check but contains no business logic.

## 4. Key Entry Points

| Entry Point | File | Purpose |
| --- | --- | --- |
| Contract compilation | `hardhat.config.ts` | `npx hardhat compile` |
| Contract tests | `test/` (empty) | `npx hardhat test` |
| Oracle tests | `oracle/test/` (empty) | `npm run oracle:test` (vitest) |
| Oracle entry | `oracle/src/index.ts` | Placeholder |
| Web dev server | `web/src/app/page.tsx` | `npm run web:dev` |
| Full check | `package.json` scripts | `npm run check` |

## 5. Target Structure (from docs/ARCHITECTURE.md §11)

```
contracts/
  FaultlinePool.sol
  FaultlineTrigger.sol
  interfaces/   IAtsBond.sol  IFaultlinePool.sol  IFaultlineTrigger.sol  IHRC719.sol  IHederaScheduleService.sol
  mocks/         MockUSD.sol  MockBond.sol  MockHSS.sol
test/            pool.*.ts  trigger.*.ts  invariants.*.ts  helpers/
scripts/         deploy-local.ts  e2e-local.ts  testnet/*
oracle/src/      usgs.ts  rule.ts  terms.ts  attest.ts  hcs.ts  submit.ts  cli.ts
oracle/fixtures/ synthetic-*.json (labelled synthetic)
web/src/app/     investor / sponsor / trustee / replay
```

## 6. Git History (10 most recent commits)

```
3ac3040 docs: record spike prep findings (Hashio/Hardhat 3 provider issue, deployBond gas)
7f204b4 docs: record mock policy, spike order and fresh-account plan
438cadc docs: refine D2 - submission cutoff and redemption opening extend by paused time
411d35b docs: reflect investor hollow account and balances in spike plan
48edd0b docs: add origin-chat digest, record investor hollow account and balances
ca006a9 docs: add Hedera testnet spike plan
c960204 docs: apply D10 replay terms and magType list to architecture and handover
3efff65 docs: record D10 replay-terms decision and approved magType list
361bf3c docs: add sourced reference notes (ATS, Hedera, USGS, OZ, tooling) and real Bhuj USGS fixture
2413e91 docs: apply approved design decisions D1-D9 (per-event loss, sweepExcess, supply guard)
```

All commits so far are documentation-only ("prep session"). No code commits yet.
