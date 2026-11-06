# Testnet deployments

Every public id this project creates on Hedera testnet (chainId 296), recorded as soon as it exists. Accounts:
docs/ACCOUNTS.md. Transactions, fees and results: docs/TESTNET-EVIDENCE.md (from `ops/out/evidence.jsonl` and the
mirror node).

Public infrastructure used, not deployed by this project (docs/reference/ats.md): ATS v8 factory proxy `0.0.9213391`
(`0xd1F118A40f3b02883D35909eF2517e7EDd78379d`) and BLR proxy `0.0.9212226` (`0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a`).

## Smoke run (ops/scripts/smoke)

| What | Hedera id | EVM address | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- | --- |
| fUSD stablecoin "Faultline Test USD" (HTS, 6 decimals, 10,000 initial supply to the treasury; admin/supply/KYC key = deployer; no wipe/freeze/pause key) | [`0.0.11329874`](https://hashscan.io/testnet/token/0.0.11329874) | `0x0000000000000000000000000000000000aCe152` | deployer (SDK, hollow payer completed by this tx) | 2026-11-05 20:43 | [`0.0.11329142@1793911374.245778606`](https://hashscan.io/testnet/transaction/1793911378.334957104) |
| ATS v8 bond "Faultline Smoke Bond" (FLSMK), ISIN `USFLS9115604`, 6 decimals, max supply 10,000, maturity 1793914260 (21:31:00 UTC) | [`0.0.11329898`](https://hashscan.io/testnet/contract/0xB26CDB984337E37F021e64CaEb02Fc4085131d6F) | `0xB26CDB984337E37F021e64CaEb02Fc4085131d6F` | deployer (factory `deployBond`) | 2026-11-05 20:46 | [`0x7689bf81…277317a2`](https://hashscan.io/testnet/transaction/0x7689bf81594a0a688cfffdafd9e81b1ae84759cef8a4b3f86992e2af277317a2) |
| FaultlinePool (issuance 1793911744–1793912524, riskStart 1793912524, maturity 1793914140, grace 180 s, couponBps 600, cap 10,000, minTicket 100 fUSD) | [`0.0.11329910`](https://hashscan.io/testnet/contract/0xfF26af30416E7897A1a2a4d703dE05374E9c1359) | `0xfF26af30416E7897A1a2a4d703dE05374E9c1359` | deployer | 2026-11-05 20:47 | [`0xa8056cb4…4cdaf8cd`](https://hashscan.io/testnet/transaction/0xa8056cb4d7cbfa6d89e284fc0e0eeee341950d431b23c0423a4270954cdaf8cd) |
| FaultlineTrigger (termsHash `0x40bec367c4db56a591c0f1b9fb93db6b31af97a8da59a153ac795866aad3e24c` = `kutchTerms("replay", 813433584)`, window 60 s, oracle, admin deployer, trustee) | [`0.0.11329911`](https://hashscan.io/testnet/contract/0x6455F6B7E140Cb273FA612f8091a6c8a5C2A20ab) | `0x6455F6B7E140Cb273FA612f8091a6c8a5C2A20ab` | deployer | 2026-11-05 20:47 | [`0xecd69895…ae41ff537`](https://hashscan.io/testnet/transaction/0xecd698953ef1bff820e7df8c8504238ce574d98cd0957d947be8e10ae41ff537) |

## Full demo (ops/scripts/demo)

| What | Hedera id | EVM address | Created by | Date (UTC) | Tx |
| --- | --- | --- | --- | --- | --- |
| ATS v8 bond "Faultline Demo Bond" (FLDMO), ISIN `USFLS9147458`, 6 decimals, maturity 1793917445 | [`0.0.11330397`](https://hashscan.io/testnet/contract/0x4DdEBa59E3b8e5e62bD3f3872571EE4779C8f173) | `0x4DdEBa59E3b8e5e62bD3f3872571EE4779C8f173` | deployer (factory `deployBond`) | 2026-11-05 21:39 | [`0x0ba4aabf…2dfb557f`](https://hashscan.io/testnet/transaction/0x0ba4aabf40c251e821a4798375b1a4b8ca951953a082351e25f47b872dfb557f) |
| HCS topic, memo `faultline-demo-testnet`: submit key = oracle (`032ceb0f8a…`), admin key = trustee (`023231a045…`), payer + auto-renew = relayer | [`0.0.11330395`](https://hashscan.io/testnet/topic/0.0.11330395) | | relayer (SDK, hollow payer completed; trustee co-signs as admin key) | 2026-11-05 21:39 | [`0.0.11329581@1793914738.864247226`](https://hashscan.io/testnet/transaction/1793914744.608192104) |
| FaultlinePool (issuance 1793914966–1793915746, riskStart 1793915746, maturity 1793917325, grace 180 s, couponBps 600, cap 10,000, minTicket 100 fUSD) | [`0.0.11330416`](https://hashscan.io/testnet/contract/0x6d84cb8d063424850347eE1ebc1399885320597e) | `0x6d84cb8d063424850347eE1ebc1399885320597e` | deployer | 2026-11-05 21:41 | [`0xd68bee61…c4b0fd82`](https://hashscan.io/testnet/transaction/0xd68bee61777bb3f3e5c64ae07081b27826bc024c2236206f304a1198c4b0fd82) |
| FaultlineTrigger (termsHash `0x76135117384c954cbeb10265dcd69ab06f489f3eff903f9b34cf939d387957e2` = `kutchTerms("replay", 813436806)`, window 120 s, oracle, admin deployer, trustee + backup trustee; deploy block 42712760) | [`0.0.11330420`](https://hashscan.io/testnet/contract/0xD51E0712C1849818c3919195034539E041b3405c) | `0xD51E0712C1849818c3919195034539E041b3405c` | deployer | 2026-11-05 21:41 | [`0x52ada01f…dd1af666`](https://hashscan.io/testnet/transaction/0x52ada01fab5c44790588dfe2d7bfa31025a8b3ae2923f008b2ea3716dd1af666) |

The web app's testnet entry (`web/src/config/networks.ts`) points at the full-demo trigger, topic and terms.
