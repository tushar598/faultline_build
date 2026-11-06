# Lessons, assumptions and answers

Every assumption, problem hit, and owner answer. Phase 2 reads this before rebuilding.
Format: date · area · what · why / fix.

## Owner answers (2026-10-25)

| # | Question (HANDOVER §14) | Answer | Effect |
| --- | --- | --- | --- |
| 1 | Full track text | Given; saved in `docs/TRACK.md` | Testnet deploy + HashScan verification + ≤5 min video are qualification requirements |
| 2 | Which ATS deployment his `.env` uses | v4.0.0 (old test bond TCB) | — |
| 2b | Which ATS deployment Faultline uses | **v8 factory 0.0.9213391** | Matches the local ATS repo (v8.0.0) and ATS issue 1390 |
| 3 | Other ATS bond-form values | "Exactly as listed" (nominal 1,000 USD, max 10,000, maturity 25/12/2026) | TCB is not used for Faultline anyway (nominal must be 1 USD) |
| 4 | Hardhat 2 or 3 | "Decide yourself" → **Hardhat 2** | ATS v8 itself uses Hardhat 2 + solc 0.8.28; owner's prompt also pins Hardhat 2 |
| 5 | Stablecoin setup | **Plain HTS token first** (6 decimals, ECDSA, KYC key, no wipe key); Stablecoin Studio max half a day | Matches HANDOVER §12 |
| — | Testnet accounts for spikes | **Reuse** a throwaway issuer and investor for the spikes only | Keys stay in owner's terminal / keystore |
| — | Dashboard | **Next.js** (not Vite) | HANDOVER §7, §10, §12 updated |

## Assumptions (not yet verified — check before relying on them)

- A1 · EVM · Hedera accepts `cancun` bytecode (MCOPY, TSTORE). Evidence: ATS v8 compiles with
  0.8.28 + cancun and is deployed on testnet. Official Hedera doc check pending (docs/reference/hedera.md).
- A2 · ATS · The Faultline bond is created on the v8 factory with nominal 1 USD, 6 decimals, and the
  pool as the only issuer and controller. Not done yet (spike S1).
- A3 · Stablecoin · HTS token with 6 decimals, ECDSA admin key, KYC key set, no wipe key, freeze key
  optional (decide in spike S3).
- A4 · Keys · On Hardhat 2 the testnet key is read from `HEDERA_TESTNET_PK` set with `read -s` in the
  terminal. Spike scripts may instead live in the owner's separate Hardhat 3 project with its
  encrypted `keystore` (his existing pattern).
- A5 · Dashboard · Next.js 16 App Router + Tailwind 4 + ethers 6, reading a local Hardhat node.

## Problems hit and fixes

- 2026-10-25 · solc · OpenZeppelin 5.6.1 does not compile with `evmVersion: "shanghai"`:
  `The "mcopy" instruction is only available for Cancun-compatible VMs`. HANDOVER §8 said shanghai.
  **Fix:** `cancun` (same as ATS v8). HANDOVER §8 corrected.
- 2026-10-25 · Node · Owner's Mac has Node 24.16.0; Hardhat 2.29.1 runs on it without problems
  (engines `>=16`). No downgrade needed.
- 2026-10-25 · TypeScript · npm `latest` is now TypeScript 7 (native port). Pinned **5.9.3** because
  Hardhat 2 loads TS through ts-node.
- 2026-10-25 · Keys · Hardhat 2 has no encrypted keystore (that is Hardhat 3). `hardhat vars` stores
  values in plain text, so it is not used for keys.
- 2026-10-25 · Next.js · `create-next-app@16.4.3` writes `web/AGENTS.md`: Next 16 has breaking
  changes; read `web/node_modules/next/dist/docs/` before writing dashboard code. `next dev`
  re-creates that file, so keep it committed.
- 2026-10-25 · Next.js · Build warned "multiple lockfiles" and picked the repo root. **Fix:**
  `turbopack.root: path.resolve(__dirname)` in `web/next.config.ts`.
- 2026-10-25 · Local ATS clone · `~/Desktop/asset-tokenization-studio` is the owner's working copy
  (untracked `.vc` files and `redeem.js`). Never edit it; reference reads go to a separate clone.

## HANDOVER.md corrections made

- §8 EVM version: shanghai → cancun (reason above).
- §7, §10, §12: dashboard Vite → Next.js (owner's answer).
- §14: answers recorded.

## Time log

| Stage | Time |
| --- | --- |
| Prep session: read handover, machine check, scaffold | ~30 min |
| Interfaces + shared EIP-712 file + mocks + 39 tests | ~15 min of writing (commits 19:20–19:26), after reading the docs and the ATS v8 source |
| Spike S5 (HCS) | 4 transactions in 7 min (19:42–19:49 UTC); scripts written and dry-run before that |
| FaultlinePool + 75 tests + docs | ~35 min after reading the spec (commits 01:35–01:45 local); one owner Q&A round for 3 spec gaps |
| FaultlineTrigger + 57 tests + docs | ~30 min after reading the spec; one owner Q&A round for 2 spec points |
| Local e2e + shared/ts + fixtures + docs | ~45 min; no owner Q&A |

## Findings from the ATS v8.0.0 source (2026-10-25)

Read-only clone: `~/Desktop/faultline-refs/asset-tokenization-studio` (commit `be4f860`, tag
`v.8.0.0-ats`). The owner's own copy at `~/Desktop/asset-tokenization-studio` is the same commit.

- Mint: both `mint(address,uint256)` and `issue(address,uint256,bytes)` exist (`facets/mint/IMint.sol`).
  Guards: operational, activated, unpaused, single partition, `ROLE_ISSUER` **or `ROLE_AGENT`**,
  within max supply, recipient KYC `GRANTED` + compliance. The minter itself needs no KYC.
- `controllerRedeem`: `ROLE_CONTROLLER` **or `ROLE_AGENT`**, unpaused, controllable, single partition.
  No KYC check on the holder, no maturity check.
- `grantKyc(account, vcId, validFrom, validTo, issuer)` needs `ROLE_KYC`; issuer must be registered
  with `addIssuer` (needs `ROLE_SSI_MANAGER`).
- HANDOVER glossary said units are burned at write-down; fixed (loss index, burn at redemption).

## Design decisions approved in the prep session (2026-10-25)

Owner approved all recommendations (details: docs/ARCHITECTURE.md §12):
D1 per-event `lossBps` (fixes the concurrent-event bug), D2 submit blocked while paused,
D3 `sweepExcess`, D4 on-chain supply guard + role checks, D5 deploy wiring, D6 sponsor-only funding,
D7 coupon cut at execution time, D8 USGS `ids` ledger in the oracle, D9 no lock/hold roles on the bond.

## Findings from the reference research (2026-10-25)

- Hedera supports Cancun opcodes since v0.50 and now runs Pectra → `cancun` target confirmed (A1 resolved).
- Hedera: 15M gas per tx; unused gas fully refunded (old 80% rule gone).
- HANDOVER was wrong that nested scheduling is "probably unsupported": official response codes 373/374
  imply recursive self-scheduling works (~4M times); only a second schedule after a recursive one in the
  same operation fails. Spike S4 must still confirm. HANDOVER §4 corrected.
- OZ 5.6 marks `ReentrancyGuard` deprecated → use `ReentrancyGuardTransient` (TSTORE).
- HCS: 1024 bytes per message chunk; keep each attestation JSON in one chunk.
- USGS: real Bhuj event id is `usp000a8ds` (M7.7 `mwc`, reviewed, depth 16 km). `properties.ids` has
  leading/trailing commas. Deleted event by id → HTTP 409; unknown id → 404. Saved as real fixtures.
- USGS "Magnitude Types" page returns 403 to scripts; meanings taken from a search excerpt of it.
- ATS `createVC` task takes the issuer private key as a CLI argument (lands in shell history) → use
  `read -s` and a variable.
- `setCode` mock at `0x16b` works in Hardhat 2 (tested in a throwaway project); it copies runtime
  code only, not storage.
- New open design gap D10: a historical quake (2001) cannot pass `riskStart <= observedAt <= now` on a
  2026 bond → replay-mode terms needed for the demo.
- D10 approved: replay terms; magTypes mww,mwc,mwb,mwr,mw approved (2026-10-25).

## Origin chat read (2026-10-25)

Owner shared the original claude.ai chat; digest in docs/CONTEXT.md. New facts:
- The spike investor is a **hollow account** (mirror node: no key). Both spike accounts have
  `max_automatic_token_associations = -1`.
- TCB form flags: Controllable ON, Internal KYC ON, Blocklist ON, Approval list OFF, Clearing OFF, Reg S.
- After a factory deploy the issuer had only the Admin role; all other roles were self-granted.
- Original name was "Kavach Re".
- D2 refined (owner approved 2026-10-25): submission cutoff = `maturity + grace` + total paused time.
  Applying it showed redemption must move with it: `redeem`, `sweepExcess`, `sweepDust` now open only after
  the same `submissionDeadline()` and never while paused — otherwise a late attestation could land after a
  holder redeemed (breaks HANDOVER §12). Trust note: a trustee re-pausing repeatedly delays redemption
  until the admin acts.

## Owner decisions before the spikes (2026-10-25)

- **Mock policy:** use real Hedera testnet wherever it can do the job; no mock there. Mocks only for tests
  that need time travel (maturity, challenge window, grace) or must run many times. Every mock is matched
  to a spike's real result; a mock whose behaviour is not testnet-verified says "not testnet-verified".
- Spikes S1–S3 first; parameters (box, payout curve, grace, coupon %) after them.
- Every testnet transaction needs the owner's confirmation first. Keys only in the owner's terminal or the
  Hardhat keystore.
- S1–S3 use throwaway spike accounts. Faultline's real contracts get their own accounts (the FLH_* set,
  docs/ACCOUNTS.md): deployer, trustee, oracle signer, relayer, sponsor, investors.
