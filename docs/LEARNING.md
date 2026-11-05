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
| `test/shared.attestation.test.ts` | one test pending | the on-chain `hashAttestation` check needs FaultlineTrigger (Part 2) |
| `test/shared.terms.test.ts` | new | pins the termsHash values |
| `test/shared.eip712.test.ts` | new | rebuilds the EIP-712 digest by hand, off chain |
| `test/shared.hcs.test.ts` | new | HCS message tests; the reference has them in `oracle/test/hcs.test.ts` (vitest, with the publishers) |

Result: 35 passing, 1 pending; `tsc --noEmit` clean.
