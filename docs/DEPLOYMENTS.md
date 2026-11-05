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
| ATS v8 bond "Faultline Smoke Bond" (FLSMK), ISIN `USFLS9115604`, 6 decimals, max supply 10,000, maturity 1793914260 (21:31:00 UTC) | [`0.0.11329898`](https://hashscan.io/testnet/contract/0xB26CDB984337E37F021e64CaEb02Fc4085131d6F) | `0xB26CDB984337E37F021e64CaEb02Fc4085131d6F` | deployer (factory `deployBond`) | 2026-11-05 20:46 | [`0x7689bf81…277317a2`](https://hashscan.io/testnet/transaction/0x7689bf81594a0a688cfffdafd9e81b1ae84759cef8a4b3f86992e2af277317a2) |
| FaultlinePool (issuance 1793911744–1793912524, riskStart 1793912524, maturity 1793914140, grace 180 s, couponBps 600, cap 10,000, minTicket 100 fUSD) | [`0.0.11329910`](https://hashscan.io/testnet/contract/0xfF26af30416E7897A1a2a4d703dE05374E9c1359) | `0xfF26af30416E7897A1a2a4d703dE05374E9c1359` | deployer | 2026-11-05 20:47 | [`0xa8056cb4…4cdaf8cd`](https://hashscan.io/testnet/transaction/0xa8056cb4d7cbfa6d89e284fc0e0eeee341950d431b23c0423a4270954cdaf8cd) |
| FaultlineTrigger (termsHash `0x40bec367c4db56a591c0f1b9fb93db6b31af97a8da59a153ac795866aad3e24c` = `kutchTerms("replay", 813433584)`, window 60 s, oracle, admin deployer, trustee) | [`0.0.11329911`](https://hashscan.io/testnet/contract/0x6455F6B7E140Cb273FA612f8091a6c8a5C2A20ab) | `0x6455F6B7E140Cb273FA612f8091a6c8a5C2A20ab` | deployer | 2026-11-05 20:47 | [`0xecd69895…ae41ff537`](https://hashscan.io/testnet/transaction/0xecd698953ef1bff820e7df8c8504238ce574d98cd0957d947be8e10ae41ff537) |

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
| 2 | factory `deployBond` ISIN USFLS9115604 (Faultline Smoke Bond, FLSMK) | deployer | 7,214,839 | 9.0185 | [`0x7689bf81…277317a2`](https://hashscan.io/testnet/transaction/0x7689bf81594a0a688cfffdafd9e81b1ae84759cef8a4b3f86992e2af277317a2) | 2026-11-05 20:46 |
| 2 | bond `addIssuer(deployer)` (SSI issuer) | deployer | 126,989 | 0.1587 | [`0x277f79bc…c6bc29`](https://hashscan.io/testnet/transaction/0x277f79bcf616c0e980d18a74289e96c1bc70d0d760cb1d6a04c2f9f5d0c6bc29) | 2026-11-05 20:46 |
| 2 | bond `grantKyc(investor A, urn:faultline:smoke:kyc:investorA)` | deployer | 273,773 | 0.3422 | [`0x4bbe0d53…4d246ba0`](https://hashscan.io/testnet/transaction/0x4bbe0d532f57166f162b19226b7f74c610ab24ffacefd0abcb54ff3e4d246ba0) | 2026-11-05 20:46 |
| 2 | bond `grantKyc(investor B, urn:faultline:smoke:kyc:investorB)` | deployer | 256,661 | 0.3208 | [`0x6d7e7327…7b02107a`](https://hashscan.io/testnet/transaction/0x6d7e73273c1984b5a954316b6a68a34d2dc7ccc4f8e39e30b3fb54e67b02107a) | 2026-11-05 20:46 |
| 3 | deploy FaultlinePool → `0xfF26af30…9c1359` | deployer | 2,283,913 | 2.8549 | [`0xa8056cb4…4cdaf8cd`](https://hashscan.io/testnet/transaction/0xa8056cb4d7cbfa6d89e284fc0e0eeee341950d431b23c0423a4270954cdaf8cd) | 2026-11-05 20:47 |
| 3 | deploy FaultlineTrigger → `0x6455F6B7…2A20ab` | deployer | 2,028,097 | 2.5351 | [`0xecd69895…ae41ff537`](https://hashscan.io/testnet/transaction/0xecd698953ef1bff820e7df8c8504238ce574d98cd0957d947be8e10ae41ff537) | 2026-11-05 20:47 |
| 3 | `pool.initialize(trigger)` (D5; associates the pool with fUSD) | deployer | 744,974 | 0.9312 | [`0xc9663dd2…1a6753b`](https://hashscan.io/testnet/transaction/0xc9663dd21552853b683f1a147d841e33f62036d5156b1f05460d406bc1a6753b) | 2026-11-05 20:47 |
| 3 | TokenGrantKyc(pool `0.0.11329910`) | deployer (SDK) | | 0.0148 | [`0.0.11329142@1793911658.221207697`](https://hashscan.io/testnet/transaction/1793911663.672576761) | 2026-11-05 20:47 |
| 3 | bond `applyRoles([ISSUER, CONTROLLER], [true, true], pool)` | deployer | 321,620 | 0.4020 | [`0x5cfe348d…5ed723ac`](https://hashscan.io/testnet/transaction/0x5cfe348d375e0fb1802b3c198aae8760628fda13955de47a13b6577e5ed723ac) | 2026-11-05 20:47 |
| 4 | sponsor fUSD.approve(pool, 1.000000) | sponsor | 727,020 | 0.9088 | [`0xadb81937…ce88983d`](https://hashscan.io/testnet/transaction/0xadb819375a3184edb010e6bc955c0fcd0386816972e4b2a2dbee1450ce88983d) | 2026-11-05 20:50 |
| 4 | sponsor pool.fundCoupons(1.000000) | sponsor | 73,582 | 0.0920 | [`0xc7534715…5298943c`](https://hashscan.io/testnet/transaction/0xc7534715aed0372b975a2f5decd6eb3aa727aa460d4cc9d5534dca225298943c) | 2026-11-05 20:50 |
| 4 | investor A fUSD.approve(pool, 600.000000) | investor A | 727,020 | 0.9088 | [`0x2791a68e…83b52e2d`](https://hashscan.io/testnet/transaction/0x2791a68eac8460e80ea7580f3c64762a7b97b9607c68f07afd76de3883b52e2d) | 2026-11-05 20:50 |
| 4 | investor A pool.invest(600.000000) | investor A | 542,282 | 0.6779 | [`0x06db1aa0…a1b0f74c`](https://hashscan.io/testnet/transaction/0x06db1aa05dcea264253ea226c6148ba62ff0de0033c0b58d0a2786b7a1b0f74c) | 2026-11-05 20:50 |
| 4 | investor B fUSD.approve(pool, 400.000000) | investor B | 727,020 | 0.9088 | [`0x080fc12d…3581a049`](https://hashscan.io/testnet/transaction/0x080fc12d0e9eff3adf62019744969f33b15272455617080e4de952da3581a049) | 2026-11-05 20:50 |
| 4 | investor B pool.invest(400.000000) | investor B | 473,882 | 0.5924 | [`0x07ce32de…07bb600e`](https://hashscan.io/testnet/transaction/0x07ce32ded5a57fc54cc4e2e3828e18940374f509254211d7993b684307bb600e) | 2026-11-05 20:50 |

After phase 1 (mirror node): deployer (treasury) 7,990 fUSD, sponsor 10, investor A 1,000, investor B 1,000; all
associated and KYC GRANTED. Deployer, sponsor, investor A and investor B are complete accounts (ECDSA) now. Investor A
received 100 HBAR from the owner after the preflight baseline (15 → 115), so its "since preflight" figure is not a fee.

After phase 3: all 15 assertions passed (D4 ROLE_ISSUER == ROLE_CONTROLLER == [pool], no AGENT/ADJUSTMENT_BALANCE,
SEC-20 role audit clean, wiring, termsHash, oracle, window 60 s, TRUSTEE_ROLE, schedule, bond fits); the deployer never
held ROLE_ISSUER. Build: commit `2a71b00`, pool initcode keccak `0x78712136…09563f6d`, trigger `0x3205b3ca…aa8fcf3`.

After phase 4: bond totalSupply 1,000 == unitsIssued; A 600, B 400 FLSMK; couponReserve 1 fUSD (requiredReserve(1,000)
= 0.003075); pool holds 1,001 fUSD; invariants and the supply guard hold.

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