- S0 (revoke Redeemer's ROLE_CONTROLLER on TCB) runs after the spikes, with confirmation.
- Spike code lives in a separate throwaway spikes folder (its scripts became `ops/`). The tutorial clone
  `~/Desktop/hedera-code-snippets/hss-schedule-sc-calls` is left untouched; the Hardhat 3 keystore is global,
  so its keys are reused.

## Spike prep results (2026-10-25, read-only, no transaction sent)

- Spikes folder (Hardhat 3.21.0, ethers 6.17, @hashgraph/sdk 2.81.0,
  hiero-contracts 0.2.0, OZ 5.6.1). Every script is dry-run by default; real tx only with `EXECUTE=1`.
- **Hardhat 3 HTTP provider + Hashio:** large `eth_call` / `eth_estimateGas` (deployBond, ~2.3 KB calldata)
  fail with "Received an unexpected status code from https://testnet.hashio.io"; the same request via
  curl or a plain ethers `JsonRpcProvider` works. Fix: spikes use a plain ethers provider for reads and
  an in-memory ethers `Wallet` built from the keystore value for writes. (Faultline's own Hardhat 2 setup:
  watch for the same issue in the testnet task.)
- **deployBond simulation passes** on the v8 factory with our inputs: Luhn ISIN (`US` + `FLS` + 6 digits),
  Reg S / NONE, 6 decimals, nominal `100` with 2 decimals (1 USD), controllable, internal KYC, roles
  pre-assigned through `rbacs`. Simulated via mirror-node `eth_call` only — U4 still needs the real tx.
- Gas: deployBond ≈ 7,811,648 gas; testnet gas price 1,160 gwei-equivalent (`eth_gasPrice` 0x10e15635000)
  → ≈ 9.06 HBAR. Other S1/S2 calls estimated ≈ 0.1–0.5 HBAR each → S1+S2 ≈ 16 HBAR total (estimate).
- ISIN checksum code checked against 4 real ISINs (US0378331005, US5949181045, AU0000XVGZA3, GB0002634946).
- The factory renounces its own admin role after deploy; `rbacs` must contain a non-zero DEFAULT_ADMIN.
- `grantKyc` does not verify the VC on-chain; it stores `vcId` and needs a registered issuer. The owner's
  existing VC (`urn:uuid:c4b564b4-…`, holder = investor) is reused, so no key goes on the command line.

## Spike results

### S1 step 1 — `deployBond` on the ATS v8 factory (2026-10-25, testnet-verified)

- **Answer: the v8 factory accepts the Faultline bond shape (U4 verified).** `deployBond`
  SUCCESS on the spike bond (maturity ≈ 45 min after deploy).
- Views on the new bond: name "Faultline Spike Bond", symbol FLSPK, `decimals()` 6, `getNominalValue()` 100
  (2 decimals = 1 USD), `isControllable()` true, `paused()` false, internal KYC on, `totalSupply()` 0.
  Role member counts: DEFAULT_ADMIN, KYC, SSI_MANAGER, PAUSER = 1 each (the issuer); ISSUER, CONTROLLER,
  AGENT, ADJUSTMENT_BALANCE = 0. So `rbacs` in `BondData` assigns roles at deploy and nobody can mint yet.
- Gas used 7,332,487 vs estimate 7,811,706 (−6 %). Issuer balance 31.07 → 23.01 HBAR (≈ 8.07 HBAR spent;
  estimate was 9.06).
- The mirror-node `eth_call` simulation of `deployBond` returned **exactly** the address that was later
  deployed, so a dry run can predict the bond address before sending.
- Plan drift: the script uses start = now + 2 min and maturity = now + 45 min (`MATURITY_MIN`), not
  SPIKES.md's + 5 / + 30 min, to leave time for steps 02–08.

### S1 steps 2–9 — roles, KYC, mint vs issue, controllerRedeem (2026-10-25, testnet-verified)

All on the spike bond; probe = owner-only `SpikeMinter`.

| Question | Answer (testnet) |
| --- | --- |
| U1 mint function | **Both work** for a contract holding `ROLE_ISSUER`: `mint(address,uint256)` and `issue(address,uint256,bytes)`, 1.000000 each → `totalSupply` = `balanceOf(investor)` = 2,000,000 |
| EOA without `ROLE_ISSUER` mints | reverts `AccountHasNoRoles(account, [ROLE_ISSUER, ROLE_AGENT])`, selector `0x90e55392` (simulation) |
| U3 part 1: `controllerRedeem` on a holder with **no KYC** | **works**: after `revokeKyc(investor)` (status 0) the probe burned 1 base unit (supply 2,000,000 → 1,999,999) |
| U3 part 2: `controllerRedeem` **after** maturity | **works**: tx at 1792931135 > `maturityDate` 1792931068 burned 1 more unit (supply → 1,999,998) |
| v8 role order | roles given at deploy through `rbacs` (DEFAULT_ADMIN, SSI_MANAGER, KYC, PAUSER) → `addIssuer(issuer)` → `grantKyc` per wallet → `applyRoles([ISSUER, CONTROLLER], [true, true], probe)` in one tx. No separate `grantRole` calls needed |
| `getRoleMemberCount` | counts members as expected; after step 05: ISSUER 1, CONTROLLER 1 (both the probe), AGENT 0, ADJUSTMENT_BALANCE 0; `getRoleMembers` lists the probe |
| KYC revoke → re-grant | `grantKyc` works again after `revokeKyc` (status back to 1) |
| Transfer investor → KYC'd wallet | simulation OK (gas ≈ 500k); not sent (would need the investor key) |
| Non-KYC mint / transfer | **not tested**: no fresh account yet (`FRESH_ADDRESS` unset) |

Gas used per call: addIssuer 126,989 · grantKyc 273,917 / 256,985 / 256,817 · deploy SpikeMinter 315,547 ·
applyRoles 321,620 · mint 477,449 · issue 216,948 · revokeKyc 93,646 · controllerRedeem 178,446 (both).

HBAR: mirror-node `charged_tx_fee` sum for all 13 S1 txs = **11.16 HBAR** (deployBond 8.07, steps 2–9 3.10,
of which 0.12 was the failed revokeKyc). The issuer was topped up during the run (balance now 69.91 HBAR).

Surprises:

- **`gasLimit == eth_estimateGas` can run out of gas.** The first `revokeKyc` (limit = estimate 112,375) reverted
  with `CONTRACT_REVERT_EXECUTED` and empty revert data, gas used 111,340. `eth_call` with 112,375 gas reverts,
  with 135,000 it passes; the retry with a 1.3× limit used only 93,646. Fix in the spikes: `step()` sends with
  `gasLimit = estimate × 1.3`. The fee followed gas used, not the limit, so the buffer cost nothing here.
  **Faultline scripts must add a gas buffer to every Hedera tx.**
- First mint cost ~2.2× the second (`issue`) on the same holder. Likely first-time storage writes; not checked.
- On HashScan / mirror node the transaction id's payer is the Hashio relay account `0.0.7314364`, not the issuer;
  search by the EVM tx hash.
- `controllerRedeem` has no holder-KYC and no maturity guard, exactly as the v8 source says, so the design
  (pool redeems at `submissionDeadline()`, after maturity, holders may have lost KYC) stands unchanged.

### S2 — pause vs controllerRedeem and mint (2026-10-25, testnet-verified)

- **Answer (U2): while the ATS bond is paused, `controllerRedeem` and `mint` both revert with `IsPaused()`,
  selector `0x1309a563`.** After `unpause()` the same `controllerRedeem` works again.
- Evidence: `controllerRedeem` — simulation **and** an on-chain failed tx (`CONTRACT_REVERT_EXECUTED`, mirror-node `error_message` `0x1309a563`, nothing burned). `mint` — simulation only.
- Sequence on the spike bond: `pause()` → `paused()` true → both calls revert → `unpause()` → `paused()` false →
  `controllerRedeem(investor, 1)` burned 1 unit (`totalSupply` = `balanceOf(investor)`: 1,999,998 → 1,999,997).
- Gas used: pause 79,287 · failed controllerRedeem 55,800 · unpause 55,060 · controllerRedeem 178,446.
- HBAR (mirror-node `charged_tx_fee`): 0.088 + 0.063 + 0.061 + 0.198 = **0.41 HBAR**. Issuer now 69.50 HBAR.
- The failed tx was charged for 55,800 gas, not for its 500,000 limit: a second sign that Hedera testnet now
  charges for gas used (see the S1 gas-buffer note).
- Design impact: none. It confirms the rule "never pause the bond" — a bond pause would also block Faultline's
  redemption burn and any mint. Pause stays inside `FaultlineTrigger` only.


- 2026-10-25 · S3 · Scripts ready, dry-run only, no tx sent (spikes commit `49f08df`): SpikeVault probe + steps 00–08; investor must associate (step 02a) before KYC, since Hedera docs say `TokenGrantKyc` on an unassociated account fails with `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`.

### S3 — HTS stablecoin into and out of a contract (2026-10-25, testnet-verified)

A spike token (6 decimals, treasury = issuer, admin/supply/KYC/freeze = issuer key, no wipe key) and a probe
`SpikeVault`. This project's own fUSD (smoke run) has no freeze key.

| Question | Answer (testnet) |
| --- | --- |
| U5 associate from a contract | **works**: `IHRC719(token).associate()` from the vault returned 22; a second call **does not revert**, it returns 194 `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT` |
| U5 receive via `transferFrom` | **works** once associated + KYC'd: facade returned `true`, vault balance +100 fUSD |
| U5 pay out via `transfer` | **works**: facade returned `true`, investor +10 fUSD |
| U6 KYC on the contract account | **required**: before `TokenGrantKyc(vault)` the pull failed with 176 `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN`; after it, the same pull succeeded |
| KYC grant before association | fails: `TokenGrantKyc(investor)` on an unassociated account → 184 `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`, even with auto-association -1 |
| U14 auto-association of an EVM-created contract | `max_automatic_token_associations` = **-1** (unlimited) — but for a KYC token this does not remove the explicit associate, because KYC needs an association first |
| Facade failure mode | **reverts, never returns `false`** — for no KYC (176), non-associated + non-KYC recipient (176, after an in-tx auto-association that rolls back; not 184) and frozen recipient (165 `ACCOUNT_FROZEN_FOR_TOKEN`, simulation). The calling contract sees **empty revert data**; the code is only visible in the mirror-node call trace (`/contracts/results/<hash>/actions`, `REVERT_REASON 0x…b0`) or a direct `eth_call` |
| OZ SafeERC20 | catches it (it reverts), but with **no reason** ("no data present") |
| Hollow investor | its first signed EVM tx (`associate()` via the facade) completed it: key now ECDSA, `ethereum_nonce` 1 |
| Treasury | auto-associated and KYC GRANTED at token creation |

Gas (used): facade `associate()` 726,488 (EOA) / 733,941 (contract, **same for the 194 call**) · facade `approve`
727,020 · vault deploy 579,321 · `pullRaw`/`pushRaw` ≈ 51,600–51,930 including the vault's two `balanceOf`
reads (inner HTS `transferFrom` / `transfer` call ≈ 15,300 gas; failed and successful cost the same).
HBAR: TokenCreate 13.393 (base $1.00 at $0.0769 ≈ 13.0, so ~0.4 HBAR extras); KYC / transfer / freeze /
unfreeze 0.013 each; associate and approve ≈ 0.80 each (HTS fee charged as gas); pull/push ≈ 0.057 each.
**S3 total 17.55 HBAR** (issuer 63.83 → 47.88, investor 100.00 → 98.40).

Surprises and impact (no design change):

- The investor onboarding needs **associate → KYC → fund**; auto-association never helps a KYC token. Faultline's
  pool already associates in `initialize` and needs KYC on its own account (HANDOVER §6) — confirmed.
- A failed facade transfer reverts with **empty data inside the EVM**, so the pool cannot tell KYC from freeze
  on-chain. `invest`/`claim` should revert cleanly (SafeERC20) and the dashboard should explain likely causes.
  **MockUSD must revert (empty data or a custom error), never return `false`**, on non-KYC / frozen / unassociated.
- `associate()` costs ~0.8 HBAR even when it only returns 194: call it once in `initialize`, not defensively.
- The investor's `approve` costs ~0.8 HBAR (HTS approve priced like associate) — relevant for the demo budget.

### S1 leftovers — non-KYC checks with the fresh account (2026-10-25, simulation only)

- Probe `mint` to a non-KYC fresh wallet reverts `InvalidKycStatus()`, selector `0xfc855b1b`.
- Investor `transfer` of the ATS bond to the non-KYC fresh wallet reverts `InvalidKycStatus()` (`0xfc855b1b`);
  to the KYC'd issuer wallet it simulates OK. No transaction sent.

### S0 — housekeeping on the old test bond TCB (2026-10-25, testnet-verified)

- **Done:** `revokeRole(ROLE_CONTROLLER, Redeemer)` on TCB (ATS v4) from the issuer, SUCCESS, gas 75,968 (estimate 91,161), fee 0.084 HBAR. Exactly one tx; nothing else touched.
- After: `hasRole(CONTROLLER, Redeemer)` false; CONTROLLER members 1 (the issuer); TCB `totalSupply` unchanged at 4,000,000.
- `Redeemer.redeem(TCB, investor, 1)` now reverts (simulation from the fresh account and from the issuer):
  `AccountHasNoRoles(Redeemer, [ROLE_CONTROLLER, ROLE_AGENT])`, selector `0x90e55392`. The v8 ATS error ABI decodes the v4 bond's error.
- Note: an `eth_call` from an address that is not a Hedera account fails with "Sender account not found"; simulate
  from an existing account.


### S5 — HCS topic publish and read back (2026-10-25, testnet-verified)

- **Answer (U8): yes.** The issuer created a private-write topic, published the §6.5 attestation JSON with the SDK,
  and read it back from the mirror node **byte-for-byte equal**, visible **3.14 s** after submit (receipt 1.89 s).
- Spike topic, memo `faultline-spike-s5`: `submit_key` = issuer ECDSA key, `admin_key` null (immutable), auto-renew
  = the payer / 7,776,000 s (SDK default, 90 days).

| Question | Answer (testnet) |
| --- | --- |
| Publish | `TopicMessageSubmitTransaction` → receipt `topicSequenceNumber` 1 and `topicRunningHash` (48 bytes) |
| Delay until visible | small (1 chunk): 3.14 s after submit; consensus 0.66 s after submit; mirror ≈ 2.5 s after consensus. Big (2 chunks): 4.69 s |
| Mirror field names (list and by-sequence) | `chunk_info`, `consensus_timestamp`, `message` (base64), `payer_account_id`, `running_hash` (base64), `running_hash_version` (3), `sequence_number`, `topic_id` |
| Running hash | mirror `running_hash` (base64) == receipt `topicRunningHash` for every message |
| Query params that work | `limit`, `order=asc\|desc`, `sequencenumber=N` and `sequencenumber=gte:N`, `timestamp=<ts>`, `encoding=utf-8` (returns `message` as plain text instead of base64); `GET /api/v1/topics/{id}/messages/{seq}`, `GET /api/v1/topics/messages/{consensus_timestamp}`, `GET /api/v1/topics/{id}` |
| Chunking | 1,500 bytes → **2 transactions** (1,024 + 476 bytes; tx ids valid start +1 ns), **2 sequence numbers** (2, 3), each with its own consensus time, running hash and fee. Both have the same `chunk_info.initial_transaction_id`, `number` 1/2 and 2/2. The mirror node does **not** re-assemble: the reader concatenates by `number` |
| Submit key | investor-signed submit → `INVALID_SIGNATURE` **at consensus** (receipt), not at precheck: the investor still paid 0.00218 HBAR; no message added |
| Fees actually paid | TopicCreate **0.25610 HBAR = $0.0200** (table base $0.01 — the extra $0.01 is unexplained, probably HIP-1261 extras for the key / auto-renew account); submit 636 B 0.00684, 1,024 B 0.01022, 476 B 0.00545 HBAR; failed submit 0.00218 HBAR. **S5 total 0.281 HBAR** (issuer 47.798 → 47.520) |

Surprises and impact (no design change):

- **Submit fee = $0.0001 + $0.00000068 × message bytes** (fit on three messages at $0.07809/HBAR; predicts the
  636-byte fee exactly). The fee table's "$0.0008" is the price of a full 1,024-byte message, not a flat base.
  A real attestation (~650–700 bytes) costs ≈ $0.00055.
- Even a one-chunk message carries `chunk_info` (`number 1, total 1`), because the SDK always sets it.
- `TopicMessageSubmitTransaction.execute()` returns only the first chunk's response; use `executeAll()` to get
  every chunk's receipt.
- A wrong signer pays a fee: the oracle must never retry a failed submit blindly.
- Impact on ARCHITECTURE §6.5: none. One attestation = one ≤ 1,024-byte message = one sequence number, as designed.
  The oracle reader should read `sequence_number`, check `payer_account_id` / the topic submit key, and decode
  base64 (or ask for `encoding=utf-8`).


## D11 — KYC pre-check (owner decision 2026-10-25)

- Owner chose (a): `FaultlinePool` pre-checks stablecoin KYC via `0x167` `isKyc(token, account)` before
  `fundCoupons`, `invest` and `claim`, and reverts with `NotKycForToken(account)` / `HtsCallFailed(code)`.
- Read-only testnet simulation (mirror-node eth_call on the spike token): investor, vault and treasury →
  `(22, true)`; fresh account never associated → `(22, false)`, not 184. `isFrozen` works the same way
  (`(22, false)` for all). `isKyc` ≈ 24.6k gas. Not yet confirmed from an on-chain tx (U15).
- Freeze is NOT pre-checked (not approved); a frozen recipient still gets an empty revert.
- ATS error selectors for MockBond (from the ATS v8 ABI, match spike results): `AccountHasNoRoles(address,bytes32[])`
  0x90e55392, `InvalidKycStatus()` 0xfc855b1b, `IsPaused()` 0x1309a563, `TokenIsNotControllable()` 0xf4b7b072,
  `MaxSupplyReached(uint256)`.

## Interfaces and mocks (2026-10-25, mock-tested only)

- Problems hit:
  - solc NatSpec: a backticked npm name like `@hiero-ledger/...` inside `///` is parsed as an unknown tag
    (`DocstringParsingError`). Fix: no `@` inside NatSpec text.
  - Trigger view `getEvent(bytes32)` clashes with ethers v6 `BaseContract.getEvent()`: typechain output fails
    `tsc` ("Duplicate identifier 'getEvent'") and `trigger.getEvent(id)` would call the ethers method.
    Owner approved the rename to `getEventRecord` (ARCHITECTURE §4.3, §13).
  - Solidity interfaces cannot hold constants: the ATS role ids and HTS codes are file-level constants in
    `IAtsBond.sol` / `IHederaTokenServiceLite.sol`; `test/helpers/roles.ts` reads them from the `.sol` source,
    so there is one source of truth (a test compares it with docs/reference/ats.md §3).
- Mock fidelity (copied from S1–S3): ATS guard order pause → controllable → role → max supply → KYC, same error
  signatures and selectors; HTS facade failures revert with **zero bytes**, never `false`; `associate()` 22 then 194;
  KYC grant needs association; treasury associated + KYC'd at creation; MockHTS at `0x167` returns `(22, flag)`.
- Not modelled (stated in NatSpec): ATS VC dates / registered issuer in `grantKyc`, ATS compliance modules,
  partitions, locks/holds; HTS approve rules, auto-association, error codes for a non-token `isKyc` argument.
- Extra test-only contracts: `RawCaller` (shows what a calling contract sees, e.g. empty revert data) and
  `ApplyLossRecorder` (tests MockTrigger forwarding before FaultlinePool exists).

## FaultlinePool (2026-10-26, mock-tested; deployed on testnet 2026-11-05, docs/TESTNET-EVIDENCE.md)

- **Written:** `contracts/FaultlinePool.sol` exactly per ARCHITECTURE §3 + D12. Tests: `test/pool.{setup,fund,invest,
  loss,redeem,claim,sweep,reentrancy}.test.ts` (75 tests) with `test/helpers/pool.ts` (fixtures + invariant checks
  after every state-changing step: invariant 1 in both forms, `isSolvent()`, invariant 3, invariant 4,
  `totalClaimable == sum(claimable)`). Whole suite 114 passing. One small on-chain fast-check property (sponsor credit
  over random U split and random increasing loss sequences); the full model-based suite comes later.
- **Owner decisions in this task:** constructor takes a `Params` struct with an explicit `admin`; **D12** —
  `applyLoss` reverts `RiskPeriodNotStarted()` while `now < riskStart` (new error in IFaultlinePool); a test-only
  `MockVariants.sol` instead of changing the existing mocks.
- **Implementation choices (within the spec):** decimals ≠ 6 and zero `couponBps`/`cap`/`minTicket` revert
  `InvalidSchedule` (the error's NatSpec covers "parameters"); `isSolvent()` uses the always-true form of invariant 1
  (the `collateralLeft + couponReserveLeft` form is false after `sweepExcess`); `sweepExcess`/`sweepDust` never revert
  on 0 — they emit `ExcessSwept(0)` / `DustSwept(0)`; redemption and sweeps revert `NotInitialized` before
  `initialize`; `nonReentrant` on `fundCoupons`, `invest`, `redeem`, `claim` (the four that move tokens or burn).
- Problems hit and fixes:
  - typechain: a public `target` on a test contract clashes with ethers v6 `BaseContract.target` (same class as the
    `getEvent` rename): `tsc` fails in the generated factory. Renamed to `hookTarget` / `hookData`. **Never name a
    public member `target`, `interface`, `runner`, `getEvent`, … in contracts that get typechain types.**
  - MockUSD can only return 22 / 194 from `associate()` and MockHTS only code 22, so the `HtsCallFailed` paths need
    stand-ins: `MockTokenVariant` (decimals + fixed associate code) and `MockHtsVariant` (fixed `isKyc` code; an
    immutable survives `setCode`). `MockReentrantToken` (calls back from `transfer`) proves the reentrancy guard.
  - Compiler warning about transient storage comes from OZ `TransientSlot` (ReentrancyGuardTransient); expected.
  - Not covered: the `nonReentrant` branch of `redeem` (its only external calls go to the trusted ATS bond and to
    trigger views; a re-entrant bond would be a test-only fiction). Coverage otherwise 100 % lines and functions.
- **Gas** (`npm run test:gas`, Hardhat local, solc 0.8.28, optimizer 200; Hedera gas will differ — HTS facade
  calls cost ~700k+ on testnet for associate/approve, S3):

| Function | Min | Max | Avg |
| --- | --- | --- | --- |
| deploy FaultlinePool | 2,209,957 | 2,210,014 | 2,210,002 |
| initialize | 36,976 | 60,928 | 57,663 |
| fundCoupons | 74,303 | 117,841 | 105,725 |
| invest | 107,897 | 168,512 | 143,956 |
| applyLoss (via MockTrigger.forwardApplyLoss) | 46,828 | 126,950 | 94,705 |
| redeem | 99,031 | 195,969 | 161,704 |
| claim | 55,712 | 70,391 | 63,171 |
| sweepExcess | 56,694 | 120,294 | 79,781 |
| sweepDust | 48,171 | 53,833 | 50,058 |

- Every function is O(1) and far below Hedera's 15M gas limit. On testnet, add the 1.3× gas buffer (S1 lesson) and
  expect the `isKyc` pre-check (~24.6k simulated, U15) on top.

## FaultlineTrigger (2026-10-26, mock-tested; deployed on testnet 2026-11-05, docs/TESTNET-EVIDENCE.md)

- **Written:** `contracts/FaultlineTrigger.sol` per ARCHITECTURE §4 (OZ AccessControl + EIP712("FaultlineTrigger", "1"),
  `ECDSA.tryRecoverCalldata` → our `InvalidSignature`). Tests: `test/trigger.{setup,submit,revision,pause,execute,
  integration}.test.ts` (57 tests) with `test/helpers/trigger.ts` (fixture on the REAL FaultlinePool, signing from
  shared/attestation.eip712.json, status model check: `pendingCount == #Pending`, terminal statuses unchanged).
  Whole suite **171 passing**.
- **Owner decisions in this task:** (1) `submit` checks the status before `FullyWrittenDown`, so every terminal
  event's replay reverts `EventFinalised` (otherwise Superseded — only possible at L = 10000 — could never report
  it); (2) `ATTESTATION_TYPEHASH` public and in IFaultlineTrigger; tests check it against the JSON type string and
  `hashAttestation == TypedDataEncoder.hash(domain, JSON types, att)`.
- **Coverage** (`npm run coverage`): FaultlineTrigger lines 83/83, functions 14/14, branches 72/72;
  FaultlinePool unchanged (134/134, 23/23, 95/96 — only `redeem`'s `nonReentrant` branch).
- Problems hit and fixes (all in tests; the contract needed no fix):
  - ethers v6 refuses to recover a high-s signature (`non-canonical s`), so the malleability test proves "same
    signer under raw ecrecover" by calling the `0x01` precompile with `eth_call`, then shows the trigger rejects it.
  - Every reverted transaction still mines a block (+1 s), so `advance(n)` after a revert drifts; tests that compare
    exact times use `travelTo(ts)` / `setNextBlockTimestamp`.
  - `pool.couponIndex()` is the stored checkpoint; before a redeem the expected coupon needs
    `pool.currentCouponIndex()` (view accrual).
  - An event submitted early in the risk period has long passed its window by the deadline: tests that veto after
    the deadline must submit in grace.
- **Gas** (local Hardhat, solc 0.8.28, optimizer 200; `npm run test:gas` + a one-off probe for submit vs revise):

| Function | Gas (probe) | Report min / max / avg |
| --- | --- | --- |
| deploy FaultlineTrigger | — | 2,001,766 |
| submit (new event, first ever) | 137,626 | 64,637 / 137,626 / 127,858 |
| submit (new event, pendingCount already warm) | 120,526 | |
| submit (revision of a pending event) | 64,649 | |
| veto | 42,968 | 38,168 / 42,968 / 40,181 |
| execute (incl. pool.applyLoss) | 142,757 | 41,223 / 147,557 / 113,536 |
| pause | 30,379 | 30,379 |
| unpause | 53,038 | 35,938 / 53,038 / 49,618 |
| setOracle | — | 30,936 |

- Time: ~30 min of writing after reading the spec (commits 9edc57a–69ce1cf), one owner Q&A round for 2 spec points.

## Local end-to-end (2026-10-26, mock-tested, local only)

- **Built:** `shared/ts/{jcs,attestation}.ts` (pure helpers, only ethers), `oracle/fixtures/synthetic-kutch-{1,2,3}.geojson`
  (SYNTHETIC, ids `synthetic-kutch-N`), `scripts/lib/{fixtures,e2e}.ts`, `scripts/e2e-local.ts` (`npm run e2e:local`),
  tests `test/shared.{jcs,attestation}.test.ts`, `test/e2e.local.test.ts`, `oracle/test/shared-import.test.ts`.
  Suite: 191 Hardhat tests + 1 oracle vitest. Real FaultlinePool + FaultlineTrigger on MockUSD / MockBond / MockHTS:
  **MockBond is not ATS and nothing here touched testnet.**
- **Results** (U = 10,000 USD from A 5,000 / B 3,000 / C 2,000; reserve 600 USD; books close to the base unit in
  every flow: paid out 10,600 = deposits 10,000 + reserve 600, pool ends at 0):
  - Flow A (veto + replay): L 0; A 5,000 + 300, B 3,000 + 180, C 2,000 + 120; sponsor 0.
  - Flow B (Bhuj 7000 → synthetic M7.2 2000 in grace): L 9000; sponsor credited 9,000 + 405.903285 unused reserve;
    A 500 + 97.048358, B 300 + 58.229014, C 200 + 38.819343 (the second loss lands after maturity: coupons unchanged, D7).
  - Flow C (Bhuj + synthetic M7.5 + synthetic M7.3 pending together): L 10000, third Superseded; sponsor 10,000 +
    538.765900; A 0 + 30.617050, B 0 + 18.370230, C 0 + 12.246820.
- **Problems hit and how they were solved:**
  - JCS: npm `canonicalize` was not used because shared/ts may depend only on ethers. Own RFC 8785 implementation
    (`JSON.stringify` for primitives already matches JCS escaping and ES number format; keys sorted by UTF-16 code
    units), tested against the RFC §3.2.2 sample, §3.2.3 sorting example and Appendix B numbers.
  - **Cross-package import (root CommonJS ↔ oracle ESM):** shared/ts has no package.json, so its files are
    CommonJS-format under the root `package.json`. Root (ts-node, `moduleResolution: node`) imports
    `../shared/ts/attestation` without extension; the oracle (`nodenext`) must write `../../shared/ts/attestation.js`
    and its tsconfig `rootDir` had to widen from `.` to `..` (TS6059 otherwise). `ethers` resolves from the root
    `node_modules` (so `npm run setup` must install the root first, which it does). The JSON import of
    shared/attestation.eip712.json works on both sides. `npm run oracle:test` (vitest) is now part of `npm run check`.
  - ARCHITECTURE §6.2's example was wrong: `7.7 * 100 === 770` exactly in JS; `8.2 * 100` is `819.9999999999999`.
    For two-decimal magnitudes floor and round never differ between 6.00 and 8.00, so under D13 the rounding never
    changes a loss; `round` stays the rule. Doc corrected (§13).
  - Over HTTP (`--network localhost`) a revert is a `ProviderError` without ethers' decoded `revert`; the e2e's
    `expectRevert` walks nested `data` fields and falls back to the message text. In-process both shapes work.
  - Every reverted transaction mines a block (+1 s), so a 1-hour pause showed as 3,602 s; the e2e logs the real value.
  - §5 invariant 1's bookkeeping form (`balance >= collateralLeft + couponReserveLeft + totalClaimable`) is false by
    design after `sweepExcess` (the views ignore what the sweep released); the e2e asserts it until the first sweep and
    `isSolvent()` (the always-true form) after every step.
  - Flow C: between executing Bhuj and the M7.5 event (one block apart) coupons still accrue at 30 %: each holder
    gains 2–3 base units. Correct per §3.4, visible in the log.
  - Fixture times: synthetic events are offsets from the real Bhuj origin time, so the one replay `timeOffsetSec`
    (D10, Bhuj at riskStart + 10 days) puts all of them inside the risk period.
- Time: ~45 min after reading the brief (commits 5896c25–31c3019 + docs), no owner Q&A needed.

## Testnet smoke run (HANDOVER §10 step 5b, 2026-11-05)

Scripts: `ops/scripts/smoke/` (dry run by default, `EXECUTE=1` only by the owner), on the FLH_* accounts
(docs/ACCOUNTS.md). Every tx is in docs/TESTNET-EVIDENCE.md "Smoke run".

- **D14:** replay cooling on the real clock; replay terms only on chainIds 31337 / 296 (off-chain guard in shared/ts
  `buildAttestation` and in every deploy script).
- **Importing shared/ts from `ops/` (ESM).** shared/ts is CommonJS-format TypeScript under the root `package.json` (no
  `"type": "module"`) and imports `./jcs` and the EIP-712 JSON **without file extensions**. `ops/` is ESM (Hardhat 3 +
  tsx): a plain `import … from "../../../shared/ts/attestation.ts"` fails with `Cannot find module './jcs'`, because
  Node's ESM→CJS translator resolves the inner `require` with Node's own rules (no `.ts` probing). **Fix:** `register()`
  from `tsx/cjs/api` + `createRequire(import.meta.url)` loads the REAL module, no copy (`ops/scripts/smoke/lib.ts`
  `sharedTs()`). Smoke-5 reads `trigger.hashAttestation(att)` by `eth_call` before `submit` and aborts unless it equals
  the local `attestationDigest(att, 296, trigger)`; on 2026-11-05 both were `0xc5eec891…41277c40`.
- **Preflight** (no tx): all six smoke keystore names present and, with `CHECK_KEYS=1`, deriving to their addresses;
  all paying accounts hollow; build `2a71b00` clean; creation keccak FaultlinePool `0x78712136…09563f6d`,
  FaultlineTrigger `0x3205b3ca…aa8fcf3` (the D18 build); live USGS `usp000a8ds` dataHash == saved fixture
  (`0xd604b4f7…2730`). Estimate ≈ 31.5 HBAR deployer at 1,310 gwei-eq and $0.068/HBAR.
- **Hollow deployer as SDK payer, testnet-verified again:** the TokenCreate paid by the hollow deployer (key checked
  against its EVM alias) completed the account in the same transaction, so no extra EVM tx was needed. The mirror node
  returns **two rows for one transaction id**: a `CRYPTOUPDATEACCOUNT` (the completion, fee 0) and the
  `TOKENCREATION`; the recorder picks the nonce-0 row. The sponsor and both investors were completed by their first
  EVM tx (HIP-719 `associate()`).
- **TokenCreate is USD-priced:** 15.05 HBAR at $0.068/HBAR (about $1), the largest single fee of the run. A cheaper HBAR
  makes it dearer in HBAR; budget it from the exchange rate, not from an older run.
- **Bond KYC with an opaque vcId label** (`urn:faultline:smoke:kyc:<role>`): **no real VC document is created**. ATS v8
  `grantKyc` (Kyc.sol, source read) has the modifiers `onlyOperational`, `onlyActivated`, `onlyUnpaused`,
  `onlyRole(ROLE_KYC)`, `notZeroAddress(account)`, `onlyValidKycStatus(NOT_GRANTED, account)`,
  `onlyThreeValidDates(validFrom, validTo, now)` and `onlyValidIssuer(issuer)` (registered with `addIssuer`), then stores
  `{validFrom, validTo, vcId, issuer, GRANTED}` **without verifying any VC document**. A production bond needs a real VC
  signed by the registered issuer.
- **Timing (demo-only profile):** issuance `t + 2` → `t + 15 min`; `BOND_MATURITY_MIN=45`, so phase 3 must start
  ≤ 29 min after the bond deploy; phases 2 → 3 → 4 back to back. The first phase-4 run started 22 s before
  `issuanceStart` and aborted with nothing sent; the rerun a minute later passed. Phase 6 refused (nothing sent) when
  `submissionDeadline()` was more than 900 s away; started 14 min before it, it waited and then settled.
- **Failure policy (owner):** if any tx fails, stop at once and do not retry. A send rejected **before consensus** is
  logged `REJECTED_PRECHECK` (no tx hash); a tx that fails **at consensus** is logged with its mirror fee; a reverted
  pre-send simulation stops an `EXECUTE=1` run. None of that happened: 33/33 SUCCESS.
- **After `sweepExcess`** the bookkeeping form of invariant 1 (`balance >= collateralLeft + couponReserveLeft +
  totalClaimable`) is false by design (`couponReserveLeft` does not drop when the unused reserve moves into
  `claimable(sponsor)`); ARCHITECTURE §5 asserts it only until the first sweep. The always-true form and `isSolvent()`
  held after every step.

### Smoke run summary (2026-11-05, testnet-verified; evidence: docs/TESTNET-EVIDENCE.md "Smoke run")

**Outcome:** full lifecycle on Hedera testnet with the REAL FaultlinePool + FaultlineTrigger (D18 build), a real ATS v8
bond, a real HTS stablecoin and real `0x167`: deploy → associate/KYC → fund → invest → real-USGS replay attestation →
60 s window → execute (L = 7000) → redeem via `controllerRedeem` → claims → sweeps. Books closed to the base unit:
1,001.000000 paid out = 1,000 deposits + 1 reserve; pool ends at 0. No contract change was needed.

**Gas: Hedera used vs Hashio `eth_estimateGas`:**

| Call | Used on testnet | Estimate (Hashio) | Note |
| --- | --- | --- | --- |
| deploy FaultlinePool | 2,283,913 | 2,482,601 | pure EVM |
| deploy FaultlineTrigger | 2,028,097 | 2,230,782 | pure EVM |
| initialize (HIP-719 associate) | 744,974 | 800,657 | HTS association is priced as ~0.7M gas |
| HIP-719 `associate()` by a holder | 726,488 | 782,243 | same price class |
| fUSD approve (HTS facade) | 727,020 | 782,773 | HTS approve priced like associate |
| fundCoupons | 73,582 | 80,870 | real `isKyc` ×2 is cheap |
| invest (first / second holder) | 542,282 / 473,882 | 570,519 / 502,253 | ATS `mint` |
| submit | 137,626 | 144,883 | equals the local probe |
| execute (incl. applyLoss) | 142,746 | 150,000 | |
| redeem (first / second) | 327,276 / 242,629 | 377,426 / 291,154 | ATS `controllerRedeem` |
| claim | 48,272–53,072 | 57,926–58,545 | |
| sweepExcess / sweepDust | 127,222 / 78,845 | 134,484 / 86,130 | |
| applyRoles | 321,620 | 350,288 | |
| ATS deployBond / addIssuer / grantKyc | 7,214,839 / 126,989 / 256,661–273,773 | 7,701,411 / 134,251 / 271,058–288,154 | |

Hashio's estimate was 4–16 % above the gas used every time; the 1.3× limit never ran out and cost nothing (fees follow
gas used). Everything that touches HTS or ATS costs far more than the local mocks.

**HBAR actually spent (mirror `charged_tx_fee`):**

| Phase | deployer | sponsor | investor A | investor B | Total |
| --- | --- | --- | --- | --- | --- |
| 1 token (TokenCreate 15.049) | 15.111 | 0.908 | 0.908 | 0.908 | 17.835 |
| 2 bond (deployBond 9.019) | 9.840 | — | — | — | 9.840 |
| 3 deploy | 6.738 | — | — | — | 6.738 |
| 4 subscribe | — | 1.001 | 1.587 | 1.501 | 4.089 |
| 5 event | 0.348 | — | — | — | 0.348 |
| 6 settle | 0.256 | 0.120 | 0.472 | 0.367 | 1.214 |
| **Total** | **32.292** | **2.029** | **2.966** | **2.776** | **40.063** |

TokenCreate and deployBond are 60 % of the run.

**What Hedera did differently from the local mocks** (no contract change needed for any of it):

- Hashio answers `eth_call` from the mirror node, which lags consensus by a few seconds: a read or simulation right
  after a mined tx can see the old state. Every dependent step polls the state and its own simulation first.
- HTS/ATS gas (above) dwarfs the mocks; per-holder onboarding (associate + approve) costs ≈ 1.8 HBAR.
- `isKyc` through the real `0x167` worked inside `fundCoupons`, `invest` and `claim` (U15). The `cancun` bytecode
  deployed and ran (U7).
- `controllerRedeem` by the pool after the ATS bond's maturity worked.
- The replayed `usgsUpdatedAt` is far in the future (Bhuj's record was updated in 2022, plus the offset → 2048). The
  trigger only compares it between revisions, so it is harmless on chain; the dashboard must not show it as a date.

**Time:** phases 2–5 ran back to back in ≈ 17 min of wall clock (20:46–21:04 UTC), then the wait for
`submissionDeadline()` (21:32:00); phase 6 at 21:32.

## Oracle (HANDOVER §10 step 6, 2026-10-27, mock-HCS locally; the real CLI ran on testnet in the full demo, 2026-11-05)

- **Built:** `oracle/src` — `config.ts` (zod; refusal gate: chainId, termsHash, ATTESTATION_TYPEHASH, D14, signer ==
  `trigger.oracle()`), `keys.ts` (env only; Hardhat test accounts only on 31337), `usgs.ts`, `rule.ts` (thin wrapper
  over shared/ts), `ledger.ts` (D8, atomic writes), `decision.ts` (§6.6 / D15 table), `attest.ts` (hashAttestation
  gate), `hcs.ts` (mock + real), `submit.ts`, `service.ts` (watch + D15 pending loop), `keeper.ts`, `cli.ts`;
  `shared/ts/hcsMessage.ts` (§6.5 format, advisories, in-payload signatures, verify). 67 offline vitest tests + 1 opt-in
  live test. `npm run oracle:e2e:local` passed (Bhuj L = 7000, sponsor credited 7,000 USD for U = 10,000; D15 advisory;
  D8 merge → nonce 2 on the original eventId; opt-in live `watch --once` found Bhuj by the box search).
- **USGS research (docs/reference/usgs.md):** U12 measured — the first `reviewed` origin of 10/10 recent M7+ events
  came 0.1–1.0 h after origin time (`includesuperseded=true` shows every product version); U11 — events carry ids from
  several networks (`pt`, `us`, `usauto`), any id resolves to the preferred feature, and the preferred id most likely
  changes when a different network's origin becomes preferred. The FDSN `nodata` default is **204**, not 404.
- **Problems hit and fixes:**
  - `buildAttestation` derives `eventId` from the record's CURRENT preferred id; after a merge (D8) the oracle must
    override it with the ledger's original eventId before signing (`attest.ts`). Without that a merged event would
    become a second on-chain event.
  - **A fresh Hardhat node deploys to the same deterministic addresses**, so the ledger and the mock-HCS file of an
    earlier run (both keyed by the trigger address) were reused: the oracle sent nonce 2 for a brand-new chain (safe on
    chain, wrong in the books). `deploy-local` now removes local state for that address. Testnet addresses never repeat.
  - Two ethers copies (oracle ESM, root CJS used by shared/ts): identical at run time, but their `Signer`/`Provider`
    types are not assignable; the oracle casts at the two shared/ts signing calls.
  - `noUncheckedIndexedAccess` makes every `contract.method()` "possibly undefined"; the oracle uses
    `contract.getFunction("method")`.
  - `{ ...process.env, … }` in the root TS loses the index signature; typed as `NodeJS.ProcessEnv`.
- **Spec question raised and answered (owner, 2026-10-27):** a revision is sent ONLY when `lossBps` changes; any other
  change of a pending event's record goes to the ledger (`notes`) and does not restart the window; `observedAt` leaving
  the risk period is a D15 advisory (`outsideRiskPeriod`, a new advisory reason). decision.ts + 5 new table tests.
- **Step 9 risks noted:** the keeper reads `AttestationSubmitted` logs from `fromBlock`; Hashio may limit
  `eth_getLogs` ranges (not checked). Real HCS publishing is only unit-tested with a stubbed SDK until spike S7 runs.

### S7 — HCS topic keys for the oracle (2026-10-27, testnet-verified)

- **Answer (U16): yes.** A topic with submit key = oracle key, admin key = trustee key and payer = a separate relayer
  works as D16 plans: a message signed by relayer + oracle is accepted; the relayer alone gets `INVALID_SIGNATURE` at
  consensus (charged 0.0022 HBAR, like S5); the trustee admin key alone rotates the submit key away and back (the new
  submit key does not have to sign). The oracle key needs no Hedera account and no HBAR.
- The mirror node returned the published bytes unchanged and `payer_account_id` = relayer; the in-payload EIP-712
  signature of the smoke-run attestation recovered to the oracle — `shared/ts/hcsMessage.ts` verifies real HCS data.
- A hollow relayer can pay a TopicCreate; as with the TokenCreate in smoke-1, the mirror shows an extra
  `CRYPTOUPDATEACCOUNT` row (nonce 1, fee 0). The recorder fix from smoke-1 picked the right row this time.
- **Fees (at $0.0765/HBAR):** TopicCreate with an admin key and two signatures **0.3935 HBAR = $0.030** (3× the $0.01
  base; S5's create without an admin key was $0.020); submit 692 bytes with two signatures 0.0088 ($0.00067; the S5 fit
  `$0.0001 + $0.00000068 × bytes` gives $0.00057, the extra signature explains the rest); TopicUpdate 0.0042 ($0.00032
  vs $0.00022 base). **S7 total 0.4128 HBAR**, all paid by the relayer.
- Operational note (D16): rotating the oracle now needs two parties — the trigger admin (`setOracle`) and the trustee
  (`TopicUpdate` of the submit key). If the trustee's key is lost, the topic's submit key can never change again.

## Dashboard (HANDOVER §10 step 7, 2026-10-27, local; testnet read and one MetaMask redeem + claim verified 2026-11-06)

- **Built:** `web/` (Next.js 16.4.3 App Router, Tailwind 4, GSAP 3.15.0, lucide-react 1.55.0, ethers 6.17.0). Views:
  Overview, Investor, Sponsor, Trustee, Quake replay, Evidence. Reads: ethers `JsonRpcProvider` (no keys), mock HCS via
  `/api/local/hcs`, the local deploy via `/api/local/config` (oracle/config.local.json + terms), USGS via `/api/usgs/[id]`
  (live API, saved real fixture as fallback, SYNTHETIC fixtures labelled). Writes: only the user's EIP-1193 wallet, each
  preceded by a `staticCall` so a revert is shown in plain words before anything is signed. Terms are shown only when
  `termsHash(terms) == trigger.termsHash()`; HCS messages name an event only when their in-payload signature recovers to
  `trigger.oracle()` (D16); the replay map shows the USGS version whose `dataHash` equals the chain's. Style from the ATS
  web theme (neutral scale, status colours, Inter, 4–5 px radii); the one accent is the ATS secondary blue because the ATS
  primary is purple (owner rule: no purple).
- **Tests:** 36 vitest (formatting, error mapping, guards, phase, HCS decode/signatures, describe, ABI vs artifacts,
  testnet termsHash) in `npm run check`; Playwright smoke test (`npm run web:e2e`, ~2 min) on a Hardhat node: overview,
  D15 advisory → trustee veto through the UI, investor/sponsor disabled reasons, Bhuj execute through the UI after a
  90 s window, replay shows L 0 → 7000 and 7,000 USD sponsor credit, investor A 5,000 units → 1,500 USD principal.
- **Problems hit and fixes:**
  - shared/ts lives outside `web/`; Turbopack does not resolve files outside its root. **Fix:** `turbopack.root` = repo
    root plus `resolveAlias: { ethers: "./web/node_modules/ethers" }` (one ethers in the bundle), `outputFileTracingRoot`
    = repo root, tsconfig target ES2022 (shared/ts uses bigint literals). A stale `.next` kept the old TS error until removed.
  - The route handlers read repo files with a computed path → Turbopack warned it would trace the whole project.
    **Fix:** `/*turbopackIgnore: true*/` on the computed repo path (`web/src/lib/server/repo.ts`).
  - React 19 lint (`react-hooks/set-state-in-effect`, refs in render) rejects setState at the top of an effect. Patterns
    used: `useSyncExternalStore` for the wall clock, `window.ethereum` and the stored network; state tagged with the key
    it was loaded for (network, deployment, USGS id) and derived, instead of resetting in an effect.
  - A non-memoised network state object restarted the data poll on every render. **Fix:** `useMemo`.
  - **A Hardhat node mines only on a transaction**, so `block.timestamp` (and `windowRemaining`) froze and Execute never
    enabled in the first Playwright run. **Fix:** the demo script turns on `evm_setIntervalMining` (2 s, like Hedera);
    `deployWorld` turns it off first, because a block mined between `evm_setNextBlockTimestamp` and `evm_mine` would break
    the e2e time travel.
  - `vitest.config.ts` loaded as CommonJS warned; renamed `.mts`. Playwright loads specs as CommonJS: use `__dirname`.
  - Playwright resolves `getByText("2 pending events")` to the tag and the banner → `exact: true`.
  - Testnet read-only mode could not be run: Hashio answered HTTP 502 to every request on 2026-10-27, and the
    thirdweb public relay for 296 answers with CORS only on the POST, not on the preflight, so a browser cannot use it.
    `NEXT_PUBLIC_TESTNET_RPC_URL` overrides the relay. If Hashio's CORS also fails, a read-only Next.js route that
    forwards JSON-RPC (no secrets) is the fallback; not built.
- **Demo-only change, no design change:** `deployWorld` / `deployOracleWorld` take an optional `challengeWindow` (default
  the LOCAL 48 h) so `scripts/dashboard-demo-local.ts` can use a window you can watch run out (default 300 s, e2e 90 s).
- **Never shown as a real date:** a replayed `usgsUpdatedAt` / `observedAt`. The dashboard subtracts `timeOffsetSec` from
  the oracle-signed HCS message and labels the result "real"; without a signed message it shows the raw integer.
  Local block times after time travel (e.g. 2027) are labelled "Block time" (chain clock).
- Time: ~3 h after reading the brief; no owner Q&A needed.
- **Owner review polish (2026-10-27):** amounts always in USD, the token symbol once as a note; on the local network a
  neutral note that chain time is simulated (time travel) while HCS times are real; the trustee view states the window in
  words and keeps raw effective-time / replayed seconds in tooltips; the header title is the bond's on-chain `name()`.
  Checked read-only on testnet through the mirror node's `contracts/call` (no transaction): a smoke-run ATS bond
  answers `name()` = "Faultline Smoke Bond". 38 vitest, Playwright 8/8.

## Security review (HANDOVER §10 step 8, 2026-10-27, self-review — not an audit)

- Result in docs/SECURITY-REVIEW.md: 0 Critical, 0 High, 4 Medium, 4 Low, 6 Info. Contracts unchanged; SEC-01..SEC-06
  wait for the owner. Fixed without a design change: SEC-08 (oracle D8 identity checked on chain), SEC-10 (local web
  routes off in production builds), SEC-11 (wallet chain re-check before every step), SEC-13 (spikes keystore ignores).
- **Lessons:**
  - The strongest finding was not a code bug but a role graph: OZ `AccessControl` makes DEFAULT_ADMIN the admin of
    every role, so "trustee can veto" silently meant "unless the admin removes the trustee first" (SEC-01). Draw the
    role-admin graph for every AccessControl contract.
  - A local file must never be the only defence of an on-chain invariant: the D8 ledger alone let a lost file turn a
    USGS merge into a second eventId (SEC-08). The chain already knew the answer; one `getEventRecord` per id fixes it.
  - D4 "stop instead of drain" also means "stop forever" without a recovery path (SEC-02): a safety guard needs an exit.
  - Next.js 16 with Cache Components prerenders a GET route handler that returns before touching the request: an
    env-gated route built without the env var was baked in as a static 404. **Fix:** `await connection()` first.
  - Expected-failure PoCs: assert the SECURE behaviour, pass only on an `AssertionError`, rethrow anything else; the test
    turns red by itself the day the fix lands.
  - Tools: Slither 0.11.4 runs on macOS's Python 3.9 in a venv; all 13 hits on the real contracts were false positives
    or by design (HTS precompile calls look like reentrancy). gitleaks flags Next.js build ids in `.next/` (not secrets).
    `npm audit` on the oracle shows the Hedera SDK's transitive protobufjs/grpc advisories; npm's "fix" is a downgrade.
- Time: ~2 h.

## D17 (owner decisions on the security review, 2026-10-27, mock-tested only)

- Contracts: `_setRoleAdmin(TRUSTEE_ROLE, TRUSTEE_ROLE)`; `challengeWindow <= 30 days`, `grace <= 365 days`
  (`InvalidSchedule`); `claim()` pre-checks the pool's own KYC. 203 Hardhat tests; coverage pool 97/98 branches (the
  same `redeem` re-entry branch), trigger 74/74. The testnet smoke-run deployment (`d07f7a5`) is pre-D17.
- **Consequence to remember:** a self-administered trustee role also means the admin can no longer remove a rogue
  trustee; only another trustee can, and a compromised trustee could revoke the backup first. Two trustee keys in
  separate custody; the local world now adds Hardhat #8 as backup trustee.
- SEC-09: `@hashgraph/sdk` 2.81.0 was already the latest (2026-03-13), so npm `overrides` pin `protobufjs@^7` → 7.6.6,
  `protobufjs@^8` → 8.6.6 and `@grpc/grpc-js` → 1.13.7. Oracle `npm audit --omit=dev`: 11 (1 critical, 3 high, 7 low)
  → 8 low (`elliptic` 6.6.1 via `@ethersproject/*` 5.x; no fixed version exists). An offline build + sign + serialise
  of a `TopicMessageSubmitTransaction` works with the overrides; the real HCS path is verified by step 9's first message.
- One `npm run web:e2e` run failed in the demo-world setup right after `npm run check` and did not reproduce in three
  reruns (cause not found; watch for it).

## Full testnet demo — preparation (HANDOVER §10 step 9)

- **RPC relays.** The Hedera docs (JSON-RPC relay page, read 2026-10-27) list two hosted testnet relays that need no API
  key: Hashio `https://testnet.hashio.io/api` and thirdweb `https://296.rpc.thirdweb.com` (Validation Cloud answered
  401 "missing api key"). Both answered on 2026-10-27 and both allow browser CORS (`*`). Their `eth_getLogs` limits
  differ: Hashio refuses ranges over **7 days**, thirdweb over **1000 blocks** (≈ 33 min at 2 s blocks), so the keeper
  scans from the trigger's deploy block. The demo scripts take `FL_RPC_URL` or fall back Hashio → thirdweb and print
  the relay used.
- **Relay receipts wait on the mirror node.** `eth_getTransactionReceipt` is answered from the mirror node, and the relay
  itself polls the mirror node after `eth_sendRawTransaction`; there is no consensus receipt through a relay. The
  oracle's `evm.transport: "hedera-sdk"` (SDK `EthereumTransaction`, consensus-node receipt) was written for that, but
  is **mock-tested only, NOT testnet-verified, off by default**, and the owner kept the proven relay path for the demo.
  Instead the demo window is **120 s** (was 60 s) and Flow A's trustee pause is signed before the oracle runs and sent
  through the relay the moment the oracle reports its submit mined.
- **Synthetic Flow A record.** One replay offset serves both flows, so the SYNTHETIC record must be close to Bhuj in
  time: `synthetic-kutch-testnet-a` is Bhuj + 60 s (M7.5, 5000 bps); the older synthetic fixtures are 20–200 days later
  and would fall outside a ~20 min risk period.
- **Gas price:** the 2026-11-05 smoke run paid about 1,250 gwei-equivalent (fee / gas used); the demo budget scales the
  measured EVM fees by the price of the day.
- **Source verification.** HashScan's own form is disabled; HashScan shows what Sourcify has verified (chainId 296 is
  native in Sourcify). The root is Hardhat 2; the demo calls the Sourcify v2 API with the compiler input from
  `artifacts/build-info` (what `hardhat-verify` sends), no new dependency. The owner approved publishing the source.

