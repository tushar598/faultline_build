# Origin conversation — digest

Source: the owner's claude.ai chat that produced HANDOVER.md, shared at
<https://claude.ai/share/f30b9900-5124-499a-aa14-0178173f1847> (read in full on 2026-10-25).
This file keeps only what HANDOVER.md does not already say, or says less precisely. HANDOVER.md and
docs/ARCHITECTURE.md stay the source of truth for the design.

## 1. How the idea was chosen

- Track brief: ETHGlobal Mumbai "Tokenize Anything with Hedera Studios" (full text in docs/TRACK.md).
  Owner's constraints: creativity, usefulness, practicality, winner mindset, impressive to judges.
- The idea was screened against the owner's **past hackathon projects** (rule: never recycle).
- Original name **"Kavach Re"** ("kavach" = shield; cat bond issuers end names in "Re"); renamed
  **Faultline** for a more professional name. The cloud workspace folder `~/kavach-re` is old.
- Shortlist scores (the earlier assistant's judgement, 1–5 each): Kavach Re 22, outcome-linked impact
  bond 20, tokenized repo with margin calls 18, purpose-bound subsidy stablecoin 18, PvP FX settlement
  17, invoice fractionalization 14. Impact bond kept as a "what's next" slide (same trigger engine).
- Deliberately avoided: Hooks (HIP-1195, not confirmed on testnet), Mass Payout (needs Postgres and a
  newer Node), building a venue/secondary market (crowded: Clearing House, Captable, Galvanic, Remate,
  Asseto at ETHOnline).
- Past Hedera winners in the same lane: Hedera Green Bonds on ATS, ChargeFrog, Lamina.
- A 2017 blockchain-settled cat bond exists (Insurance Journal) and Harneys/droppRWA plan tokenized cat
  bonds in 2027 → never claim "first".
- ATS jurisdiction rules target US Reg D / Reg S; GIFT City (India) is roadmap only.
- Verdict history: "yes, continue, with changes"; podium ≈ coin flip if the core demo is clean.
- Team: the owner plus Claude models (Opus, Sonnet). ETHGlobal rules and the 36-hour plan were set
  aside by the owner: goal is the best MVP, built and tested locally first (Phase 1), rebuilt clean
  later (Phase 2).

## 2. What the owner did on testnet (step by step, 24 Oct 2026)

| Step | Detail |
| --- | --- |
| ATS web app | `npm run ats:setup` → web build OOM (exit 134, ~14k modules); ran the **dev server** instead (`localhost:5174`) |
| Deployment used | the ATS v4.0.0 BLR and factory proxies of that time (not the v8 ones this project uses, docs/reference/ats.md) |
| Bond form (TCB) | "Fill with example data" (gives a valid ISIN); name Test Cat Bond, symbol TCB; **Controllable ON, Internal KYC ON, Blocklist ON, Approval list OFF, Clearing OFF**; currency USD (fixed); units 10,000; nominal 1,000; start 25/10/2026; maturity 25/12/2026; no proceed recipients; no ERC-3643 compliance/identity registry; no external lists; Jurisdiction US, **Regulation S**, blocklist Cuba/North Korea/Iran/Syria |
| Roles | after deploy the issuer had **only Admin**; it then granted itself Minter, Controller, KYC, SSI Manager, KYC Manager, Internal KYC Manager |
| KYC | SSI Manager → Add Issuer (issuer account) → `createVC --holder <investor EVM> --privatekey <ISSUER key>` → Control → KYC → Add (account id + VC file). First try failed ("issuer … is not registered") because the VC was signed with the **investor** key; regenerating with the issuer key fixed it. KYC valid to 2126 |
| Mint | 10 TCB to the investor |
| UI Force Redeem | "Insufficient allowance" from the SDK pre-check `checkCanRedeem`; no MetaMask popup |
| Direct `controllerRedeem` | 5 TCB burned |
| HIP-1215 | `hss-schedule-sc-calls` tutorial (Hardhat 3 + keystore; import paths fixed to `@hiero-ledger/hiero-contracts`); AlarmClockSimple scheduled a call; `AlarmTriggered` block 42200075 (~10 s later) |
| Role grant via UI | failed: Hashio "RPC endpoint returned HTTP client error" (UI sends gas ≈ 15M); granted by ethers script instead |
| Contract burn | a `Redeemer` probe with ROLE_CONTROLLER burned 1 TCB; supply 4 TCB; **its ROLE_CONTROLLER was revoked on 2026-10-25 (S0, tx `0x1753ba62…b0002c90`)** |
| Not done | Stablecoin Studio check (`accelerator wizard`), HCS, scheduled call into ATS |

## 3. Account facts

The accounts of that first exploration were throwaway testnet accounts; this project does not use them. Its own
accounts are the FLH_* set in docs/ACCOUNTS.md. The lesson that carried over: an account created by an HBAR transfer to
an EVM address is **hollow** (no key on the mirror node) until it signs a transaction as payer with its ECDSA key; an
EVM tx via MetaMask or ethers completes it, and so does an SDK transaction it pays (this project's smoke run,
2026-11-05). Unlimited auto-association (`-1`) lets HTS tokens arrive without an explicit associate, but the HIP-719
`associate()` is still what the scripts call.

## 4. Advice from the origin chat not yet in the design

- On D2 the earlier assistant suggested: **block submit while paused, but extend the submission
  deadline (`maturity + grace`) by the total paused time**, so a pause cannot make a legit quake miss
  the cutoff. **Applied 2026-10-25** (owner approved): `submissionDeadline()`; see ARCHITECTURE §12 D2.
- Demo idea: a non-KYC transfer blocked and a freeze shown at the end; closing line: Jamaica renewed
  with a USD 200M World Bank cover in May 2026.
- Upstream contribution idea: an enhancement proposal + example for event-linked bonds in the ATS
  repo (`docs/references/proposals`), plus the Force Redeem SDK bug report.
