# Testnet deployments

Every public id this repo creates on Hedera testnet (chainId 296), recorded as soon as it exists. Everything here is new
(Rule 1): no token, bond, pool, trigger or topic of the reference repo's old deployment is reused. Accounts:
docs/ACCOUNTS.md. Transactions and fees: docs/TESTNET-EVIDENCE.md (written from `ops/out/evidence.jsonl`).

Public infrastructure used, not deployed by this repo (docs/reference/ats.md): ATS v8 factory proxy `0.0.9213391`
(`0xd1F118A40f3b02883D35909eF2517e7EDd78379d`) and BLR proxy `0.0.9212226` (`0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a`).

## Smoke run (ops/scripts/smoke)

| What | Hedera id | EVM address | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- | --- |
| fUSD stablecoin (HTS, 6 decimals) | not created yet (smoke-1) | | deployer | | |
| ATS bond | not created yet (smoke-2) | | deployer | | |
| FaultlinePool | not created yet (smoke-3) | | deployer | | |
| FaultlineTrigger | not created yet (smoke-3) | | deployer | | |

## Spike S7: HCS topic keys (ops/scripts/s7)

| What | Hedera id | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- |
| HCS topic (submit = oracle, admin = trustee) | not created yet | relayer | | |

## Full demo (ops/scripts/demo)

| What | Hedera id | EVM address | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- | --- |
| ATS demo bond | not created yet (demo-1) | | deployer | | |
| HCS topic | not created yet (demo-1) | | relayer | | |
| FaultlinePool | not created yet (demo-2) | | deployer | | |
| FaultlineTrigger | not created yet (demo-2) | | deployer | | |
