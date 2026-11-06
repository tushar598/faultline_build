# Hedera testnet spike plan

**Status:** the must-spikes S1, S2, S3, S5 and S7 ran in the design phase (2026-10-25 to 10-27) in the separate
spikes folder; their answers are in docs/LESSONS.md and shaped the contracts, mocks and oracle. Their throwaway accounts,
bonds and topics are not part of this project's deployment (docs/DEPLOYMENTS.md), and their ids are not repeated here.
Original plan, as written: owner decisions (2026-10-25): run **S1 → S2 → S3** first; parameters (box, curve,
grace, coupon %) are decided **after** them; S0 (Redeemer revoke) runs **after** S1–S3, with the owner's
confirmation. **Every testnet transaction needs the owner's explicit OK first.** Each spike is small, answers one question, and writes its result **before** any
contract code depends on it. Spikes cover what a local Hardhat chain cannot emulate (HANDOVER §10
step 2). Written 2026-10-25.

## Ground rules

- **Where the code lives:** a separate throwaway folder `~/Desktop/faultline-spikes/` (its own git repo,
  never copied into `faultline/`). Use **Hardhat 3 + its encrypted keystore** there — the owner's
  existing, working pattern. The Hardhat 3 keystore is global (`~/Library/Preferences/hardhat-nodejs/keystore.json`),
  so keys added by the owner with `npx hardhat keystore set` work there unchanged. SDK scripts (HCS, HTS token
  create) read the key from the same keystore or from `read -s` in the terminal.
- **Keys:** never in chat, never in a file in any repo. Testnet keys only.
- **Accounts:** throwaway spike accounts only (an issuer/admin and a **hollow** investor that completes on its first
  signed transaction, both with unlimited auto-association `-1`). Faultline's real contracts get their own accounts:
  the FLH_* set in docs/ACCOUNTS.md.
  - A third throwaway account (fresh, from the portal) is useful for "non-KYC recipient" checks.
- **Funds:** testnet HBAR from <https://portal.hedera.com/faucet>. Exact costs ❓ (ATS bond deployment
  through the factory is the heaviest call). Have **≥ 100 HBAR on the issuer** and **≥ 20 HBAR on the
  investor** before starting (2026-10-25: issuer 31.07 HBAR; measured estimate for S1+S2 ≈ 16 HBAR, so S1 can start, top up to ≥ 50 before S3; investor 50 HBAR); top up if a step fails with `INSUFFICIENT_PAYER_BALANCE`.
- **Network:** chain id 296, RPC `https://testnet.hashio.io/api`, mirror
  `https://testnet.mirrornode.hedera.com`. Admin transactions through scripts, not MetaMask.
- **Record every result** in three places:
  1. `docs/LESSONS.md` → section "Spike results" (question, answer, surprises, time taken).
  2. `docs/TESTNET-EVIDENCE.md` (create on first spike) → table: spike, what, tx hash / id, HashScan link, date.
  3. `docs/ARCHITECTURE.md` §10 → mark the matching U-row verified or false; if false, open a design
     question before changing anything. Update the README verified-vs-mock table.
- **Stop rule:** if a spike fails twice for the same reason, stop and report; do not keep retrying.

Order: S1 → S2 → S3 → S0 (owner confirms) → S5 → S6 → S4. S1–S3 and S5 are **must** (they shape the contracts, mocks and
oracle); S6 and S4 are **stretch** (interim coupons, scheduling).

---

## S0 — Housekeeping (5 min)

- **Question:** is the old test state safe?
- **Steps:** on the owner's earlier test bond (TCB, docs/CONTEXT.md §2) revoke `ROLE_CONTROLLER` from the
  access-control-free `Redeemer` probe. Check `hasRole` returns false. Not part of this project's deployment.
- **Account / funds:** issuer, < 1 HBAR.
- **Expected:** role revoked (HANDOVER §9 cleanup debt closed).
- **Record:** LESSONS + EVIDENCE.

## S1 — ATS v8 bond for Faultline (must, ~2 h)

- **Questions:** U1 mint function name, U3 controllerRedeem after maturity and without holder KYC,
  U4 nominal 1 USD / 6 decimals, v8 role order, `getRoleMemberCount` behaviour.
