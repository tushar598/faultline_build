# Testnet deployments

Every public id this repo creates on Hedera testnet (chainId 296), recorded as soon as it exists. Everything here is new
(Rule 1): no token, bond, pool, trigger or topic of the reference repo's old deployment is reused. Accounts:
docs/ACCOUNTS.md. Transactions and fees: docs/TESTNET-EVIDENCE.md (written from `ops/out/evidence.jsonl`).

Public infrastructure used, not deployed by this repo (docs/reference/ats.md): ATS v8 factory proxy `0.0.9213391`
(`0xd1F118A40f3b02883D35909eF2517e7EDd78379d`) and BLR proxy `0.0.9212226` (`0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a`).

## Smoke run (ops/scripts/smoke)

| What | Hedera id | EVM address | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- | --- |
| fUSD stablecoin "Faultline Test USD" (HTS, 6 decimals, 10,000 initial supply to the treasury; admin/supply/KYC key = deployer; no wipe/freeze/pause key) | [`0.0.11329874`](https://hashscan.io/testnet/token/0.0.11329874) | `0x0000000000000000000000000000000000aCe152` | deployer (SDK, hollow payer completed by this tx) | 2026-11-05 20:43 | [`0.0.11329142@1793911374.245778606`](https://hashscan.io/testnet/transaction/1793911378.334957104) |
| ATS bond | not created yet (smoke-2) | | deployer | | |
| FaultlinePool | not created yet (smoke-3) | | deployer | | |
| FaultlineTrigger | not created yet (smoke-3) | | deployer | | |

### Smoke run transactions

Times are UTC. Fee = the mirror node's `charged_tx_fee`.

| Phase | What | Signer | Gas used | Fee (HBAR) | Tx | Date (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TokenCreate fUSD (memo "Faultline smoke run - TESTNET ONLY, no value"); completes the hollow deployer | deployer (SDK) | | 15.0486 | [`0.0.11329142@1793911374.245778606`](https://hashscan.io/testnet/transaction/1793911378.334957104) | 2026-11-05 20:43 |
| 1 | sponsor `IHRC719(fUSD).associate()` (first signed tx: completes the hollow account) | sponsor | 726,488 | 0.9081 | [`0xcfca2a7f…6b1a3018`](https://hashscan.io/testnet/transaction/0xcfca2a7feb0db020b35889667113353b9a73c80d8eb3a6e9682d75096b1a3018) | 2026-11-05 20:43 |
| 1 | investor A `associate()` (completes the hollow account) | investor A | 726,488 | 0.9081 | [`0x6d4a3bb7…fe4adcdb`](https://hashscan.io/testnet/transaction/0x6d4a3bb74039fb302124d232b92d6985e8d66a554e0d7a18e5bbd3fdfe4adcdb) | 2026-11-05 20:43 |
| 1 | investor B `associate()` (completes the hollow account) | investor B | 726,488 | 0.9081 | [`0x583717a7…c0c8085b`](https://hashscan.io/testnet/transaction/0x583717a75f4d70bbe85f02ff2b1b920f7fe20ee8043c5709e3e58ec2c0c8085b) | 2026-11-05 20:43 |
| 1 | TokenGrantKyc(sponsor) | deployer (SDK) | | 0.0148 | [`0.0.11329142@1793911398.824218929`](https://hashscan.io/testnet/transaction/1793911407.244540084) | 2026-11-05 20:43 |
| 1 | TokenGrantKyc(investor A) | deployer (SDK) | | 0.0148 | [`0.0.11329142@1793911405.544088147`](https://hashscan.io/testnet/transaction/1793911411.300782447) | 2026-11-05 20:43 |
| 1 | TokenGrantKyc(investor B) | deployer (SDK) | | 0.0148 | [`0.0.11329142@1793911407.690726424`](https://hashscan.io/testnet/transaction/1793911415.332350104) | 2026-11-05 20:43 |
| 1 | TokenTransfer treasury → sponsor 10, investor A 1,000, investor B 1,000 fUSD | deployer (SDK) | | 0.0177 | [`0.0.11329142@1793911415.400397325`](https://hashscan.io/testnet/transaction/1793911419.795357034) | 2026-11-05 20:43 |

After phase 1 (mirror node): deployer (treasury) 7,990 fUSD, sponsor 10, investor A 1,000, investor B 1,000; all
associated and KYC GRANTED. Deployer, sponsor, investor A and investor B are complete accounts (ECDSA) now. Investor A
received 100 HBAR from the owner after the preflight baseline (15 → 115), so its "since preflight" figure is not a fee.

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
