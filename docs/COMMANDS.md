# Commands

Exact commands, in order, from an empty folder to a green run. Keep this file current: Phase 2
(clean rebuild) replays it top to bottom. Verified on the owner's Mac (macOS, arm64, Node 24.16.0,
npm 11.13.0) on 2026-10-25.

## 0. Prerequisites

```bash
node -v      # >= 22 (tested: v24.16.0)
npm -v       # tested: 11.13.0
git --version
```

## 1. Fresh clone (repo already scaffolded)

```bash
npm run setup          # npm ci in root, oracle/ and web/
npm run check          # compile + test + typecheck + oracle typecheck + web lint + web build
```

## 2. Scaffold from an empty folder (what Phase 1 did)

```bash
mkdir faultline && cd faultline
mkdir -p contracts/mocks contracts/interfaces test scripts oracle/src oracle/fixtures oracle/test docs/reference docs/PROMPTS
# write .gitignore FIRST (env files, keystores, *.vc, node_modules, artifacts, cache, typechain-types, .next)
git init -b main
```

Root (Hardhat 2 + contracts):

```bash
npm init -y
npm i -D --save-exact hardhat@2.29.1 @nomicfoundation/hardhat-ethers@3.1.3 \
  @nomicfoundation/hardhat-chai-matchers@2.1.2 @nomicfoundation/hardhat-network-helpers@1.1.2 \
  ethers@6.17.0 chai@4.5.0 @types/chai@4 @types/mocha @types/node@22.20.5 \
  typescript@5.9.3 ts-node@10.9.2 typechain@8 @typechain/hardhat@9 @typechain/ethers-v6@0.5 \
  solidity-coverage@0.8.17 hardhat-gas-reporter@1.0.10 fast-check@4.10.2
npm i --save-exact @openzeppelin/contracts@5.6.1
```

Then write `hardhat.config.ts` (solc 0.8.28, `evmVersion: "cancun"`, optimizer 200, networks
`hardhat` chainId 31337 + `hederaTestnet` chainId 296) and `tsconfig.json`.

Oracle (TypeScript, ESM):

```bash
cd oracle && npm init -y
npm i --save-exact ethers@6.17.0 @hashgraph/sdk@2.81.0 zod@4.6.7
npm i -D --save-exact typescript@5.9.3 tsx@4.23.15 vitest@5.0.5 @types/node@22.20.5
cd ..
```

