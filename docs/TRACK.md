# ETHGlobal Mumbai — Hedera track text

Saved from the owner's answer in HANDOVER.md section 14, question 1 (2026-10-25). Background only;
the owner set hackathon rules aside on purpose (HANDOVER section 11).

## Tokenize Anything with Hedera Studios — $5,000

| Place | Prize |
| --- | --- |
| 1st | $2,500 |
| 2nd | $1,500 |
| 3rd | $1,000 |

Use Hedera's open-source studios to put a real-world asset or payment flow on-chain. Asset
Tokenization Studio (ATS) covers the full lifecycle of security tokens, bonds, and equities, and
supports ERC-3643 and ERC-1400. Stablecoin Studio covers minting and managing fiat-backed
stablecoins, with admin and reserve controls built in.

Pick something that exists today in finance, trade, or commerce, and show how it works when it's
issued, managed, and settled on Hedera.

### Ideas

- Fractional ownership of invoices or receivables for small businesses, sold to investors.
- Tokenized bonds with on-chain coupon schedules.
- Fractional ownership of gold, real estate, or warehouse receipts.
- A stablecoin for cross-border remittances, with compliance controls.
- A secondary market or order book for ATS assets.
- An x402 service that sells data about tokenized assets, such as NAV or price feeds (this also
  links to Track 1).

### Qualification requirements

- Use ATS or Stablecoin Studio (SDK, contracts, web app, or a combination) to issue or manage a
  tokenized asset or stablecoin.
- Deploy and demo on Hedera testnet.
- A public GitHub repo, with contracts verified on HashScan where applicable.
- A demo video of 5 minutes or less that covers issuance, configuration, and at least one lifecycle
  operation (for example a coupon payment, redemption, freeze, or reserve update).

### Extra points

- Compliance controls: KYC, freezes, transfer restrictions, pauses.
- Custom fees and distributions.
- Oracle pricing or NAV feeds.
- Scheduled Transactions for coupons, vesting, or recurring payouts.
- Contributions back to ATS or Stablecoin Studio.

## What this means for Faultline

- "Deploy and demo on Hedera testnet" is a qualification requirement, not a stretch. Phase 1 keeps
  testnet as a stretch (HANDOVER section 10), but Phase 2 must end on testnet.
- "Contracts verified on HashScan" → plan Sourcify/HashScan verification in the testnet prompt.
- The demo video must show issuance, configuration and one lifecycle operation: redemption with a
  write-down covers this.