## Full testnet demo — results (HANDOVER §10 step 9, 2026-11-05/06)

Evidence: docs/TESTNET-EVIDENCE.md "Full demo". Phases 0–5 ran on 2026-11-05 between 21:38 and 22:06 UTC; settlement
(phase 6 and the dashboard step) on 2026-11-06 after a break of several hours, which the schedule allows: nothing after
`submissionDeadline()` has a time limit. 34 transactions (31 EVM, 3 SDK) and two HCS messages, ≈ 22.9 HBAR. No contract
change, no script change, no failed transaction; the only revert is the deliberate replay rejection.

### Estimate vs actual per phase (script-sent transactions)

| Phase | Txs | Estimate | Gas used | Estimate / used | Fee (HBAR) |
| --- | --- | --- | --- | --- | --- |
| 1 topic + bond + issuer + KYC | 5 | 8,350,456 | 7,827,810 | 1.067 | 10.147 |
| 2 deploy + wiring + backup trustee | 6 | 5,919,528 | 5,430,155 | 1.090 | 6.748 |
| 3 subscribe | 6 | 3,497,663 | 3,266,500 | 1.071 | 4.051 |
| 6 `PART=a` + `PART=sweep` | 6 | 772,437 | 682,959 | 1.131 | 0.847 |

Phases 4 and 5 are mostly the oracle's and the keeper's transactions (relayer), outside the script's log: submit 137,626
gas twice, execute 142,746, pause 30,379, veto 38,225, unpause 53,038, the replay revert 39,252.

