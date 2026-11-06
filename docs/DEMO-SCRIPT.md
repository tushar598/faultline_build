# Demo video script (5 minutes or less)

Follows HANDOVER §11 and covers the track's video rule: issuance, configuration and at least one lifecycle operation.
Target 4:40, which leaves room for a slip. Every number below is from the testnet run of 2026-10-27/28
(docs/TESTNET-EVIDENCE.md "Full demo"), except where a shot is marked LOCAL.

## Rules for the recording

- **Time claim, say it this way:** from the earthquake to finality takes **hours** (USGS review, 6 h cooling period,
  challenge window). From finality to settlement takes **seconds**. Never say "seconds after the earthquake".
- **The 120 s window is demo-only;** production is 48 to 72 hours. The replay shows the mechanism, not real-world timing:
  a real run takes those hours.
- **The demo does not exercise the cooling period.** The Bhuj event is decades old (D14).
- **Label the two events.** Bhuj `usp000a8ds` is the real USGS record. Flow A's event is **SYNTHETIC**, not a real USGS
  event. Say so out loud.
- **Label LOCAL shots** on screen: "Local Hardhat node, mock ATS and HTS". Nothing from a local node counts as testnet
  evidence. On-chain proof always comes from HashScan.
- **Do not claim:** "first on Hedera", audited, regulated, retail access, or a claims-adjustment saving. Parametric bonds
  already skip claims adjustment. Do not mention two executed events or the 100 % cap as testnet-proven: they are mock-tested.
- Re-check any market figure before saying it (HANDOVER §3 and §14): this script uses none, and "India has no cat bond of
  its own" needs a final check before recording.

## Setup

1. Dashboard in testnet mode: `npm run web:dev`, network "Hedera testnet (296)". This shows the finished demo.
2. For the live countdown (LOCAL): `npm run node`, `npm run dashboard:demo:local`, `npm run web:dev` in a second browser
   profile. COMMANDS §9.
3. HashScan tabs: the pool, the trigger, topic `0.0.11195949`, the pause, veto, replay and execute transactions, and B's redeem.
4. Terminal with `npm run check` already scrolled to the test totals.

Screen links are in docs/TESTNET-EVIDENCE.md.

## Script

| Time | Screen | Say |
| --- | --- | --- |
| 0:00–0:25 | Title, then the Overview view | "A catastrophe bond: investors earn a coupon for taking earthquake risk. If a measured quake crosses a threshold, they lose principal and the sponsor receives the collateral. Faultline runs that lifecycle on Hedera. From the earthquake to finality takes hours. From finality to settlement takes seconds." |
| 0:25–0:50 | Evidence view: entities; HashScan bond page | "Issuance. A real ATS v8 bond, FLDMO, with a real HTS stablecoin. The pool is the only minter. Investors with KYC paid in 300 and 200 dollars of test stablecoin and got bond units one to one. The sponsor funded the coupon reserve first, so nobody subscribes to an unfunded coupon." |
| 0:50–1:20 | `docs/ARCHITECTURE.md` §12.1 or the terms file; trigger page on HashScan | "Configuration. The rule is fixed in a terms hash inside the trigger: a box around Kutch, depth up to 70 km, reviewed moment-magnitude quakes only, and a linear curve from 0 % loss at M7.0 to 100 % at M8.0. The oracle cannot change it without a new bond. The calculation agent is trusted, and I will show you what limits that trust." |
| 1:20–2:10 | LOCAL: Trustee view with countdown, label on screen. Then HashScan: pause, veto, replay revert | "Flow A: the trustee's veto. This event is SYNTHETIC, not a real USGS event. The oracle attests it and publishes to HCS. A challenge window starts. On testnet the trustee paused with 114 of 120 seconds left, the clock froze, and the veto went through while paused. Here is that veto on HashScan. Now the attack: the same signature, sent again. It reverts with EventFinalised. A vetoed event can never come back." |
| 2:10–2:55 | Quake replay view; HCS message on HashScan; execute tx | "Flow B: the real 2001 Bhuj earthquake, fetched live from USGS and replayed into the demo's risk period. M7.7 gives 7,000 basis points. The oracle signs it and publishes to HCS, and the signature inside the message recovers to the oracle. The 120-second window here is demo-only; production is 48 to 72 hours. A real event would also wait for USGS review and a 6-hour cooling period. After the window the keeper executes." |
| 2:55–3:20 | Investor view: ATS balance next to effective value; Sponsor view | "The write-down. One transaction raises a global loss index, with no loop over holders. 350 of 500 dollars of collateral goes to the sponsor. Holders' ATS balances do not change, so the dashboard shows the effective value: 30 % of principal." |
| 3:20–3:55 | Investor view; B's redeem and claim on HashScan | "Redemption. After the deadline each holder redeems, and the pool burns units through the ATS controller role. Investor B did this through this dashboard with MetaMask. An honest note: B's first attempt ran out of gas. We found it on the mirror node, fixed the gas limit, and the retry passed. That failed transaction is in the evidence too." |
| 3:55–4:20 | Evidence view; HashScan verified source; test totals | "The books close to the base unit: 501 paid out equals 500 deposited plus 1 of reserve, and the pool ends at zero. Both contracts are verified with an exact match. Every transaction is in the evidence file, including the two that reverted. The README says what is testnet-verified and what is only mock-tested." |
| 4:20–4:40 | README trust and legal section | "This is a prototype: self-reviewed, not audited, not a regulated product. A real deal needs a licensed insurer and a Rule 144A, Regulation D or Regulation S offering. What it shows is a transparent, automatic, auditable lifecycle." |

### Optional 20-second issuer shot (LOCAL)

Use only if the cut stays under 5:00; it fits after the configuration shot (0:50–1:20), and every other line moves by 20 s.
Label it on screen: "Local Hardhat node, mock ATS and HTS". Record from `/issuer` with a launch already finished
(COMMANDS §9, "Issuer page"), so no waiting is shown.

| Time | Screen | Say |
| --- | --- | --- |
| +0:00–0:20 | LOCAL: `/issuer`, terms with termsHash and the curve, then the launch list with every step done and the audit passing, then the Bond selector | "A sponsor can launch a new bond from the dashboard with its own wallet: the terms become the hash, the page checks the schedule against the contract rules, deploys the same build, and audits the bond's roles. This is a local run with mock tokens. On testnet two steps, the HCS topic and the stablecoin KYC, need Hedera keys and run as scripts; that path has not been run on testnet yet." |

Do not show it as testnet evidence, and do not show the testnet issuer flow until RT-29 has run.

## Checks before publishing

- Total length under 5:00.
- Every LOCAL shot is labelled.
- "SYNTHETIC" is spoken and visible in Flow A.
- No key, keystore, seed phrase or `.env` file is on screen; wallet popups show test accounts only.
- The word "seconds" appears only for finality to settlement, for the demo's window, or for the pause figures.