- **Steps:**
  1. Read `docs/reference/ats.md` §4. Build `BondData` for the v8 factory
     (`0xd1F118A40f3b02883D35909eF2517e7EDd78379d`, config `BOND_CONFIG_ID` `0x…02`, version 1, BLR
     `0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a`): name "Faultline Spike Bond", symbol "FLSPK",
     a Luhn-valid ISIN (compute it in the script; check with `isinValidator.sol` logic), `decimals 6`,
     `maxSupply 10_000_000_000` (10,000 USD), `isControllable true`, `internalKycActivated true`,
     `isMultiPartition false`, `currency "USD"`, nominal 1 USD (`nominalValue 100`, `nominalValueDecimals 2`
     — confirm the factory accepts it), `startingDate` now + 2 min, `maturityDate` now + `MATURITY_MIN` min (default 45; set `MATURITY_MIN=90` for a slower, step-by-step run). ISIN and dates are recomputed at the moment of the real run.
  2. `deployBond` → record the bond address from `BondDeployed`.
  3. `grantRole(ROLE_SSI_MANAGER, issuer)` → `addIssuer(issuer)` → `grantRole(ROLE_KYC, issuer)`.
  4. Generate a VC for the investor with ATS `createVC` (key via `read -s`, see ats.md §5);
     `grantKyc(investor, vcId, validFrom, validTo, issuer)`.
  5. Deploy a tiny probe contract `SpikeMinter` (spikes folder) that calls `mint(to, amt)`,
     `issue(to, amt, "")` and `controllerRedeem(holder, amt, "", "")`. Grant it `ROLE_ISSUER` and
     `ROLE_CONTROLLER`. Revoke `ROLE_ISSUER` from the issuer EOA.
  6. Probe `mint(investor, 1_000_000)`; probe `issue(investor, 1_000_000, "")`. Try `mint` to a
     non-KYC address → record the revert reason / selector.
  7. Read `getRoleMemberCount(ROLE_ISSUER)`, `getRoleMemberCount(ROLE_AGENT)`,
     `getRoleMemberCount(ROLE_ADJUSTMENT_BALANCE)`, `decimals()`, `totalSupply()`.
  8. Investor transfers 1 unit to a third KYC'd wallet (ATS transfer rules) and to a non-KYC wallet
     (expect revert).
  9. `revokeKyc(investor)` → probe `controllerRedeem(investor, 1)` (expect **success**: no holder KYC
     check). Re-grant KYC.
  10. After `maturityDate` passes: probe `controllerRedeem(investor, 1)` (expect success).
- **Account / funds:** issuer (≥ 60 HBAR for factory deploy + roles), investor (≥ 5 HBAR).
- **Expected:** both `mint` and `issue` work for `ROLE_ISSUER`; non-KYC mint reverts; controllerRedeem
  works without holder KYC and after maturity; 6 decimals and nominal 1 USD accepted.
- **Record:** exact revert selectors, gas used per call, the bond address (it becomes the testnet
  bond for later flows if all checks pass), time taken.

## S2 — Pause vs controllerRedeem (must, ~20 min, on the S1 bond)

- **Question:** U2 — does `controllerRedeem` revert while the bond is paused?
- **Steps:** `grantRole(ROLE_PAUSER, issuer)`; `pause()`; probe `controllerRedeem(investor, 1)`;
  record result; `unpause()`; repeat (expect success). Also try `mint` while paused.
- **Account / funds:** issuer, < 5 HBAR.
- **Expected:** reverts with `IsPaused` while paused (source says `onlyUnpaused`). Confirms "never pause
  the bond".
- **Record:** revert selector; confirm or correct HANDOVER §9 risk 1.

## S3 — HTS stablecoin into and out of a contract (must, ~2 h)

- **Questions:** U5 associate via HIP-719 from a contract, ERC-20 facade `transferFrom` in /
  `transfer` out; U6 KYC on a contract account; U14 default auto-association of EVM-created
  contracts; facade failure mode (revert vs `false`) for non-KYC / non-associated / frozen recipients.
- **Steps:**
  1. SDK script: `TokenCreateTransaction` — name "Faultline Test USD", symbol "fUSD", `decimals 6`,
     initial supply 1,000,000.000000 to the issuer (treasury), admin + supply + **KYC** + freeze keys =
     issuer ECDSA key, **no wipe key**, `freezeDefault false`. Record token id and EVM address.
  2. Investor: complete the hollow account first if needed (one signed EVM tx from the investor key),
     then `TokenAssociateTransaction` (or rely on auto-association, `-1`, and record which worked) +
     issuer `TokenGrantKycTransaction(investor)`; treasury sends the investor 10,000 fUSD.
  3. Deploy probe `SpikeVault` (spikes folder): `associateSelf(token)` → `IHRC719(token).associate()`;
     `isAssociated(token)`; `pull(token, from, amt)` → `IERC20.transferFrom`; `push(token, to, amt)` →
     `IERC20.transfer` (raw call, record return data); `pushSafe` via OZ `SafeERC20`.
  4. Before associating: read the contract account on the mirror node
     (`/api/v1/accounts/<contractId>` → `max_automatic_token_associations`) → answers U14. Try a direct
     transfer to it.
  5. `associateSelf` → expect code 22; call again → expect 194 (`TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT`)
     and note whether it reverts or returns.
  6. Without KYC on the contract: investor `approve(vault, 100)` via facade; `pull` → record failure
     (expect `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN` 176). Then `TokenGrantKycTransaction` for the
     contract's account id; `pull` again → success; balance-delta matches.
  7. `push` to the investor → success. `push` to the fresh non-KYC account → record revert vs `false`.
     Freeze the investor (`TokenFreezeTransaction`) → `push` → record behaviour; unfreeze.
  8. Measure gas of `pull`/`push` (needed for `invest` / `claim` estimates).