### The dashboard write with MetaMask

Investor B's `redeem()` and `claim()` went through the dashboard on the first try. The redeem carried a gas limit of
405,177 and used 259,729: the dashboard sends `gasLimitFor(estimate)` = ceil(estimate × 1.3) explicitly on every wallet
write (`web/src/lib/gas.ts`). Without that buffer a bare `eth_estimateGas` limit can fall short of the peak need of a call
into ATS (the peak is above the reported gas used by the EIP-3529 storage-clear refunds), and the transaction reverts
`INSUFFICIENT_GAS` with no state change but a fee. The Playwright wallet checks that the sent gas equals
`gasLimitFor(estimate)`; checking only that `gas` is present would pass on code that leaves it to ethers.

### Mirror node refuses a topic filter without a timestamp range

`/contracts/<id>/results/logs?topic0=…` answers `Cannot search topics without a valid timestamp range`. `demo-6` passes
`timestamp=gte:` / `lte:` from the pool's deploy and tolerates an empty answer. A script's last read deserves a dry run
too: a query that runs only after the final sweep is reached by no earlier dry run.

### termsHash recomputed at send

The schedule comes from the latest block, and it sets the replay offset, which sets `termsHash`. A dry run's numbers are
therefore only a preview. `demo-2` recomputes the schedule from the latest block right before sending the pool, then saves
that schedule, offset and termsHash (2026-11-05: offset 813436806, termsHash `0x76135117…387957e2`). The trigger takes the
saved `termsHash`, never the preview, and the deploy asserts `trigger.termsHash()` equals it. The web config and its test
were filled from the saved value, and `trigger.termsHash()` read by `eth_call` matched. Do not copy a termsHash or
offset from a dry run into any document or config.

