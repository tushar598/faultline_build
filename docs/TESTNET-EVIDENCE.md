# Hedera testnet evidence

Every testnet transaction and entity created for Faultline, in run order. Each status was checked on the mirror node
(`https://testnet.mirrornode.hedera.com`); fees are the mirror's `charged_tx_fee`. Entity ids: docs/DEPLOYMENTS.md.
Spike plan: `docs/SPIKES.md`; lessons: `docs/LESSONS.md`.

## Faultline accounts

Created by the owner on 2026-11-05/06 (UTC); keys only in the owner's global Hardhat 3 keystore under the names below
(never in a repo or chat). Funded by an HBAR transfer to the EVM address, which auto-created **hollow** accounts
(mirror node: no key yet, `ethereum_nonce` 0, `max_automatic_token_associations` -1); each completes on its first signed
transaction. Every script checks that a keystore key derives to the address below before it sends anything
(`CHECK_KEYS=1` preflights passed for all eight). Balances: docs/ACCOUNTS.md.

| Role | Keystore name | Account | EVM address |
| --- | --- | --- | --- |
| Deployer: admin, fUSD treasury and KYC key, bond admin | `FLH_DEPLOYER_PRIVATE_KEY` | `0.0.11329142` | `0xbF89BCE061513D4763047D5F5A16846F149Ca248` |
| Trustee: `TRUSTEE_ROLE`, HCS topic admin key | `FLH_TRUSTEE_PRIVATE_KEY` | `0.0.11329263` | `0x965eB9d778a912b23e467ba28490927b25E655ee` |
| Backup trustee (D17) | `FLH_TRUSTEE_BACKUP_PRIVATE_KEY` | `0.0.11329384` | `0xD66383855628a46A3E300ad889E9dF2eA9c5A0B0` |
| Sponsor | `FLH_SPONSOR_PRIVATE_KEY` | `0.0.11329411` | `0x457DC9004E8e68FFEbed749C18Ed27F94Ca66FE3` |
| Investor A | `FLH_INVESTOR_A_PRIVATE_KEY` | `0.0.11329421` | `0xCE69d905EFc74B2fa4c93D6924EF5903DF8d9bda` |
| Investor B | `FLH_INVESTOR_B_PRIVATE_KEY` | `0.0.11329470` | `0xF9786F3fc700F6ADE804DfC5c2A07c8CaB4C301F` |
| Oracle signer (EIP-712, HCS submit key; pays nothing) | `FLH_ORACLE_PRIVATE_KEY` | `0.0.11329557` | `0x90A59Def9432C863A76F995Cd1eE57a881bb5a76` |
| Relayer (pays the oracle's HCS and EVM fees, D16; topic auto-renew) | `FLH_RELAYER_PRIVATE_KEY` | `0.0.11329581` | `0x2f9A68d7880c9052A7Dac59aFe5b8223CF2eD5Db` |

## Smoke run (HANDOVER §10 step 5b, 2026-11-05) — testnet-verified

`ops/scripts/smoke`, owner-run with `EXECUTE=1`, build `2a71b00` (pool initcode keccak `0x78712136…09563f6d`, trigger
`0x3205b3ca…aa8fcf3`: the D18 build). fUSD, ATS bond FLSMK, pool `0.0.11329910`, trigger `0.0.11329911`
(docs/DEPLOYMENTS.md). Demo profile: 13 min issuance, ~27 min risk period, 3 min grace, 60 s window.

### Transactions

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
| 5 | `trigger.submit(Bhuj usp000a8ds, 7000 bps, nonce 1)` with the oracle's EIP-712 signature (sent by the deployer) | deployer | 137,626 | 0.1707 | [`0xc0825cca…e71b76b1`](https://hashscan.io/testnet/transaction/0xc0825cca8ac2413eaa25187583f0cb8ba254315e6776a9bb6bf26725e71b76b1) | 2026-11-05 21:03 |
| 5 | `trigger.execute(eventId)` after the 60 s window | deployer | 142,746 | 0.1770 | [`0x5f1a2e17…de73e488`](https://hashscan.io/testnet/transaction/0x5f1a2e17b7153dd6c0a29cbf9875e31d4d2bd6756fdb6f53927d9064de73e488) | 2026-11-05 21:04 |
| 6 | investor A pool.redeem() — controllerRedeem of 600 units | investor A | 327,276 | 0.4058 | [`0xccbe96c7…3bc9b9ba`](https://hashscan.io/testnet/transaction/0xccbe96c7b9d60e9808331a49d48a76e25d255f81425e34bbc7a846673bc9b9ba) | 2026-11-05 21:33 |
| 6 | investor A pool.claim() [claims 180.000674 fUSD] | investor A | 53,072 | 0.0658 | [`0x861963d3…0456f767`](https://hashscan.io/testnet/transaction/0x861963d3cd52cb7fade056c9cfb74a074f289ce7a376edcbba70d9870456f767) | 2026-11-05 21:33 |
| 6 | investor B pool.redeem() — controllerRedeem of 400 units | investor B | 242,629 | 0.3009 | [`0xb0fac4e8…ceeec50e`](https://hashscan.io/testnet/transaction/0xb0fac4e82305f41c5ecef4995200613b0f0c2a9fd66d8d6d9544be3bceeec50e) | 2026-11-05 21:33 |
| 6 | investor B pool.claim() [claims 120.000449 fUSD] | investor B | 53,072 | 0.0658 | [`0xf554de23…4cb1fe9f`](https://hashscan.io/testnet/transaction/0xf554de2311d3c732d37e79b6f2434f120eeaa42507c90c11bdd627e14cb1fe9f) | 2026-11-05 21:34 |
| 6 | sponsor pool.claim() — write-down collateral [claims 700.000000 fUSD] | sponsor | 48,272 | 0.0599 | [`0xd6f94bb3…1daa7226`](https://hashscan.io/testnet/transaction/0xd6f94bb39f49ab8ebfad47d18022aa0807acc0fb5a2326642ee98dd61daa7226) | 2026-11-05 21:34 |
| 6 | pool.sweepExcess() — anyone (D3) | deployer | 127,222 | 0.1578 | [`0x050b22bf…8d0d3472`](https://hashscan.io/testnet/transaction/0x050b22bf9a54558e43de84c650c028b494ac3a66ee661ef707c75bf78d0d3472) | 2026-11-05 21:34 |
| 6 | pool.sweepDust() — anyone, bond supply 0 | deployer | 78,845 | 0.0978 | [`0x27bb079f…d1b681b8`](https://hashscan.io/testnet/transaction/0x27bb079f3601ef3f68550f5a4cec27e1a40ea92e993081e0e6be35ccd1b681b8) | 2026-11-05 21:34 |
| 6 | sponsor pool.claim() — unused reserve + dust [claims 0.998877 fUSD] | sponsor | 48,272 | 0.0599 | [`0x3e9582fb…81a08218`](https://hashscan.io/testnet/transaction/0x3e9582fb37306b6b7342c6515ff1652522662e63c7767a8af2a236be81a08218) | 2026-11-05 21:34 |

### Results

- After phase 1 (mirror node): deployer (treasury) 7,990 fUSD, sponsor 10, investor A 1,000, investor B 1,000; all
associated and KYC GRANTED. Deployer, sponsor, investor A and investor B are complete accounts (ECDSA) now. Investor A
received 100 HBAR from the owner after the preflight baseline (15 → 115), so its "since preflight" figure is not a fee.
- After phase 3: all 15 assertions passed (D4 ROLE_ISSUER == ROLE_CONTROLLER == [pool], no AGENT/ADJUSTMENT_BALANCE,
SEC-20 role audit clean, wiring, termsHash, oracle, window 60 s, TRUSTEE_ROLE, schedule, bond fits); the deployer never
held ROLE_ISSUER. Build: commit `2a71b00`, pool initcode keccak `0x78712136…09563f6d`, trigger `0x3205b3ca…aa8fcf3`.
- After phase 4: bond totalSupply 1,000 == unitsIssued; A 600, B 400 FLSMK; couponReserve 1 fUSD (requiredReserve(1,000)
= 0.003075); pool holds 1,001 fUSD; invariants and the supply guard hold.
- After phase 5: the oracle (`0x90A59Def…bb5a76`) signed the Bhuj attestation built by shared/ts from the saved real USGS
record: eventId `0xb5a233c15a3e5e02572f4178f0f99da17ab80c722586e2d52415236d5a4bb9b0` (keccak256("usp000a8ds")),
lossBps 7000, magnitudeX100 770, observedAt 1793912584 (replay offset 813433584), usgsUpdatedAt 2464692758, nonce 1,
dataHash `0xd604b4f7132c25556c5acda8c97ef967af9ce458b017144bac0741ff02672730`, deadline 1793916189; on-chain
`hashAttestation` = local digest `0xc5eec891d6ef743939c0e9179b0af7f3e9d51ae54a0391ca7b9f3a6a41277c40`; signature
`0x4b148645b05953a648c50d46d42998174e714cc13a1f12a7bf37a993e65e69bc3246d3dbfe98bc115913a1357a6b062322cbca98d31237ed4a810829adda22881c`. After execute: appliedLossBps 7000, event Executed, pendingCount 0,
sponsorCredited 700 = floor(1,000 × 7000 / 10000); ATS balances unchanged (A 600, B 400); effective principal A 180,
B 120; invariants hold.
- After phase 6 (settlement after submissionDeadline 21:32:00 UTC): investor A claimed 180.000674 fUSD (principal 180 +
coupon 0.000674), investor B 120.000449 (120 + 0.000449), sponsor 700.998877 (700 write-down collateral + 0.998877 unused
reserve swept by `sweepExcess`; dust 0). **Total 1,001.000000 = deposits 1,000 + reserve 1; the pool ends at 0 fUSD**,
bond totalSupply 0, unitsRedeemed == unitsIssued, totalClaimable 0, `isSolvent()` true. The bookkeeping form of
invariant 1 is not asserted after `sweepExcess` (ARCHITECTURE §5); the always-true form and the supply guard held after
every step.

**Testnet-verified 2026-11-05 (UTC), all 33 transactions SUCCESS, no reverted or rejected send.** End state: L 7000;
A 180, B 120, sponsor 700 + unused reserve; total 1,001. HBAR fees (mirror `charged_tx_fee`, summed from `ops/out/evidence.jsonl`):
deployer 32.2921, sponsor 2.0286, investor A 2.9664, investor B 2.7759,
trustee 0 → **40.0630 HBAR**. Investor A's balance also rose by the owner's 100 HBAR top-up during phase 1.

## Full demo (HANDOVER §10 step 9, 2026-11-05) — phases 0–5 testnet-verified

`ops/scripts/demo`, owner-run with `EXECUTE=1`, build `a0b1dd5` (same initcode keccaks as the smoke run). fUSD reused
from the smoke run; new HCS topic `0.0.11330395`, ATS bond FLDMO `0.0.11330397`, pool `0.0.11330416`, trigger
`0.0.11330420` (docs/DEPLOYMENTS.md). Demo profile: 13 min issuance, ~26 min risk period, 3 min grace, 120 s window.
Flow A is a SYNTHETIC record (`oracle/fixtures/synthetic-kutch-testnet-a.geojson`, not a real USGS event); Flow B is
the real 2001 Bhuj record `usp000a8ds`, fetched live from USGS by the oracle.

### Transactions

| Phase | What | Signer | Gas used | Fee (HBAR) | Tx | Date (UTC) |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | TopicCreate "faultline-demo-testnet" (submit key = oracle, admin key = trustee, payer + auto-renew = relayer) | relayer (SDK) |  | 0.4406 | [`0.0.11329581@1793914738.864247226`](https://hashscan.io/testnet/transaction/1793914744.608192104) | 2026-11-05 21:39 |
| 1 | deployBond ISIN USFLS9147458 (Faultline Demo Bond FLDMO) | deployer | 7,214,985 | 8.9466 | [`0x0ba4aabf…2dfb557f`](https://hashscan.io/testnet/transaction/0x0ba4aabf40c251e821a4798375b1a4b8ca951953a082351e25f47b872dfb557f) | 2026-11-05 21:39 |
| 1 | addIssuer(deployer) — SSI issuer | deployer | 126,989 | 0.1575 | [`0xd809044b…48c0d9d7`](https://hashscan.io/testnet/transaction/0xd809044bba41344e29084260982e27d7d019528559b8cbf2531b4d7e48c0d9d7) | 2026-11-05 21:40 |
| 1 | grantKyc(investor A, urn:faultline:demo:kyc:investorA) — opaque vcId, no VC document | deployer | 251,474 | 0.3118 | [`0xc72a1b84…907f595f`](https://hashscan.io/testnet/transaction/0xc72a1b8433bedfbc9fb77dbe31acdeae21b95dc27c958d5c6e7a05c6907f595f) | 2026-11-05 21:40 |
| 1 | grantKyc(investor B, urn:faultline:demo:kyc:investorB) — opaque vcId, no VC document | deployer | 234,362 | 0.2906 | [`0xc55f0916…54b2d752`](https://hashscan.io/testnet/transaction/0xc55f091685e3b540b5dce888a6042ee269e63ebe562e8b44dc5a245654b2d752) | 2026-11-05 21:40 |
| 2 | deploy FaultlinePool (D17 build a0b1dd5) | deployer | 2,283,913 | 2.8321 | [`0xd68bee61…c4b0fd82`](https://hashscan.io/testnet/transaction/0xd68bee61777bb3f3e5c64ae07081b27826bc024c2236206f304a1198c4b0fd82) | 2026-11-05 21:41 |
| 2 | deploy FaultlineTrigger | deployer | 2,028,097 | 2.5148 | [`0x52ada01f…dd1af666`](https://hashscan.io/testnet/transaction/0x52ada01fab5c44790588dfe2d7bfa31025a8b3ae2923f008b2ea3716dd1af666) | 2026-11-05 21:41 |
| 2 | pool.initialize(trigger) — D5; associates the pool with fUSD | deployer | 744,974 | 0.9238 | [`0x7fb36bfb…063bd6b9`](https://hashscan.io/testnet/transaction/0x7fb36bfb293f587e31918afb80d55e1072f3d507604f66e428deeb4e063bd6b9) | 2026-11-05 21:41 |
| 2 | TokenGrantKyc(pool contract account) | deployer (SDK) |  | 0.0146 | [`0.0.11329142@1793914890.308081132`](https://hashscan.io/testnet/transaction/1793914896.727624967) | 2026-11-05 21:41 |
| 2 | bond.applyRoles([ISSUER, CONTROLLER], [true, true], pool) | deployer | 321,620 | 0.3988 | [`0xceef28cf…1bd04bcf`](https://hashscan.io/testnet/transaction/0xceef28cfd3605eea53f6ba7ca1f60cfe5cb0df14c1874c566606c3c71bd04bcf) | 2026-11-05 21:41 |
| 2 | trigger.grantRole(TRUSTEE_ROLE, backup trustee) — by the primary trustee (D17: TRUSTEE_ROLE administers itself) | trustee | 51,551 | 0.0639 | [`0x713de6da…3a5a20d6`](https://hashscan.io/testnet/transaction/0x713de6dadab43e396b7eb8ed971080450d3d322c4d68d5411cd838413a5a20d6) | 2026-11-05 21:42 |
| 3 | sponsor fUSD.approve(pool, 1.000000) | sponsor | 727,020 | 0.9015 | [`0xd83e5936…e0353b90`](https://hashscan.io/testnet/transaction/0xd83e59365de719429f6ccccbd2409ff34922dbf2c35f336c33744758e0353b90) | 2026-11-05 21:47 |
| 3 | sponsor pool.fundCoupons(1.000000) | sponsor | 73,582 | 0.0912 | [`0xcb41b35b…ad8732f8`](https://hashscan.io/testnet/transaction/0xcb41b35b0798b76b4754ac42815c3d5801d04c26f4383dfeb8d0e517ad8732f8) | 2026-11-05 21:47 |
| 3 | investor A fUSD.approve(pool, 300.000000) | investor A | 727,020 | 0.9015 | [`0x27b874c9…e2eb9083`](https://hashscan.io/testnet/transaction/0x27b874c972d8818244e71d0902805880f5cf330c1a42fb14ab0425cbe2eb9083) | 2026-11-05 21:47 |
| 3 | investor A pool.invest(300.000000) | investor A | 540,129 | 0.6698 | [`0x6f1080bc…2a612311`](https://hashscan.io/testnet/transaction/0x6f1080bcb1dddbc6dd1885a59c206dc90100f89b3a11491b754e41e12a612311) | 2026-11-05 21:47 |
| 3 | investor B fUSD.approve(pool, 200.000000) | investor B | 727,020 | 0.9015 | [`0x4d819474…194efdc6`](https://hashscan.io/testnet/transaction/0x4d81947496d20e7f244aae785505c70122056861cc02b24a3b46f46a194efdc6) | 2026-11-05 21:48 |
| 3 | investor B pool.invest(200.000000) | investor B | 471,729 | 0.5849 | [`0x5783b1bd…d4859ccf`](https://hashscan.io/testnet/transaction/0x5783b1bd0681181e11854b1e2531a0c6e1588299ad3d8e60cb821244d4859ccf) | 2026-11-05 21:48 |
| 4 | HCS message 1 on topic 0.0.11330395: the oracle's SYNTHETIC attestation (707 bytes, EIP-712 signature in the payload; submit key = oracle) | relayer (SDK, oracle co-signs as submit key) | | 0.0100 | [`0.0.11329581-1793915875-100526920`](https://hashscan.io/testnet/transaction/1793915883.797929138) | 2026-11-05 21:58 |
| 4 | `trigger.submit` SYNTHETIC synthetic-kutch-testnet-a (5,000 bps, nonce 1), by the real oracle CLI | relayer | 137,626 | 0.1707 | [`0xc9076911…a55dba38`](https://hashscan.io/testnet/transaction/0xc9076911ebaab2803b8eb9d37e0ff1408277b4000dc45690a1fb403fa55dba38) | 2026-11-05 21:58 |
| 4 | `trigger.pause()` (presigned, broadcast when the oracle reported the submit mined; 114 s left in the 120 s window) | trustee | 30,379 | 0.0377 | [`0x9c19d11a…dc2ee171`](https://hashscan.io/testnet/transaction/0x9c19d11a28047f26bf62074f37817bfbbfd449f13fc250c20c6ccd1fdc2ee171) | 2026-11-05 21:58 |
| 4 | `trigger.veto(synthetic-kutch-testnet-a)` while paused | trustee | 38,225 | 0.0474 | [`0x07e25a96…9d735caa`](https://hashscan.io/testnet/transaction/0x07e25a965ab8792e9c62948183217576d1ac24632a1cf50352bdd3b39d735caa) | 2026-11-05 21:58 |
| 4 | `trigger.unpause()` (paused 45 s) | deployer (admin) | 53,038 | 0.0658 | [`0xa6f5ca69…a679e1da`](https://hashscan.io/testnet/transaction/0xa6f5ca6911b9321037fa382178991d81cbe3bdf7388b9003dd2070eaa679e1da) | 2026-11-05 21:59 |
| 4 | same attestation + signature re-submitted: **CONTRACT_REVERT_EXECUTED `EventFinalised(eventId, 2)`**, sent on purpose (SEND_REVERT=1) as evidence | relayer | 39,252 | 0.0501 | [`0x12b9c4f7…52cdf066`](https://hashscan.io/testnet/transaction/0x12b9c4f7ef45bf60225d3cfdb68b846ae5a1692dd470ce0942c7e1ac52cdf066) | 2026-11-05 21:59 |
| 5 | HCS message 2 on topic 0.0.11330395: the oracle's Bhuj usp000a8ds attestation, built from the LIVE USGS record (692 bytes, signature in the payload) | relayer (SDK, oracle co-signs as submit key) | | 0.0099 | [`0.0.11329581-1793916195-900235745`](https://hashscan.io/testnet/transaction/1793916201.234434551) | 2026-11-05 22:03 |
| 5 | `trigger.submit` Bhuj usp000a8ds (7,000 bps, nonce 1), by the real oracle CLI | relayer | 137,626 | 0.1720 | [`0x3da26e2a…1e58d0ae`](https://hashscan.io/testnet/transaction/0x3da26e2aacb38f009b244dfebe34fddcde87924f749fa447203d80fd1e58d0ae) | 2026-11-05 22:03 |
| 5 | `trigger.execute` by the oracle keeper after the 120 s window (L 0 → 7,000) | relayer | 142,746 | 0.1784 | [`0x010bf61d…e435ac5c`](https://hashscan.io/testnet/transaction/0x010bf61d17e0ae07b80e29d6d2fb71d4c0b96c462939713e249df40fe435ac5c) | 2026-11-05 22:05 |
| 6a | investor A pool.redeem() — controllerRedeem of 300 units | investor A | 327,276 | 0.4058 | [`0x6d4816af…74f5a821`](https://hashscan.io/testnet/transaction/0x6d4816afcaea84c839e2ad70d8418909b3dd457d2a73233c591ce57474f5a821) | 2026-11-06 04:28 |
| 6a | investor A pool.claim() [claims 90.000506 fUSD] | investor A | 53,072 | 0.0658 | [`0xc821525e…d19997cb`](https://hashscan.io/testnet/transaction/0xc821525ef858897af51851c43d2625745b9d34b80c5174cac7456290d19997cb) | 2026-11-06 04:28 |
| 6a | sponsor pool.claim() — write-down collateral [claims 350.000000 fUSD] | sponsor | 48,272 | 0.0599 | [`0xf2e1df29…064b94d4`](https://hashscan.io/testnet/transaction/0xf2e1df297dad2b99b708fbe9e6fb44057e17d2de5bd1e1b9e6746671064b94d4) | 2026-11-06 04:28 |
| 8 | investor B `pool.redeem()` through the dashboard with MetaMask (gas limit 405,177 = estimate × 1.3) | investor B | 259,729 | 0.3221 | [`0xd8e5bb2a…3a34098d`](https://hashscan.io/testnet/transaction/0xd8e5bb2aac4666140bebbefd368baeef7ed8e8da46b4067993a199923a34098d) | 2026-11-06 04:32 |
| 8 | investor B `pool.claim()` through the dashboard with MetaMask (claims 60.000337 fUSD) | investor B | 48,272 | 0.0599 | [`0x33a4f50a…8e512347`](https://hashscan.io/testnet/transaction/0x33a4f50ab62ffc8bf3e010d043750d1cfa1491cfa514765d2d22af0f8e512347) | 2026-11-06 04:33 |
| 6s | pool.sweepExcess() — anyone (D3) | deployer | 127,222 | 0.1578 | [`0xd3e08e1f…b2da8bde`](https://hashscan.io/testnet/transaction/0xd3e08e1f50022568119bff62d77c6d550a0de6fe1f0e739cf72e60a7b2da8bde) | 2026-11-06 04:34 |
| 6s | pool.sweepDust() — anyone, bond supply 0 | deployer | 78,845 | 0.0978 | [`0x31f4ea41…3df2f52d`](https://hashscan.io/testnet/transaction/0x31f4ea41d38c9c288c3848197c5bfdcf7c42150bfacf59295b0300a13df2f52d) | 2026-11-06 04:35 |
| 6s | sponsor pool.claim() — unused reserve + dust [claims 0.999157 fUSD] | sponsor | 48,272 | 0.0599 | [`0x40f0cba0…49c34857`](https://hashscan.io/testnet/transaction/0x40f0cba0dca7795e8585758a95966197165fdce38b8daaf43cbcc65149c34857) | 2026-11-06 04:35 |

### HCS messages

Topic `0.0.11330395` ([topic](https://hashscan.io/testnet/topic/0.0.11330395)), memo `faultline-demo-testnet`.

| Seq | Consensus timestamp | Payer | Bytes | Content |
| --- | --- | --- | --- | --- |
| 1 | `1793915883.797929138` | relayer `0.0.11329581` | 707 | Flow A: SYNTHETIC `synthetic-kutch-testnet-a` attestation (5,000 bps), in-payload EIP-712 signature = oracle |
| 2 | `1793916201.234434551` | relayer `0.0.11329581` | 692 | Flow B: Bhuj `usp000a8ds` attestation (7,000 bps) from the live USGS record, in-payload signature = oracle |

### Results

- After phase 2: every assertion passed (D4 roles, SEC-20 audit, wiring, termsHash, oracle, window 120 s, both trustees
hold TRUSTEE_ROLE); the trigger admin's grant and revoke of TRUSTEE_ROLE were simulated only and refused (D17,
`adminCannotManageTrusteesAt`); the oracle's `verify-config` gate passed on `ops/out/demo/oracle.testnet.json` (real
HCS, topic 0.0.11330395, payer = relayer). Build: commit `a0b1dd5` (same initcode keccaks as the smoke run).
Bhuj replays to observedAt 1793915806, the SYNTHETIC Flow A record to 1793915866.
The web app's testnet entry (`web/src/config/networks.ts`) now points at this trigger, topic and terms.
- After phase 3: sponsor funded the 1 fUSD coupon reserve; A invested 300, B 200 (unitsIssued 500, read on chain).
- After phase 4 (Flow A, SYNTHETIC): eventId `0x7af3905781c899ce32c6facd77f0dddabe224e474da1071e0d43496da9231768` =
keccak256("synthetic-kutch-testnet-a"). The window started at 1793915887; the pause landed at 1793915893 (114 s left).
While paused, effectiveTime() stayed frozen at 1793915893, `submissionDeadline()` moved with the clock (1793917511 →
1793917533 over 22 s), and `execute()` simulated to `IsPaused()`. The trustee vetoed while paused → **Vetoed**; the
admin unpaused after 45 s (totalPausedSeconds 45; deadline now 1793917550). The re-submitted signature reverted
`EventFinalised(eventId, 2)` on chain, and the oracle re-run on the same record decided "finalised" and published nothing.
HCS: topic 0.0.11330395 sequence 1, consensus 1793915883.797929138, payer relayer, 707 bytes, in-payload signature =
oracle.
- After phase 5 (Flow B, real Bhuj): the oracle fetched usp000a8ds live from USGS, published HCS sequence 2 (consensus
1793916201.234434551, payer relayer, 692 bytes), submitted through the relayer, and its keeper executed after the 120 s
window. appliedLossBps 7000; Bhuj **Executed**, SYNTHETIC still **Vetoed**, pendingCount 0; sponsorCredited =
claimable(sponsor) = 350 = floor(500 × 7000 / 10000); ATS balances unchanged (A 300, B 200); effective principal
A 90, B 60; invariants hold. submissionDeadline 1793917550 (22:25:50 UTC, moved 45 s by the Flow A pause).

### Settlement (phase 6 and the dashboard step, 2026-11-06)

After `submissionDeadline()` (1793917550, 22:25:50 UTC, moved 45 s by the Flow A pause): `PART=a` redeemed and claimed
for investor A (**90.000506** fUSD = 90 principal + 0.000506 coupon) and claimed the sponsor's write-down collateral
(**350.000000**). Investor B redeemed and claimed **through the dashboard with MetaMask** (**60.000337**; both
transactions SUCCESS on the first try, each with the explicit gas limit = estimate × 1.3). `PART=sweep` then ran
`sweepExcess`, `sweepDust` and the sponsor's last claim (**0.999157** = unused reserve + dust).

### Final books

Paid out: A 90.000506 + B 60.000337 + sponsor 350.999157 = **501.000000 = 500 deposits + 1 reserve; the pool ends at 0
fUSD.** On chain after the sweep: `unitsRedeemed` = `unitsIssued` = 500, `totalClaimable` 0, `isSolvent()` true,
`appliedLossBps` 7000, `pendingCount` 0; event records SYNTHETIC **Vetoed**, Bhuj **Executed**.

### HBAR

Fees (mirror `charged_tx_fee`) of every demo transaction, script-sent, oracle (relayer) and dashboard: ≈ **22.92 HBAR**
(phase 1 10.147, phase 2 6.748, phase 3 4.051, phases 4–5 0.906, phase 6 and the dashboard 1.229). `ops/out/evidence.jsonl`
holds only what the scripts sent; the oracle's and MetaMask's transactions were added from the mirror node.

### Still to run

Phase 7: Sourcify verification of the pool and the trigger (no Hedera transaction).
