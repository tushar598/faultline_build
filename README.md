# Faultline: practice workspace

**Practice workspace, not for submission.**

This repo copies the folder structure of `~/Desktop/faultline` (tracked files on `main`), with no source code. The folders are empty; this file is the only README. Read the real code in `~/Desktop/faultline`, read-only, and practise here.

These were left out on purpose: `node_modules/`, `artifacts/`, `cache/`, `out/`, `web/.next/`, `.planning/`, `ops/abi/` (ABI JSON dumps) and screenshots.

## Tree (2 levels)

```
.
├── contracts/
│   ├── interfaces/
│   └── mocks/
├── docs/
│   └── reference/
├── ops/
│   └── scripts/
├── oracle/
│   ├── fixtures/
│   ├── src/
│   └── test/
├── scripts/
│   └── lib/
├── shared/
│   └── ts/
├── test/
│   └── helpers/
└── web/
    ├── e2e/
    ├── public/
    ├── src/
    └── test/
```

Deeper folders (`ops/scripts/*`, `web/src/*`) mirror the source the same way.

## Suggested learning order

Before step 1, read `README.md`, `HANDOVER.md` and `docs/ARCHITECTURE.md` §1, §2 and §12 (decisions D1–D18) in the source.

1. **shared/ts: terms and attestation**
   Read: `shared/attestation.eip712.json`, `shared/ts/attestation.ts`, `shared/ts/jcs.ts`, `shared/ts/hcsMessage.ts`, ARCHITECTURE §6.1–§6.5.
   Question: which fields go into `termsHash` and which into `dataHash`, and why can a replay attestation never be accepted by a live bond (D10, D14)?

2. **contracts**
   Read: `contracts/interfaces/IFaultlinePool.sol`, `IFaultlineTrigger.sol`, then `contracts/FaultlineTrigger.sol` and `contracts/FaultlinePool.sol`, ARCHITECTURE §3–§5.
   Question: with two events pending, how does `execute` compute the new loss index, and when is an event `Superseded` (D1)?

3. **tests**
   Read: `test/helpers/fixtures.ts`, `test/pool.loss.test.ts`, `test/trigger.submit.test.ts`, `test/pool.supplyburn.test.ts`, `test/invariants.fuzz.test.ts`, `docs/TEST-INVENTORY.md`.
   Question: which supply check changed from strict equality under D18, and which test proves that a holder burn no longer blocks `redeem`?

4. **oracle**
   Read: `oracle/src/usgs.ts`, `rule.ts`, `decision.ts`, `attest.ts`, `ledger.ts`, `keeper.ts`, `service.ts`, `oracle/fixtures/README.md`, docs/COMMANDS.md §8.
   Question: what does the oracle do when an event that is already pending later fails the rule, and why does it not submit a revision (D15)?

5. **web dashboard**
   Read: `web/src/lib/phase.ts`, `web/src/lib/chain.ts`, `web/src/state/data.tsx`, `web/src/app/trustee/page.tsx`, `web/src/app/api/usgs/[id]/route.ts`, docs/COMMANDS.md §9.
   Question: how does the dashboard work out the bond phase while the trigger is paused (D2), and how does it pick the USGS record version that matches the chain?

6. **ops/: testnet scripts** (read only, never run with `EXECUTE=1`)
   Read: `ops/README.md`, `ops/scripts/lib/common.ts`, `ops/scripts/demo/demo-0-preflight.ts` to `demo-7-verify.ts`, `ops/scripts/issuer/hcs-topic.ts`, docs/COMMANDS.md §11, docs/TESTNET-EVIDENCE.md.
   Question: what stops a script from sending a transaction by accident, and which account signs HCS messages and which one pays for them (D16)?