### Hashio and thirdweb

- **Hashio carried everything.** Every EVM transaction, MetaMask's included, shows the Hashio operator `0.0.7314364` as
  the Hedera payer of record of the relay leg, and every script log says Hashio. No relay failure was recorded.
- **thirdweb was never used.** The fallback (scripts by health check, dashboard by `eth_chainId` probe) is unexercised on
  a live failure.
- Fee detail: on a reverted EVM transaction the relay operator pays a small part of the fee and the sender the rest; on a
  successful one the sender pays all of it.

### The 120 s window and its margin

The window started at 1793915887 and the pause landed at 1793915893, leaving **114 of 120 s**. The presigned pause on the
oracle's "mined" line worked: relay receipt, process output, broadcast and consensus together took about 6 s. Keep the
120 s demo window: the margin depends on relay and mirror lag on the day. The veto came 34 s after the pause, which was
safe because the clock was stopped; the admin unpaused after 45 s and `submissionDeadline()` moved by exactly that.

### Other surprises

- **`ops/out/evidence.jsonl` is not the whole run.** It logs only what the script itself sends. The oracle child process,
  the keeper and MetaMask are invisible to it; their transactions were added from the mirror node by account.
- **Top-ups distort "since preflight".** Investor A received 100 HBAR from the owner during the smoke run, which pushed the
  script's balance-delta figure negative. Balance deltas need top-ups subtracted; the fee sum comes from the mirror.
