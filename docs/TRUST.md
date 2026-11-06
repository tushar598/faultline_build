# Roles, trust assumptions and legal note

## Entities and roles

### People and keys

| Entity | Who it is in real life | What it does in Faultline | What it cannot do |
| --- | --- | --- | --- |
| **Sponsor** | The insured party: a state government, an insurer or a reinsurer | Funds the coupon reserve for the whole term before the sale opens; receives the written-down collateral after an executed event; at the end, claims the unused reserve and rounding dust | Cannot trigger an event or change the terms |
| **Investors** | Funds that buy disaster risk for a yield | Pass KYC, pay the stablecoin into the pool, receive bond units 1:1, earn the coupon, then redeem at maturity | Cannot redeem before maturity plus grace, or while an event is pending |
| **Issuer / bond admin (deployer)** | The arranger that sets up the deal | Creates the ATS bond and the stablecoin wiring, deploys the pool and the trigger, grants KYC, and gives the bond's mint and controller roles to the pool only | A foreign mint is caught by the pool's supply guard (D4, D18): redemption stops (a lock, not a drain). In production this role belongs in a multisig |
| **Calculation agent (oracle)** | The independent firm that applies the trigger rule | Watches USGS, applies the payout curve off-chain, signs an EIP-712 attestation and the HCS message; holds the HCS topic's submit key | Pays no fees and holds no funds. A false attestation can be vetoed inside the window |
| **Relayer** | The oracle's operations account | Pays the HCS and EVM fees for the oracle: publishes the HCS message, sends `submit` and `execute` | Cannot sign an attestation or an HCS message (spike S7) |
| **Trustee** | The deal's independent trustee | Holds `TRUSTEE_ROLE`: can veto an event inside the challenge window and pause the trigger in an emergency. Holds the HCS topic's admin key | A veto is final for that event. Cannot unpause |
| **Backup trustee** | A second trustee key in separate custody (D17) | Holds `TRUSTEE_ROLE` too, so losing one trustee key does not remove the veto. Only a trustee can add or remove trustees | Same limits as the trustee |
| **Trigger admin** | The deal administrator | Unpauses the trigger and rotates the oracle key | Since D17 it can no longer add or remove trustees, so it cannot take the veto away |
| **Keeper** | Anyone: a bot, the relayer or a holder | Calls `execute` once the challenge window has ended | Changes nothing that the rule has not already decided |

### Contracts and Hedera services

| Component | Type | Role |
| --- | --- | --- |
| **ATS v8 bond** | Hedera Asset Tokenization Studio security | The bond units, with KYC, roles and controller redemption. The pool is the only minter |
| **HTS stablecoin** (test token fUSD) | Hedera Token Service, 6 decimals, with a KYC key | The collateral, the coupon reserve and every payout |
| **`FaultlinePool`** | Custom Solidity contract (Hedera EVM) | Holds the collateral and the coupon reserve; mints units on `invest`; keeps the loss index L; on `applyLoss`, credits the sponsor; on `redeem`, burns units through ATS and pays principal × (1 − L) plus the coupon |
| **`FaultlineTrigger`** | Custom Solidity contract (Hedera EVM) | Checks the oracle's EIP-712 attestation against `termsHash`; runs the challenge window, veto, pause, revisions and replay protection; on `execute`, calls the pool |
| **HCS topic** | Hedera Consensus Service | A public, ordered log of every attestation and advisory. The oracle holds the submit key, the trustee the admin key, and the relayer pays (D16). The chain, not HCS, is the source of truth |
| **Mirror node** | Hedera read API | Read by the oracle, the dashboard and the audit checks |
| **USGS ComCat** | External data source | The earthquake record (magnitude, type, depth, location, review status) |

## Trust assumptions and legal note

**This is a prototype that shows lifecycle automation. It is self-reviewed, not audited, and not a regulated insurance
or securities product. Do not use it with real money.**

### Trust assumptions

1. **Oracle key.** One calculation agent signs every attestation. A stolen key can attest a false event; the challenge
   window, trustee veto, pause and oracle rotation bound the damage. Its rule is hashed into `termsHash`, so it cannot be
   changed without a new bond.
2. **Trustee.** Can veto only inside the window, and a veto is permanent for that event, even if the quake was real.
3. **Pause.** Only a trustee pauses and only the admin unpauses. A pause also delays redemption by its length, and it has
   no maximum: if the admin key is lost during a pause begun before the deadline, redemption and both sweeps stay locked
   for ever (SEC-19, accepted). Production needs the admin in a multisig.
4. **Finality.** Finality is the first `execute` after the window; a revision landing first restarts the window (SEC-06).
   There is no clawback after a later USGS revision.
5. **Single mint authority.** Only the pool may mint. The bond admin could still re-grant minting (see below); the supply
   guard turns that into a lock, not a drain (SEC-02), except a foreign mint up to the amount holders burned, which it
   no longer sees (D18). Any KYC'd holder can burn its own units through ATS with no role: that locks nobody, and the
   burned value goes to the sponsor through `sweepDust`.
6. **Stablecoin admin keys.** Revoking or freezing the pool's KYC stops every payout until restored.
7. **ATS balance is not economic value.** After a write-down the ATS balance does not change; the dashboard shows the
   effective value. Other tools will show the old balance.
