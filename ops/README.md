# ops/ — Hedera testnet operator scripts

Every id these scripts create on testnet is recorded in docs/DEPLOYMENTS.md as soon as it exists; the accounts and
their keystore names are in docs/ACCOUNTS.md.

| Path | What |
| --- | --- |
| `hardhat.config.ts` | Hardhat 3, the `testnetRead` network (no key) and one network per `FLH_*_PRIVATE_KEY` in the global keystore |
| `scripts/lib/` | RPC choice, dry-run/EXECUTE `step()`, evidence log, SDK and mirror-node helpers, ATS bond arguments |
| `scripts/smoke/` | Smoke run, phases 0 to 6: fUSD, ATS bond, pool + trigger, invest, Bhuj event, settle; `smoke/lib.ts` is also the base of the demo library |
| `scripts/s7/` | Spike S7 (HCS topic keys); the demo reuses its key helpers |
| `scripts/demo/` | Full testnet demo, phases 0 to 7, and `rt02-holder-burn.ts` (written, not run) |
| `scripts/issuer/` | The two steps of the web issuer page a browser wallet cannot sign: `hcs-topic.ts` (TopicCreate, D16 keys) and `hts-kyc.ts` (TokenGrantKyc for the pool and investors) and `oracle-replay.ts` (the oracle step for an issuer-page bond: Bhuj or the SYNTHETIC event, from the page's deployment entry; NOT testnet-verified) |
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