- **Backup trustee stays hollow.** Granting a role needs nothing from the grantee, so it has never signed. Its first
  signature would be its first real test, so a real deployment should rehearse the backup key.
- **Holder burn closes at maturity.** A read-only simulation on FLDMO after the bond's maturity: every holder `redeem`
  reverts `InvalidPartition`, while before maturity it succeeds (docs/SECURITY-TEST-REPORT.md, SEC-15). The pool's
  `controllerRedeem` still works after maturity.
- **zsh does not split variables.** `R="npx hardhat run --network testnetRead"; $R script.ts` fails with "command not
  found" in zsh; the runbooks now spell out every command.

## Test assessment — results (2026-10-31)

- **A guard written against one attack can fail the other way.** D4 was designed against supply going up, and `!=` looked stricter
  and therefore safer. ATS lets any KYC'd holder burn with no role, so that strictness became a free lock on everyone (SEC-15). State
  which direction a check protects, and test the other direction.
- **Mocks hide what they were not told.** `MockBond` copied what the spikes measured, not everything a holder may call. 100 % trigger
  branch coverage saw nothing. The cure was a parity table against the real ATS source, not more tests against the mock.
- **Changing a comment changes bytecode.** A NatSpec edit in `IFaultlinePool.sol` changed the `FaultlineTrigger` creation keccak
  through the metadata hash, although the trigger's logic did not move. That edit was reverted so the trigger stays byte-identical to the
  verified build; the interface comment on `SupplyMismatch` keeps its old wording until the next real interface change.
