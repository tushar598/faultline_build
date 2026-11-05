# ops/ — Hedera testnet operator scripts

Ported from the reference repo's `ops/` on 2026-11-06 with the new `FLH_*` accounts (docs/ACCOUNTS.md). Nothing from the
reference repo's old deployment is reused: no account, token, bond, pool, trigger or topic. Every id this folder
creates is recorded in docs/DEPLOYMENTS.md as soon as it exists.

Changes from the reference copy:

- Keystore names `FLH_*_PRIVATE_KEY` and networks `flh*` (one per account); the spike-era `HEDERA_PRIVATE_KEY` /
  `INVESTOR_PRIVATE_KEY` networks and their issuer/investor clients are gone, and every SDK step names its payer.
- The account table (`scripts/smoke/lib.ts` `ACCOUNTS`; `scripts/s7/s7.ts` reads it) holds the new ids and addresses.
- The dry-run stand-in bond: smoke phase 3 defers the pool simulation until phase 2 has deployed the bond, and demo
  phase 2 reads this repo's smoke-run bond instead of the old spike S1 bond.
- The demo's fUSD (`scripts/demo/lib.ts` `FUSD`) is the token this repo's smoke run creates; empty until then.
- The preflights only report the oracle's Hedera account (this repo's oracle key has one; no script pays from it).

| Path | What |
| --- | --- |
| `hardhat.config.ts` | Hardhat 3, the `testnetRead` network (no key) and one network per `FLH_*_PRIVATE_KEY` in the global keystore |
| `scripts/lib/` | RPC choice, dry-run/EXECUTE `step()`, evidence log, SDK and mirror-node helpers, ATS bond arguments |
| `scripts/smoke/` | Smoke run, phases 0 to 6: new fUSD, ATS bond, pool + trigger, invest, Bhuj event, settle; `smoke/lib.ts` is also the base of the demo library |
| `scripts/s7/` | Spike S7 (HCS topic keys); the demo reuses its key helpers |
| `scripts/demo/` | Full testnet demo, phases 0 to 7, and `rt02-holder-burn.ts` (written, not run) |
| `scripts/issuer/` | The two steps of the web issuer page a browser wallet cannot sign: `hcs-topic.ts` (TopicCreate, D16 keys) and `hts-kyc.ts` (TokenGrantKyc for the pool and investors) |
| `abi/` | ATS v8 factory, bond and error ABIs (public) |
| `out/` | Run state and evidence logs; gitignored |

The scripts read this repo directly: `../artifacts` (run `npm run compile` at the root first), `../shared/ts` (through the
`tsx` CommonJS loader, because `shared/ts` is CommonJS TypeScript), `../scripts/lib/bondAudit.ts`, `../oracle` (the real
CLI in a child process) and `../oracle/fixtures`.

Safety model: every script is a dry run unless `EXECUTE=1`; only the owner runs `EXECUTE=1`; keys come only from the
global Hardhat 3 keystore and are never printed or written. A dry run of demo phase 1 or phase 6 refreshes a timestamp in
`out/demo-state.json` (`topicVerifiedAt`, `settledAt`); nothing else.

```bash
npm run ops:setup                 # once (npm ci in ops/)
cd ops && npx hardhat keystore set FLH_DEPLOYER_PRIVATE_KEY   # owner, once per FLH_* name (8 names, docs/ACCOUNTS.md)
npm run compile                   # root build the scripts deploy and compare
cd ops && npx hardhat run --network testnetRead scripts/smoke/smoke-0-preflight.ts   # smoke phases 0..6
npm run ops:demo:0                # = cd ops && npx hardhat run --network testnetRead scripts/demo/demo-0-preflight.ts
EXECUTE=1 npm run ops:demo:1      # owner only
```

Commands and timing: docs/COMMANDS.md §11.