- **Account / funds:** issuer (token create ≈ few HBAR ❓, contract deploy), investor (associate,
  approve), fresh account (≥ 2 HBAR).
- **Expected:** association + KYC are both required; facade reverts on failure (to confirm);
  `SafeERC20` covers either case.
- **Record:** token id/address (reuse later as the testnet stablecoin), every failure mode with its
  code, U14 answer. Update `MockUSD` requirements in the mocks prompt if the failure mode differs.

## S5 — HCS topic publish and read back (must, ~45 min)

- **Question:** U8 — can the oracle publish an attestation JSON to HCS and read it back from the
  mirror node, and how long until it shows up?
- **Steps:**
  1. SDK script: `TopicCreateTransaction().setSubmitKey(issuerPublicKey).setTopicMemo("faultline-spike")`
     → topic id.
  2. Build a sample attestation JSON exactly in the format of docs/ARCHITECTURE.md §6.5 with dummy hex
     values (label `"spike": true`), check its size ≤ 1024 bytes, submit with
     `TopicMessageSubmitTransaction`. Record the receipt's `topicSequenceNumber` and consensus time.
  3. Submit one 1500-byte message to see chunking (expect 2 chunks).
  4. Poll `GET /api/v1/topics/<id>/messages?limit=10&order=desc` and
     `/messages/<sequence_number>`; base64-decode `message`; note fields (`consensus_timestamp`,
     `running_hash`, `chunk_info`, `payer_account_id`) and the delay until visible.
  5. Try submitting from the investor account (not the submit key) → expect `INVALID_SIGNATURE`.
- **Account / funds:** issuer, < 2 HBAR.
- **Expected:** message readable within seconds; only the submit key can post.
- **Record:** topic id, HashScan topic link, delay, exact mirror field names → oracle prompt.

## S6 — ATS coupon entitlement and snapshots (stretch, ~1 h, on the S1 bond)

- **Question:** U9 — can a payer contract read per-holder coupon entitlements at a record date
  (needed for interim coupons)?
- **Steps:** grant `ROLE_CORPORATE_ACTION`; `setCoupon({recordDate: now+3min, executionDate: now+6min,
  startDate, endDate, fixingDate, rate, rateDecimals, rateStatus})`; transfer units between holders
  before and after the record date; after it, `getCouponFor(id, holder)` and
  `balanceOfAtSnapshot(snapshotId, holder)` for each holder.
- **Account / funds:** issuer, < 5 HBAR.
- **Expected:** balances frozen at the record date; ATS records entitlement but moves no cash.
- **Record:** whether interim coupons are feasible; if yes, a one-page design note for the owner (no
  change to the MVP without approval).

## S4 — Schedule Service (stretch, ~1.5 h)

- **Question:** U10 — what exactly works: one schedule; two schedules in one call; recursive
  self-scheduling (a scheduled call that schedules the next); the 62-day limit; `hasScheduleCapacity`.
- **Steps:** deploy probe `SpikeScheduler` (spikes folder, `@hiero-ledger/hiero-contracts`
  `schedule-service/HederaScheduleService.sol`) funded with 10 HBAR by a normal transfer after deploy
  (never `msg.value` in the constructor):
  1. `scheduleOnce(t+60s)` → expect `(22, addr)`; the target emits an event at ~t+60s.
  2. `scheduleTwoExternal(t+60, t+90)` (two schedules to another contract) → record codes.
  3. `scheduleSelfThenOther()` (recursive first, then a second) → expect 373 on the second.
  4. `tick()` that schedules the next `tick()` 60 s later, 3 times → does the chain continue? (code 374
     suggests yes).
  5. `scheduleOnce(t + 5_356_801)` → expect 306; `t + 5_356_800 - 60` → expect 22.
  6. `hasScheduleCapacity(t+60, 2_000_000)` → expect true.
- **Account / funds:** issuer, ~15 HBAR (10 into the probe).
- **Expected:** as above; confirms or kills the self-chaining option for keeper-free coupons.
- **Record:** every response code; update docs/reference/hedera.md §6 and HANDOVER §4.

---

## After all must-spikes

1. Update `contracts/mocks` requirements (MockBond revert names, MockUSD failure mode) in the
   mocks prompt if anything differed from the reference notes.
2. Owner reviews LESSONS "Spike results" before the contract prompts run.