- **A model that predicts every revert is cheap and finds more than invariants alone.** The stateful fuzz predicts each outcome, down to
  the error name, from a separate bigint model, so a wrong guard order or a checkpoint removed shows up as a disagreement.

## Operator scripts in ops/

- **One repo, two toolchains.** `ops/` has its own `package.json` (Hardhat 3.21.0, hardhat-keystore 3.1.2, hardhat-ethers
  4.2.1, ethers 6.17.0, @hashgraph/sdk 2.81.0, tsx 4.23.15, `"type": "module"`) and its own `node_modules`, so the
  Hardhat 2 root is untouched. The root `tsconfig.json` includes only `scripts`, `test`, `shared/ts` and
  `typechain-types`, so `ops/` is not typechecked as Hardhat 2.
- **Keys live only in the global Hardhat 3 keystore, under FLH_* names**, one network per name in
  `ops/hardhat.config.ts`. Keys must be set from inside `ops/` (`npx hardhat keystore set …`): the root is Hardhat 2 and
  has no keystore. A key is resolved only under `EXECUTE=1` or `CHECK_KEYS=1`, and every SDK step names its payer
  client; there is no default payer.
- **Dry runs before a dependency exists.** The pool constructor reads `bond.decimals()`, so smoke phase 3 defers the pool
  simulation until phase 2 has deployed the bond; demo phase 2 uses the smoke-run bond read-only as its stand-in.
