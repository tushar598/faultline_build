# Learning log

Fresh rebuild of Faultline, part by part. Reference (read only): `~/Desktop/faultline`.

## Part 1: shared/ts

### What shared/ts does

1. `shared/ts` is the code the contracts' tests, the deploy scripts, the oracle and the dashboard all share. Its only dependency is ethers.
2. `jcs.ts` turns a JSON value into one fixed text (RFC 8785): keys are sorted and numbers and strings have one form, so equal data always gives equal bytes.
3. `termsHash = keccak256(utf8(JCS(terms)))`. The trigger stores only this 32-byte hash of the bond's rules (Kutch box, depth, magTypes, 7.0 → 8.0 curve, cooling, mode, offset).
4. `mode` and `timeOffsetSec` are part of the terms, so a replay attestation can never match a live bond (D10). Replay terms are refused off chain except on 31337 and 296 (D14).
5. `dataHash` hashes only the stable USGS fields (§6.4), so volatile fields (felt, url, sig) do not change it but a scientific change does.
6. The acceptance rule (§6.2) checks: reviewed, earthquake, moment magType, inside the box, depth ≤ 70 km, cooling passed, magnitude above 7.0. `lossBps` follows the linear D13 curve (Bhuj M7.7 gives 7000).
7. The oracle signs the attestation as EIP-712 typed data (`shared/attestation.eip712.json`, domain `FaultlineTrigger` v1). The signature is bound to the chainId and the trigger address, and every field is typed.
8. The trigger rebuilds the same digest (`0x1901 ‖ domainSeparator ‖ structHash`), recovers the signer and accepts only the oracle's key. A plain signature over bytes would carry no domain and no field types.
9. `hcsMessage.ts` defines the message posted to the HCS topic. The oracle's signature sits inside the payload (D16), so anyone can verify who wrote it, whichever account paid for the HCS transaction.
10. Messages are `utf8(JCS(message))` and must fit one 1024-byte chunk. Attestations carry the EIP-712 signature; advisories (D15) carry an EIP-191 signature over the payload without the signature field.

### Owner's answers

- **Step 1** (do `{ mode, version }` and `{ version, mode }` give the same termsHash?): "Same hash. JCS sorts the keys, so both become `{"mode":"live","version":1}`: same bytes, same keccak256."
- **Steps 2–5**: check questions skipped at the owner's request ("just build").

### Comparison with the reference

Same behaviour and the same hashes. Computed with both repos' code: live Kutch termsHash
`0xa9e12f9506c4f841398afa6c12302f45b8fdd4216c3967fbe812d55e9859101e`; Bhuj dataHash
`0xd604b4f7132c25556c5acda8c97ef967af9ce458b017144bac0741ff02672730`; one sample EIP-712 digest is also equal.

| File | vs reference | Reason |
| --- | --- | --- |
| `shared/attestation.eip712.json`, `shared/ts/attestation.ts`, `shared/ts/hcsMessage.ts` | identical | |
| `shared/ts/jcs.ts` | comments only | header explains why canonical bytes matter; code is the same |
| `test/shared.jcs.test.ts`, `test/helpers/eip712.ts`, `scripts/lib/fixtures.ts` | identical | |
| `oracle/fixtures/*.geojson` (4 files) | identical | only the 4 fixtures Part 1 tests need |
| `oracle/fixtures/README.md` | shorter | lists only the 4 copied files |
| `test/shared.attestation.test.ts` | identical since Part 2 | in Part 1 the on-chain `hashAttestation` test was pending; Part 2 enabled it |
| `test/shared.terms.test.ts` | new | pins the termsHash values |
| `test/shared.eip712.test.ts` | new | rebuilds the EIP-712 digest by hand, off chain |
| `test/shared.hcs.test.ts` | new | HCS message tests; the reference has them in `oracle/test/hcs.test.ts` (vitest, with the publishers) |

Result: 35 passing, 1 pending; `tsc --noEmit` clean.

## Part 2: FaultlineTrigger

### What the trigger does

1. One trigger serves one pool. It stores `termsHash`, the `challengeWindow` (1 s to 30 days, D17), the oracle address, and copies `riskStart`, `maturity` and `grace` from the pool (D5).
2. `submit(att, sig)`: anyone may relay. The checks run in a fixed order: not paused → before `submissionDeadline()` → signature recovers to the oracle (EIP-712, low-s, 65 bytes) → not expired → `riskStart <= observedAt <= min(now, maturity)` → termsHash matches → `1 <= lossBps <= 10000` → status → pool not at 10000.
3. A new event goes `None → Pending`. A pending event can be revised, but only with a higher nonce AND a newer `usgsUpdatedAt`; a revision may lower the loss and restarts the window.
4. `Vetoed`, `Executed` and `Superseded` are final, so a public signature can never be replayed (`EventFinalised`).
5. The trustee may `veto` inside the window, even while paused. After the window anyone may `execute`: the pool's loss becomes `min(10000, L + lossBps)` (D1, each event carries only its own loss). If L is already 10000 the event becomes `Superseded`, with no revert, so it never blocks redemption.
6. Pause clock (D2): `effectiveTime()` stops while paused, so a pause never eats the window. `submissionDeadline() = maturity + grace + paused time`, so a pause never cuts off a real quake. Only the trustee pauses; only the admin unpauses.
7. Roles (D17): the admin unpauses and rotates the oracle, but cannot add or remove trustees. `TRUSTEE_ROLE` is its own admin, so trustees add a backup and remove each other.
8. The trigger holds no HBAR: there is no `receive()` and nothing is payable.

### How it is tested before the pool exists

The reference trigger tests run on the real FaultlinePool. Here `contracts/mocks/MockPool.sol` (local tests only) stands in for it. It has the same schedule, the same `initialize`/`applyLoss` checks and the same sponsor-credit maths `floor(U * L / 10000)`; `test/mocks.pool.test.ts` pins them. Lines that need real redemption (`redeem`, `sweepExcess`) are commented as `POOL PART` and one redemption-only test is skipped. The pool part switches the helpers back to the real pool and restores them.

### Comparison with the reference

| File | vs reference | Reason |
| --- | --- | --- |
| `contracts/FaultlineTrigger.sol`, `contracts/interfaces/*.sol` (3) | identical | |
| `test/trigger.setup`, `trigger.submit`, `trigger.execute`, `attestation.binding`, `shared.attestation` tests | identical | |
| `test/helpers/time.ts`, `roles.ts`, `eip712.ts` | identical | |
| `test/helpers/trigger.ts` | fixture uses MockPool | no `fundCoupons` / `invest` yet; U is fixed in MockPool instead |
| `test/helpers/pool.ts` | stand-in | MockPool fixture with the reference schedule and signer layout; replaced in the pool part |
| `test/trigger.pause`, `trigger.revision`, `trigger.griefing` tests | `POOL PART` lines | 11 redeem/sweep assertions commented out, 1 test skipped |
| `contracts/mocks/MockPool.sol`, `test/mocks.pool.test.ts` | new | local-only stand-in and its own test |

Result: 121 passing, 1 pending (the redemption-only griefing test); `tsc --noEmit` clean. Nothing deployed: a testnet trigger needs a pool, so its deploy script comes with the pool part.