8. **Holders can sell during the window.** The buyer inherits the loss. The accounting stays correct; market fairness does not.
9. **Economic limits.** Collateral earns no yield and the sponsor pre-funds the full-term coupon.

### Legal and regulatory note

- **Insurance.** Taking insurance risk needs a licence. A real deal needs a licensed special purpose insurer; Faultline
  has no such entity, no SPV and no licence.
- **Securities.** Real cat bonds are Rule 144A, Regulation D or Regulation S offerings, sold to qualified buyers. Faultline
  is not an offering of anything, and its testnet tokens have no value.
- **Personal data.** No personal data goes on-chain or on HCS: only hashes and credential ids. Wallet addresses are public by
  the nature of the chain.

This note describes the project's limits. It is not legal advice.

### Details

**Bond roles after setup (testnet smoke run and full demo).** After bond setup nobody holds `ROLE_PAUSER`, `ROLE_ISSUER` (except
the pool) or `ROLE_AGENT` on the ATS bond, but the deployer keeps `DEFAULT_ADMIN_ROLE` and could grant any of them
later. A foreign mint is stopped on-chain by the pool's supply guard (D4, D18: invest, redeem and sweepExcess revert on
`bond.totalSupply() > unitsIssued - unitsRedeemed`). A bond pause is **not** prevented on-chain: it would block
`mint` and `controllerRedeem` (spike S2), and it relies on the admin never granting `ROLE_PAUSER`.

**Keys and roles (security review, docs/SECURITY-REVIEW.md §5; D17).**
- **Trigger admin** can unpause and rotate the oracle, but since D17 it can no longer add or remove trustees, so it
  cannot take the veto away (SEC-01, fixed).
- **Trustee:** a veto is final even if the quake was real, so a trustee key is as sensitive as the oracle key. Only
  trustees manage trustees: keep a backup trustee in separate custody. Losing every trustee key removes veto and pause
  for good; a rogue trustee can be removed only by another trustee. As the HCS topic's admin key it can also delete the
  topic or change its submit key (the chain, not HCS, is the source of truth).
- **Relayer:** pays fees and relays signatures only; it cannot sign attestations or HCS messages (spike S7).
- **Bond admin (`DEFAULT_ADMIN_ROLE` on the ATS bond):** a foreign mint or upward balance adjustment makes the pool's supply
  guard (D4) stop redemption for everyone: a **lock, not a drain**, accepted by design (SEC-02). It could also pause the
  bond or grant itself CONTROLLER and force-transfer holders' units, which the guard cannot see. In production this role
  belongs in a multisig or timelock.
- **Holder burns (SEC-15, D18):** a KYC'd holder, an approved spender or an authorised operator can burn units through ATS
  with no role. The guard now reverts only when supply is above the books, so this locks nobody. Two accepted costs: a
  foreign mint up to the burned amount goes undetected (it needs a bond role the deploy audit forbids, and after
  `sweepDust` such a mint is unbacked, so the last claimant is short), and burned collateral stays reserved until `sweepDust`,
  so it stays in the pool if any holder never redeems.
- **Trigger admin key (SEC-19):** a pause has no maximum and only this key ends it. A lost key during a pause begun before
  the deadline locks redemption and both sweeps for ever; so does a lost key with a pending event past its window, even for
  a pause begun after the deadline. Accepted, no contract change. Production needs this key in a multisig.
- **Holds (SEC-21):** D9 keeps hold roles off the bond, but a holder can create a hold with no role and no KYC. Held units
  leave `balanceOf`, so `redeem` pays only the free balance; the harm stays with that holder.
- **Stablecoin admin / KYC key:** revoking or freezing the pool's KYC stops every payout until it is restored; `claim`
  then reports `NotKycForToken(pool)` (D17).
- **Finality is the first execute after the window:** a revision that lands first restarts the window (SEC-06).
- **Pauses (D2):** a pause that starts before the submission deadline keeps redemption closed; one that starts after it
  does not.

**Late USGS revisions (D15).** While an event is pending the oracle re-checks its USGS record on a fast loop and, if the
record stops passing the rule, publishes a signed advisory asking the trustee to veto (it can never revise a loss to
0 itself). A USGS revision that arrives **after** the challenge window has ended is a residual risk: an executed
write-down is final and is not clawed back.

**On-chain values can lag USGS (§6.6).** A pending event is revised only when its loss changes. If USGS later refines
the magnitude or origin time without changing the loss (for example M8.1 → M8.2, both above the 100 % ceiling), the
trigger keeps the older `magnitudeX100` / `observedAt`; the oracle's ledger keeps the latest values.

**HCS is a log, not the authority (D16).** Every HCS message carries the oracle's own signature, but the on-chain
trigger is the source of truth. The topic's admin key is the trustee's: it can change the submit key or delete the topic.

**Demo (replay mode).** The demo replays a real historical quake (Bhuj 2001, `usp000a8ds`) with `mode: "replay"` terms
(ARCHITECTURE D10): its times are shifted into the demo bond's risk period and the dashboard shows a REPLAY badge. In
replay mode the oracle's 6 h cooling period is measured on the **real** USGS origin time (D14); the event is decades
old, so **the demo does not exercise the cooling period**. Replay terms are refused off-chain on any chain other than
Hardhat (31337) and Hedera testnet (296); on chain the mode is visible only through `termsHash`.