- **A dry run is not always read-only on disk.** Preflight writes the recorded build into the state file when it passes,
  and demo phases 1 and 6 refresh a verification timestamp.

## Issuer page (2026-11-03): what a browser wallet can sign on Hedera

Question before the page was built: can an EOA (MetaMask, through the JSON-RPC relay) call the HTS system contract `0x167`
`grantTokenKyc` and `associateToken`, and can it create an HCS topic? Answered from the Hedera docs and the consensus-node source,
not by a testnet transaction.

- **HCS topic: no.** The EVM system contracts are HTS `0x167`, exchange rate `0x168`, PRNG `0x169`, HAS `0x16a` and HSS `0x16b`
  ([Hedera docs, system contracts](https://docs.hedera.com/evm/hedera-services/system-contracts)); the node's
  `exec/systemcontracts` package at commit `bd84adf` of
  [hiero-consensus-node](https://github.com/hiero-ledger/hiero-consensus-node) has no consensus-service contract either. A
  MetaMask account can only sign Ethereum transactions, so `TopicCreate` needs the SDK (or a native Hedera wallet). The page prints
  an `ops/` command instead (`ops/scripts/issuer/hcs-topic.ts`), which also needs the trustee's key as admin-key signer (D16).
- **Associate: yes, for itself.** HIP-719 `associate()` on the token address from an EOA is testnet-verified (spike S3). The pool
  associates itself in `initialize`, so the wizard needs no extra step; an investor calls `associate()` from its own wallet.
- **grantTokenKyc from an EOA: only in one narrow case, and not testnet-verified.** Since the v2 security model a system-contract
  call no longer honours top-level signatures: "System contracts can change an account's state via call with the appropriate
  signature: Y → N" ([Hedera docs, smart contract security](https://docs.hedera.com/evm/development/security)). In the node source,
  HTS calls use `DefaultVerificationStrategies.activatingOnlyContractKeysFor`, which builds an `ActiveContractVerificationStrategy`
  with `UseTopLevelSigs.NO`: only contract-id keys that name the caller count, every ECDSA or ED25519 key is `INVALID`. But the
  call is dispatched with the caller as the synthetic payer (`DispatchForResponseCodeHtsCall` → `dispatch(…, senderId, …)`), and
  `PreHandleContextImpl.requireKey` drops any required key that **equals the payer's key** (`ChildDispatchFactory.preHandleChild`
  keeps only `requiredNonPayerKeys`). So an EOA calling `0x167 grantTokenKyc` directly should pass exactly when the token's KYC key
  is its own account key, and fail otherwise. That is also why an EOA can associate itself. fUSD's KYC key equals the deployer's
  account key (mirror node, 2026-11-03), so the deployer is that case, but nobody has sent it; the page does not offer it and prints
  the SDK path (`ops/scripts/issuer/hts-kyc.ts`, the `TokenGrantKyc` demo phase 2 ran) instead.
- **Everything else the launch needs is a plain EVM call:** ATS factory `deployBond`, `addIssuer`, ATS `grantKyc`, `applyRoles`,
  the two contract creations and `pool.initialize`. Scripts sent each of them on testnet; **from a browser wallet none is
  testnet-verified** (RT-29). HANDOVER §4 records that Hashio once rejected a large-gas role grant sent from MetaMask.

Build notes:

- The page deploys the creation code bundled from `artifacts/` at web build time (dynamic import, issuer page only) and shows its
  keccak; after each deployment it reads the transaction back and compares the creation-code prefix of its input. On the local run
  both matched the TEST-STATE values (`0x7871…3f6d` pool, `0x3205…fcf3` trigger).
- `scripts/lib/bondAudit.ts` imports `test/helpers/roles.ts`, which reads files with `fs`, so the browser cannot import it. The
  page keeps a copy of the role list and a vitest pins it to the script's list, id by id.
- The web `POOL_ABI` had no `initialize`, so the first Playwright run stopped at "no matching function"; the fragment was added and
  `test/abi.test.ts` checks it against the artifact like every other fragment.
- Playwright `fill` on the `datetime-local` field rejected `2001-01-01T00:00:00` with "Malformed value" and accepted
  `2001-01-01T00:00`; the test types the short form (cause not investigated).
- Local MockBond has no `addIssuer` or `applyRoles` and fixed names; the local plan uses `grantRole(ROLE_KYC)` and two
  `grantRole` calls instead. That difference is in the step texts.
