# Full lifecycle from the browser (Hedera testnet)

The full-demo lifecycle, with every wallet step in the dashboard and MetaMask: launch a new bond on `/issuer`, fund it,
invest, a SYNTHETIC event paused and vetoed, the real Bhuj record executed, then redeem, claim and sweep. Status: **NOT
testnet-verified** until the owner runs it (RT-29 in [`REMAINING-TESTS.md`](REMAINING-TESTS.md)).

Three steps cannot be signed by a browser wallet on Hedera ([`LESSONS.md`](LESSONS.md) "Issuer page"). They run from
`ops/` with the keystore, dry run first and then `EXECUTE=1` by the owner:

- the HCS topic;
- the HTS KYC for fUSD;
- the oracle's attestation (an EIP-712 signature by the oracle key, an HCS message and `submit` by the relayer).

## Before you start

- **MetaMask network:**
  - name Hedera Testnet;
  - RPC `https://testnet.hashio.io/api`;
  - chain id 296;
  - symbol HBAR;
  - explorer `https://hashscan.io/testnet`.
- **MetaMask accounts:** import the deployer, trustee, sponsor, investor A and investor B yourself
  ([`ACCOUNTS.md`](ACCOUNTS.md)). Never paste a key into chat or a file.
- **Balances on 2026-11-06 (mirror node):**
  - deployer 91 HBAR;
  - sponsor 1,060 fUSD;
  - investor A 370 fUSD;
  - investor B 580 fUSD.

  The launch costs about 15 HBAR on the deployer.
- **Dashboard:** the Vercel URL, or locally:

  ```bash
  npm run compile && npm run web:build && npm --prefix web start
  ```

  Pick "Hedera testnet (296)" in the sidebar.

## Timeline

Times are from the moment you fill in the form; this is a demo-only schedule.

| When | What |
| --- | --- |
| T+25 min | issuance opens |
| T+45 min | issuance closes, risk period starts |
| T+46 min | Bhuj is replayed here (riskStart + 60 s) |
| T+47 min | the SYNTHETIC event is replayed here |
| T+75 min | maturity |
| T+78 min | redemption opens (after 3 min grace) |

Use a 25-minute lead instead of the page's default 10: the launch has about 12 wallet steps and 2 ops steps, and the ATS
bond must exist before issuance opens.

## Steps

1. **Launch: `/issuer`, deployer wallet.**
   1. Parties: keep the defaults. Under "Investors to KYC", add investor A and investor B.
   2. Schedule: issuance start = now + 25 min, issuance end = start + 20 min, risk start = issuance end, maturity = risk
      start + 30 min, grace 180 s, window 120 s.
   3. Terms: mode "replay", then press **"Place Bhuj (usp000a8ds) 60 s after riskStart"**. Press it after the schedule is
      final, because the offset depends on riskStart.
   4. Press "Start the launch", then each step's button in order.
      - **Topic step:** run the printed command from the repo root, first as a dry run, then with `EXECUTE=1`. Paste the
        topic id and press "Check".
      - **Backup trustee:** sign it with the trustee wallet, or press "Skip".
      - **KYC step:** run the printed command the same way (it covers the pool and both investors), then press "Check".
   5. When the audit shows every row PASS, copy the "Deployment config entry" and save it for the oracle:

      ```bash
      mkdir -p ops/out/issuer && pbpaste > ops/out/issuer/deployment.json
      ```

   6. Press "Open this bond in the dashboard".
2. **Coupon reserve: `/sponsor`, sponsor wallet, before issuance closes.** Press "Fund coupons" with the amount shown
   under "Needed for the full cap".
3. **Invest: `/investor`, during issuance.** Investor A presses "Approve and invest" with 300; investor B does the same
   with 200.
4. **Flow A, the SYNTHETIC event (pause and veto), after T+47 min:**

   ```bash
   EVENT=synthetic npm run ops:issuer:oracle              # dry run: checks, rule → 5000 bps, timing
   EXECUTE=1 EVENT=synthetic npm run ops:issuer:oracle    # owner: oracle signs, HCS message, submit
   ```

   Then, inside the 120 s window, go to `/trustee`:
   - with the trustee wallet, press **Pause**, then **Veto event**;
   - with the deployer (admin), press **Unpause**.
5. **Flow B, the real Bhuj record:**

   ```bash
   npm run ops:issuer:oracle                              # dry run: live USGS record → 7000 bps
   EXECUTE=1 npm run ops:issuer:oracle                    # owner
   ```

   After the 120 s window, press **Execute** on `/trustee` (any wallet). Expected result:
   - loss index 7000;
   - the sponsor is credited 350 fUSD;
   - investor A's principal is now 90 and investor B's 60.
6. **Settle, after T+78 min:**
   - investors A and B: "Redeem all units", then "Claim" on `/investor`;
   - the sponsor: "Claim" on `/sponsor`;
   - any wallet: "Sweep excess", then "Sweep dust" once every unit is redeemed.

## Evidence

Keep every tx hash (MetaMask activity or HashScan), the topic id and the terminal output of each ops command. The run
goes into [`TESTNET-EVIDENCE.md`](TESTNET-EVIDENCE.md), and RT-29 closes.

The oracle helper writes `ops/out/issuer/oracle-<trigger>/` (its config, the terms and the oracle ledger) and
`ops/out/issuer/oracle-<event>-<trigger>.json` (submit tx, HCS sequence and consensus time). All of it is public data.
