# Tooling — Hardhat 2 testing patterns

Verified 2026-10-25 against installed packages: `hardhat@2.29.1`,
`@nomicfoundation/hardhat-network-helpers@1.1.2`, `@nomicfoundation/hardhat-chai-matchers@2.1.2`,
`fast-check@4.10.2`. Docs: <https://v2.hardhat.org/hardhat-network-helpers/docs/reference>,
<https://v2.hardhat.org/hardhat-chai-matchers/docs/reference>, <https://fast-check.dev/>.

## 1. Network helpers ✅ (exports checked in node_modules)

```ts
import { time, mine, setCode, setBalance, impersonateAccount, stopImpersonatingAccount,
         setStorageAt, getStorageAt, takeSnapshot, loadFixture, reset } from "@nomicfoundation/hardhat-network-helpers";
```

| Need | Call |
| --- | --- |
| Current block time | `await time.latest()` |
| Jump forward N seconds (mines a block) | `await time.increase(n)` |
| Jump to a timestamp (mines a block) | `await time.increaseTo(ts)` |
| Set the next tx's timestamp exactly | `await time.setNextBlockTimestamp(ts)` then send the tx |
| Durations | `time.duration.hours(6)`, `.days(30)` |
| Reuse a deployed world per test | `const f = await loadFixture(deployFixture)` (fixture must be a named function) |
| Snapshot / revert inside a test | `const s = await takeSnapshot(); …; await s.restore()` |

Time travel only goes **forward**. To start the chain in the past (e.g. for replay demos) set
`networks.hardhat.initialDate` (ISO string) in `hardhat.config.ts` ✅ (field exists in
`hardhat/types/config.d.ts`).

## 2. Mock at a fixed address (`0x16b`) ✅ tested

Tested 2026-10-25 in a throwaway project: a mock's runtime bytecode placed at `0x16b` answered
`scheduleCall` with `(22, 0x…1234)`.

```ts
const mock = await (await ethers.getContractFactory("MockHSS")).deploy();
await setCode("0x000000000000000000000000000000000000016b",
              await ethers.provider.getCode(await mock.getAddress()));
```

`setCode` copies **runtime code only**: constructor-set storage is not copied (immutables are, they
live in the bytecode). Keep the mock stateless, or initialise storage with `setStorageAt`, or give it
an `init()` function called after `setCode`. Same pattern works for an HTS `0x167` mock if ever needed.

## 3. Chai matchers ✅

```ts
await expect(tx).to.be.revertedWithCustomError(contract, "ErrorName").withArgs(a, b);
await expect(tx).to.emit(contract, "Event").withArgs(…);
await expect(tx).to.changeTokenBalances(token, [a, b], [-x, x]);
await expect(tx).to.not.be.reverted;
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
```

## 4. Property tests (fast-check) ✅ API present

- Pure maths (sponsor credit, floors, coupon index): `fc.assert(fc.property(arbs…, (…) => { … }))`
  with `fc.bigInt({ min, max })`, `fc.integer`, `fc.array`.
- On-chain sequences: `await fc.assert(fc.asyncProperty(arbs, async (…) => { … }), { numRuns: 50 })`;
  restore a snapshot at the start of each run (`takeSnapshot` / `restore`) so runs are independent.
- Model-based (stateful) invariants: `fc.commands([...])` + `fc.asyncModelRun(setup, cmds)`. Each
  command (invest, transfer, submit, veto, pause, unpause, advanceTime, execute, redeem, claim,
  sweepExcess) has `check(model)` and `run(model, real)`; after every command assert invariants 1–10
  from docs/ARCHITECTURE.md §5.
- Keep `numRuns` small in CI (20–50) and allow `FC_RUNS` env override for deep local runs; print the
  seed on failure (`fc.assert(..., { seed, verbose: true })`) so failures replay.

## 5. EIP-712 signing in tests

```ts
const [, , , , , , d] = await trigger.eip712Domain(); // or build: { name, version, chainId, verifyingContract }
const domain = { name: "FaultlineTrigger", version: "1", chainId: 31337, verifyingContract: await trigger.getAddress() };
const types = { Attestation: [ { name: "eventId", type: "bytes32" }, { name: "lossBps", type: "uint16" },
  { name: "magnitudeX100", type: "uint16" }, { name: "observedAt", type: "uint64" },
  { name: "usgsUpdatedAt", type: "uint64" }, { name: "nonce", type: "uint64" },
  { name: "termsHash", type: "bytes32" }, { name: "dataHash", type: "bytes32" }, { name: "deadline", type: "uint64" } ] };
const sig = await oracle.signTypedData(domain, types, value);
```

The oracle service must import the same `types` object from one shared file
(`oracle/src/attestation-types.ts`) that the tests also import, so they can never drift.

## 6. Coverage, gas, static analysis

- `npm run coverage` (solidity-coverage 0.8.17), `npm run test:gas` (hardhat-gas-reporter 1.0.10).
- Slither: not installed; needs Python ≥ 3.10 (Mac has 3.9.6). Install for the security review:
  `brew install python@3.12 && python3.12 -m pip install --user slither-analyzer` (❓ not run yet).
  ATS ships a `slither.config.json` worth copying ideas from.

## 7. Known gotchas

- zsh: quote globs (`--include='*.sol'`), `?` in URLs must be quoted.
- Hardhat 2 has no encrypted keystore; testnet key via `read -s HEDERA_TESTNET_PK` (docs/COMMANDS.md §5).
- TypeScript stays on 5.9.3 (ts-node); npm `latest` is TS 7.
- Next.js 16 changed APIs: read `web/node_modules/next/dist/docs/` before dashboard code (`web/AGENTS.md`).