Dashboard (Next.js, owner's choice):

```bash
npx --yes create-next-app@16.4.3 web --ts --app --eslint --tailwind --src-dir \
  --import-alias "@/*" --use-npm --disable-git --yes
npm --prefix web i --save-exact ethers@6.17.0
# then set turbopack.root = path.resolve(__dirname) in web/next.config.ts (two lockfiles warning)
```

## 3. Proof the setup works (expected output)

```bash
npx hardhat --version            # 2.29.1
npx hardhat compile              # Compiled N Solidity files successfully (evm target: cancun); OZ prints a
                                 # TSTORE warning for ReentrancyGuardTransient (expected, safe for a guard)
npx hardhat test                 # 203 passing on 2026-10-30 (interfaces + mocks + pool + trigger + shared/ts + local e2e + security)
npm run typecheck                # no output = OK
npm run oracle:typecheck         # no output = OK
npm run oracle:test              # 83 passed, 1 skipped (the opt-in live USGS test)
npm run web:test                 # 44 passed
npm run web:build                # ✓ Compiled successfully
npm run check                    # all of the above in one go
```

## 4. Daily scripts (root package.json)

| Script | What it does |
| --- | --- |
| `npm run compile` | Compile contracts + generate typechain types |
| `npm test` | Hardhat tests on the in-process chain |
| `npm run test:gas` | Tests with gas report |
| `npm run coverage` | solidity-coverage |
| `npm run node` | Local Hardhat JSON-RPC node on 127.0.0.1:8545 |
| `npm run oracle:test` | Oracle unit tests (vitest) |
| `npm run web:dev` | Dashboard dev server (http://localhost:3000) |
| `npm run web:test` | Dashboard unit tests (vitest; part of `npm run check`) |
| `npm run web:e2e` | Dashboard Playwright smoke test on a Hardhat node (starts one if needed; ~2 min) |
| `npm run dashboard:demo:local` | Live demo world for the dashboard on a running node (see §9) |
| `npm run check` | Everything, used before every commit (includes `npm run ops:typecheck` since 2026-11-03) |
| `npm run ops:setup` | `npm ci` in `ops/` (Hardhat 3 testnet scripts; also part of `npm run setup`) |
| `npm run ops:demo:0` … `npm run ops:demo:7`, `npm run ops:demo:rt02` | Full testnet demo phases from `ops/` (§11). Dry run unless `EXECUTE=1`, which only the owner runs |
| `npm run ops:typecheck` | `tsc --noEmit` over `ops/` |
| `npx hardhat test test/mocks.test.ts` | Mock rules only (MockBond, MockUSD, MockHTS at 0x167, MockTrigger) |
| `npx hardhat test test/interfaces.test.ts` | Role ids vs docs/reference/ats.md §3; Attestation fields vs ARCHITECTURE §6.1 and shared/attestation.eip712.json |
| `npx hardhat test test/pool.*.test.ts` | FaultlinePool only (setup, fund, invest, loss, redeem, claim, sweep, reentrancy); zsh: quote the glob or list files |
| `npm run e2e:local` | Local end-to-end, **mock-tested, local only**: 3 fresh bonds (Flow A veto + replay, Flow B two events L = 9000, Flow C cap + Superseded) on the in-process chain, real Bhuj fixture + SYNTHETIC Kutch events; prints every step and a summary |
| `npm run node` then `npx hardhat run scripts/e2e-local.ts --network localhost` | Same e2e against a local Hardhat node (runs again on the same node: each flow deploys fresh) |
| `npx hardhat test test/e2e.local.test.ts` | The three flows with independent numeric checks (part of `npm test`) |
| `npm run oracle:test` | Oracle vitest; proves the oracle (ESM) can import `shared/ts` (part of `npm run check` since 2026-10-26) |
| `npx hardhat test test/trigger.*.test.ts` | FaultlineTrigger only (setup/EIP-712, submit, revision/replay, veto/pause/D2, execute/D1/rotation, integration with the real pool) |
| `FC_RUNS=200 npx hardhat test test/pool.loss.test.ts` | Deeper run of the on-chain fast-check sponsor-credit property (default 15 runs) |
| `FC_RUNS=400 FC_OPS=30 FC_SEED=<seed> npx hardhat test test/invariants.fuzz.test.ts` | Stateful fuzz (RT-06), model against the chain, default 8 sequences of up to 14 operations per phase; prints seeds, transaction counts and the revert reasons reached. **Mock-tested** |
| `npx hardhat coverage --testfiles "test/pool.*.test.ts"` | Coverage for the pool tests (2026-10-26: lines 134/134, functions 23/23, branches 95/96) |
| `npm run coverage` | Whole suite (2026-10-26: FaultlinePool 134/134 lines, 23/23 fns, 95/96 branches; FaultlineTrigger 83/83, 14/14, 72/72) |

`ops/scripts/demo/rt02-holder-burn.ts` (`npm run ops:demo:rt02`) is RT-02: a mined holder burn for the next deployment of a build with D18,
between demo phases 3 and 6. Written, **not run**; it refuses a pre-D18 deployment. Owner only, with `EXECUTE=1` after a dry run.

## 5. Testnet key (only when a testnet task needs it)

```bash
read -s HEDERA_TESTNET_PK && export HEDERA_TESTNET_PK   # typed in YOUR terminal, never in chat
npx hardhat run scripts/<script>.ts --network hederaTestnet
unset HEDERA_TESTNET_PK                                   # when done
```

## 6. Local end-to-end (mock-tested, local only)

```bash
npm run e2e:local
# or, against a node:
npm run node                                            # terminal 1
npx hardhat run scripts/e2e-local.ts --network localhost  # terminal 2
```

Expected summary (2026-10-26; addresses and timestamps differ per run, the numbers do not):

```
Flow A (veto + replay): L 0 bps, sponsor credited 0.000000 (claimed 0.000000 incl. unused reserve), leftover 0.000000
  A: 5,000.000000 units → 5,000.000000 principal + 300.000000 coupon   (B 3,000 + 180, C 2,000 + 120)
Flow B (two events, partial loss): L 9000 bps, sponsor credited 9,000.000000 (claimed 9,405.903285 incl. unused reserve), leftover 0.000000
  A: 500.000000 principal + 97.048358 coupon   (B 300 + 58.229014, C 200 + 38.819343)
Flow C (cap + Superseded): L 10000 bps, sponsor credited 10,000.000000 (claimed 10,538.765900 incl. unused reserve), leftover 0.000000
  A: 0.000000 principal + 30.617050 coupon   (B 0 + 18.370230, C 0 + 12.246820)
  paid out 10,600.000000 == deposits 10,000.000000 + coupon reserve 600.000000   (every flow)
```

Coupon figures in Flows B and C depend on the exact second of each `execute` (one block per transaction), so they
can move by a few base units if the flow's steps change; the test recomputes them from the execute timestamps.

## 7. Testnet smoke run (HANDOVER §10 step 5b; testnet-verified 2026-10-26)

Runs from `ops/` in this repo (Hardhat 3 + global encrypted keystore) against the root build and `shared/ts`. The run of
2026-10-26 used these scripts from the spikes repo (commits `2fa20a8`…`376c745`; archived at `~/Desktop/faultline-spikes`, last commit `b527729`); they
moved to `ops/` on 2026-11-03 and have not been re-run on testnet from there. Every script is a **dry run** unless `EXECUTE=1`; only the owner runs `EXECUTE=1`,
and each run asks for the keystore password once. State: `ops/out/smoke-state.json` (resumable: finished steps skip);
evidence: `ops/out/evidence.jsonl`. Accounts and keystore names: docs/TESTNET-EVIDENCE.md "Faultline accounts".

```bash
cd ~/Desktop/faultline && npm run compile          # the build the smoke run deploys (preflight records its keccak)
npm run ops:setup
cd ops
R="npx hardhat run --network testnetRead"           # plain ethers on Hashio; the network name only picks no key

$R scripts/smoke/smoke-0-preflight.ts                # no tx: accounts, build hashes, live USGS dataHash, HBAR estimate
CHECK_KEYS=1 $R scripts/smoke/smoke-0-preflight.ts   # owner: every FL_* key derives to its documented address

# Each line: run it without EXECUTE first (dry run), then with EXECUTE=1.
EXECUTE=1 $R scripts/smoke/smoke-1-token.ts          # HTS fUSD (hollow deployer pays), holders associate/KYC/fund
                                                     # fallback only if TokenCreate refuses a hollow payer: PHASE=complete
# Phases 2 → 5 back to back (phase 3 must start <= 29 min after the bond deploy with BOND_MATURITY_MIN=45):
BOND_MATURITY_MIN=45 EXECUTE=1 $R scripts/smoke/smoke-2-bond.ts     # ATS v8 bond, addIssuer, bond KYC for A/B
BOND_MATURITY_MIN=45 EXECUTE=1 $R scripts/smoke/smoke-3-deploy.ts   # pool + trigger, initialize, pool KYC, roles, D4 asserts
EXECUTE=1 $R scripts/smoke/smoke-4-subscribe.ts      # inside the 13-min issuance window; aborts if < 180 s left
EXECUTE=1 $R scripts/smoke/smoke-5-event.ts          # waits for observedAt, hashAttestation gate, submit, 60 s, execute
EXECUTE=1 $R scripts/smoke/smoke-6-settle.ts         # after submissionDeadline(): redeem, claim, sweeps, final books
```

Expected end (2026-10-26 run): L = 7000; A claims 180.000664, B 120.000442, sponsor 700.998894; total 1,001.000000 =
1,000 deposits + 1 reserve; pool ends at 0; ≈ 35 HBAR in total (deployer ≈ 28.3). If any tx fails: stop, do not
retry, read `ops/out/evidence.jsonl` (`REJECTED_PRECHECK` = no tx hash; `FAILED` = at consensus, with the mirror fee).

## 8. Oracle (mock HCS, local only — HANDOVER §10 step 6)

```bash
npm run oracle:test                      # offline vitest suite (part of npm run check)
npm --prefix oracle run test:live        # opt-in: live USGS usp000a8ds dataHash == fixture (network)
npm run oracle:e2e:local                 # starts a Hardhat node if needed; Bhuj replay, keeper, D15, D8 (mock HCS)
ORACLE_E2E_LIVE=1 npm run oracle:e2e:local   # + one `watch --once` against the live USGS API
```

By hand on a running node (`npm run node` in another terminal):

```bash
npm run deploy:local                     # world + oracle/config.local.json + oracle/terms/local.json (both gitignored)
cd oracle
export HARDHAT_ACCOUNT_ORACLE=3 HARDHAT_ACCOUNT_RELAYER=4   # LOCAL ONLY: Hardhat's public test accounts (refused on any other chain)
npm run verify-config                    # refusal gate: chainId, termsHash, ATTESTATION_TYPEHASH, D14, oracle key
npm run replay -- --usgs-event usp000a8ds --offline   # or --fixture synthetic-….geojson; live fetch without --offline
npm run keeper -- --once                 # execute pending events whose window is complete
npm run status -- usp000a8ds             # chain record + ledger entry
npm run watch                            # box search + D15 pending loop; Ctrl-C stops cleanly (--once for one cycle)
```

On testnet (step 9) the keys are typed into the session, never into a file:

```bash
read -s ORACLE_PRIVATE_KEY && export ORACLE_PRIVATE_KEY
read -s RELAYER_PRIVATE_KEY && export RELAYER_PRIVATE_KEY
```

Spike S7 (HCS topic keys, testnet, owner runs EXECUTE):

```bash
cd ops                                         # moved from the spikes repo on 2026-11-03 (reference; S7 is done)
CHECK_KEYS=1 npx hardhat run scripts/s7/00-preflight.ts --network testnetRead
npx hardhat run scripts/s7/s7-hcs-keys.ts --network testnetRead              # dry run
EXECUTE=1 npx hardhat run scripts/s7/s7-hcs-keys.ts --network testnetRead    # create, publish, wrong, rotate
```

## 9. Dashboard (HANDOVER §10 step 7 — local flows mock-tested; testnet read + one MetaMask write verified in step 9)

```bash
npm --prefix web ci                       # once (part of npm run setup)
npx --prefix web playwright install chromium   # once, for the smoke test only

npm run node                              # terminal 1: Hardhat node on 127.0.0.1:8545
npm run dashboard:demo:local              # terminal 2: demo world + Bhuj replay pending + SYNTHETIC D15 advisory
npm run web:dev                           # terminal 3: open http://localhost:3000 (Overview), /replay, /trustee …
```

`dashboard:demo:local` deploys the local world (it rewrites oracle/config.local.json, which the dashboard reads
through `/api/local/config`), moves chain time past the replayed events, runs the oracle CLI (Bhuj `usp000a8ds` from
the saved REAL record → mock HCS → submit; `synthetic-kutch-3` → pending, then its out-of-box revision → signed
advisory), and turns on **interval mining (one block every 2 s)** so chain time moves while you watch. Options:
`DEMO_WINDOW_SEC` (challenge window, default 300 s; the e2e profile stays 48 h) and `DEMO_ADVISORY=0`. Plain
`npm run deploy:local` also works (no pending events, nothing mined between transactions).

**Sign in / Sign out.** There is no account or server session: signing in means the wallet shares an address with the site
("Sign in with wallet" in the header). "Sign out" calls `wallet_revokePermissions` where the wallet supports it and also keeps
the choice in this browser's localStorage, so a reload stays signed out even if the wallet still answers `eth_accounts`. It is
disabled while a transaction runs. Mock-tested only: the Playwright test uses a test wallet, never MetaMask on testnet.

Wallet on the local chain: add network 31337 / `http://127.0.0.1:8545` in MetaMask and import the Hardhat **test**
accounts printed by `npm run node` (public, test-only keys; never use them anywhere else): admin #0, sponsor #1,
trustee #2 (backup trustee #8, D17), investors A/B/C #5/#6/#7. In the demo, veto the SYNTHETIC event as the trustee, then press Execute on
Bhuj after the window (any account) or run the keeper:
`cd oracle && HARDHAT_ACCOUNT_ORACLE=3 HARDHAT_ACCOUNT_RELAYER=4 npm run keeper -- --once`.

```bash
npm run web:test                          # vitest (needs `npm run compile` first for the ABI test)
npm run web:e2e                           # Playwright (11 tests, 2 of them the issuer page): builds the app, runs the demo world with a 90 s window,
                                          # vetoes and executes through a TEST-ONLY node wallet (unlocked Hardhat accounts),
                                          # asserts each write sends gas = estimate x 1.3,
                                          # screenshots → web/e2e/screenshots/ (gitignored)
```

Testnet mode: choose "Hedera testnet (296)" in the sidebar (the choice is per browser). It reads the full-demo bond
(trigger `0xED64…667A`), the topic `0.0.11195949` and contract logs from the mirror node. The RPC tries Hashio, then
thirdweb, by an `eth_chainId` probe; `NEXT_PUBLIC_TESTNET_RPC_URL=<relay> npm run web:dev` points it elsewhere (both relays
answered the browser CORS preflight on 2026-10-30). Verified in step 9 with Hashio; the thirdweb fallback was not exercised.

### Issuer page (`/issuer`, added 2026-11-03: local mock-tested, testnet NOT testnet-verified)

Launches a new bond from the dashboard with the connected wallet as admin. No contract change: it deploys the root build
(`npm run compile` before `npm run web:build`; the page shows the keccak of what it will deploy and compares it with what each
deployment carried).

```bash
# Local (MockBond + MockUSD; the MockUSD admin, Hardhat account #0, signs the stablecoin KYC steps)
npm run node                              # terminal 1
npm run deploy:local                      # terminal 2: the world whose MockUSD the page uses
npm run web:dev                           # terminal 3: http://localhost:3000/issuer, wallet = Hardhat account #0 (test key only)
```

1. Parties (sponsor, oracle, trustee, investors and the optional backup trustee default to the node's test accounts #1, #3, #2,
   #5, #6 and #8), terms (a), schedule (b).
2. "Start the launch", then each step's button in order. The optional "Backup trustee" step (D17) must be signed by the trustee
   wallet (account #2 locally): open `/issuer` with that wallet in the same browser, run the step, then reload the admin's tab;
   any other wallet is refused before anything is sent. "Skip" leaves one trustee, and the audit then shows a warning. Progress stays in this browser (`faultline.issuer.wizard.<chainId>`),
   so a reload resumes. "Reset launch" forgets it (contracts stay on chain).
3. After the audit: "Open this bond in the dashboard". The header's Bond selector switches every view between the built-in
   bond and "my deployments" (`faultline.deployments` in localStorage).

On Hedera testnet (296) the topic and the two HTS KYC steps cannot be signed by a browser wallet (docs/LESSONS.md "Issuer
page"); the page prints the commands with the values filled in, the owner runs them, then presses "Check":

```bash
SUBMIT_EVM=<oracle> ADMIN_EVM=<trustee> PAYER_EVM=<relayer> MEMO=faultline-<symbol> npm run ops:issuer:topic            # dry run
EXECUTE=1 SUBMIT_EVM=… npm run ops:issuer:topic                                                                          # owner
TOKEN=0.0.11181839 ACCOUNTS=<pool>[,<investor>…] KYC_EVM=<KYC key holder> npm run ops:issuer:kyc                       # dry run
EXECUTE=1 TOKEN=… npm run ops:issuer:kyc                                                                                 # owner
```

The keystore entries default to `flOracle`, `flTrustee`, `flRelayer` (topic) and `flDeployer` (KYC); `SUBMIT`, `ADMIN`, `PAYER`
and `KYC` pick other networks of `ops/hardhat.config.ts`. Both scripts refuse a key that does not derive to the address given.
Tests: `npm run web:test` (terms, schedule, wizard, deployments, ATS facts, audit copy, ops commands) and `web/e2e/issuer.spec.ts`
(part of `npm run web:e2e`). The testnet run is RT-29 in docs/REMAINING-TESTS.md.

## 10. Security review (HANDOVER §10 step 8 — self-review, not an audit)

```bash
# Slither 0.11.4 in a throwaway venv (system Python 3.9 works); compile first so it reuses Hardhat's artifacts
python3 -m venv /tmp/slither-venv && /tmp/slither-venv/bin/pip install slither-analyzer==0.11.4 crytic-compile==0.3.11
npm run compile && /tmp/slither-venv/bin/slither . --hardhat-ignore-compile --filter-paths node_modules

npm run coverage                                   # after D17: pool 97/98 branches (nonReentrant re-entry of redeem), trigger 74/74
npm audit --omit=dev; npm --prefix oracle audit --omit=dev; npm --prefix web audit --omit=dev

brew install gitleaks                              # 8.30.1
gitleaks git ~/Desktop/faultline --redact; gitleaks git ~/Desktop/faultline-spikes --redact     # history (spikes = archive)
gitleaks dir ~/Desktop/faultline --redact          # working tree (hits under web/.next are build output)

npx hardhat test test/security.contracts.test.ts   # PoCs for the open findings (part of npm test)
SECURITY_VERBOSE=1 npx hardhat test test/security.contracts.test.ts   # prints why each open finding reproduces
```

## 11. Full testnet demo (HANDOVER §10 step 9; testnet-verified 2026-10-27/28)

Runs from `ops/` against the root build, `shared/ts` and the real `oracle/` CLI. **The 2026-10-27/28 run used these scripts
from the spikes repo (commit `b527729` and earlier, archived at `~/Desktop/faultline-spikes` with its `out/` evidence);
they moved to `ops/` on 2026-11-03, dry runs from `ops/` print the same as the spikes copy, and no transaction has been
sent from `ops/` yet.** Every script is a **dry run** unless `EXECUTE=1`; only the owner runs `EXECUTE=1`, and each run
asks for the keystore password once. State: `ops/out/demo-state.json` (resumable: finished steps skip; a new deployment
needs a fresh state file, so move the old one aside first); oracle config, terms and ledger: `ops/out/demo/`; evidence:
`ops/out/evidence.jsonl`, which holds script-sent transactions only (use the mirror node for the whole run). Accounts:
docs/TESTNET-EVIDENCE.md "Faultline accounts". The relay is `FL_RPC_URL` (comma list), else Hashio then thirdweb.

```bash
cd ~/Desktop/faultline && git status --short && npm run compile   # clean tree: the build recorded by the preflight
npm run ops:setup && cd ops                                      # or from the root: npm run ops:demo:N
R="npx hardhat run --network testnetRead"

CHECK_KEYS=1 $R scripts/demo/demo-0-preflight.ts                  # no tx: accounts, keys derive to addresses, build, budget

# Each line: run it without EXECUTE first (dry run), then with EXECUTE=1.
EXECUTE=1 $R scripts/demo/demo-1-bond-topic.ts                    # HCS topic, ATS bond, addIssuer, bond KYC for A/B
EXECUTE=1 $R scripts/demo/demo-2-deploy.ts                        # pool + trigger + wiring + backup trustee: THE CLOCK STARTS
EXECUTE=1 $R scripts/demo/demo-3-subscribe.ts                     # sponsor funds the reserve; A invests 300, B invests 200
SEND_REVERT=1 EXECUTE=1 $R scripts/demo/demo-4-flow-a.ts          # SYNTHETIC: oracle → pause → veto → unpause → replay rejected
EXECUTE=1 $R scripts/demo/demo-5-flow-b.ts                        # live Bhuj: oracle → 120 s window → keeper → L = 7000
EXECUTE=1 $R scripts/demo/demo-7-verify.ts                        # Sourcify; publishes the source; no Hedera tx, no HBAR
PART=a EXECUTE=1 $R scripts/demo/demo-6-settle.ts                 # after the deadline: A redeem + claim, sponsor claims 350
# dashboard (below): investor B redeems and claims with MetaMask
PART=sweep EXECUTE=1 $R scripts/demo/demo-6-settle.ts             # sweepExcess, sweepDust, sponsor claim, final books
```

Timing limits (the schedule is demo-only; each phase prints its own deadline):

| Phase | When | Limit |
| --- | --- | --- |
| 1 → 2 | start phase 2 soon after the bond | within ~29 min of the bond deploy with the default `BOND_MATURITY_MIN=45` |
| 2 | sets `t` = latest block | issuance `t + 2 min` → `t + 15 min`; risk period at least 20 min; grace 3 min. Schedule, replay offset and termsHash are recomputed at send: never copy them from a dry run |
| 3 | inside the 13 min issuance window | aborts with nothing sent if under `MIN_REMAINING_SEC` (180 s) is left |
| 4 | from riskStart + 120 s, before `submissionDeadline()` | waits up to `MAX_WAIT_SEC` (900 s). The pause is presigned and broadcast the moment the oracle prints `submit nonce 1 mined`. If it lands after the window the script stops with the trigger paused: do not unpause, report it |
| 5 | after Flow A verified, before `submissionDeadline()` | the 120 s window runs inside the script |
| 7 | any time, same build | stops unless the local artifacts equal the deployed build; runs a publication gate first |
| 6 `PART=a` | after `submissionDeadline()` + 1 s; the deadline moves later by the paused time | waits up to `MAX_WAIT_SEC`. Refuses while paused or with an event pending |
| dashboard | after `PART=a` | no limit |
| 6 `PART=sweep` | after B redeemed and claimed | refuses otherwise. `B_BY_SCRIPT=1` with `PART=a` does B's two transactions by script if the dashboard fails |

Dashboard step:

```bash
cd ~/Desktop/faultline && npm run web:build && npm --prefix web start     # http://localhost:3000; the build the run used
```

1. Choose "Hedera testnet (296)" in the sidebar.
2. Set the wallet to Hedera Testnet: RPC `https://testnet.hashio.io/api`, chain id 296, currency HBAR, explorer
   `https://hashscan.io/testnet`, account investor B (`0x6723…0A68`). In Brave, first set `brave://settings/wallet` →
   Default Ethereum wallet → "Extensions (no fallback)".
3. Open Investor, press "Sign in with wallet", press Redeem, then Claim. B receives 60.000299 fUSD.

Expected end (2026-10-27/28 run): L = 7000; A claims 90.000448, B 60.000299, sponsor 350.999253; total 501.000000 = 500
deposits + 1 reserve; pool fUSD 0, bond supply 0, `totalClaimable` 0, `isSolvent()` true; both contracts `exact_match`;
≈ 21 HBAR. If a transaction fails: stop, do not retry, read the mirror node. A second run from a fresh state file has
not been tried.
