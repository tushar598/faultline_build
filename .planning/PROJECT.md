# Faultline — Project Definition

> Parametric earthquake catastrophe bond on Hedera

## Vision

Build and ship a fully functional parametric earthquake catastrophe bond on Hedera for the ETHGlobal Mumbai hackathon (Nov 5–7, 2026). If a USGS-reviewed earthquake crosses a preset threshold inside an insured zone, bond principal is written down through a global loss index and the matching collateral is credited to the sponsor — automatically, without loss adjustment.

## Problem

Traditional catastrophe bonds take weeks to months for loss adjustment. Parametric bonds already skip claims adjustment, but structuring and lifecycle management remain expensive, opaque, and inaccessible. India has no cat bond of its own.

## Solution

Faultline tokenizes the full cat bond lifecycle on Hedera using both Asset Tokenization Studio (ATS) and a stablecoin (HTS), with:
- Automated write-down via USGS earthquake data and EIP-712 signed attestations
- Challenge window with trustee veto for safety
- Transparent audit trail via Hedera Consensus Service (HCS)
- Real-time investor dashboard

## Target

**ETHGlobal Mumbai** — Hedera track "Tokenize Anything with Hedera Studios" ($5k prize pool)

### Qualification Requirements
- Use ATS or Stablecoin Studio to issue or manage a tokenized asset
- Deploy and demo on Hedera testnet
- GitHub repo (the hackathon rule says public; the owner keeps it PRIVATE and creates/pushes it personally), contracts verified on HashScan (Sourcify)
- Demo video ≤ 5 min covering issuance, configuration, and at least one lifecycle operation

### Extra Points
- Compliance controls (KYC, freezes, transfer restrictions, pauses)
- Oracle pricing or NAV feeds
- Scheduled Transactions for coupons
- Contributions back to ATS or Stablecoin Studio

## Actors

| Actor | Role |
| --- | --- |
| Sponsor | Pays coupon premium, receives collateral on trigger fire |
| Investors | Buy bond units with stablecoin, earn coupons, lose principal pro rata on trigger |
| Oracle (Calculation Agent) | Reads USGS data, applies trigger rule, signs EIP-712 attestation |
| Trustee | Can veto during challenge window, can pause in emergency |
| Admin | Can unpause, rotate oracle key |

## Repository

- **Root:** Hardhat 2 + Solidity 0.8.28 contracts
- **oracle/:** TypeScript ESM calculation agent (Hashgraph SDK, ethers, Zod, Vitest)
- **web/:** Next.js 16 dashboard (React 19, Tailwind 4, ethers)
- **docs/:** Design documents, reference notes, spike plan

## Source of Truth

- Design: `HANDOVER.md` (§15 overrides older sections) + `docs/ARCHITECTURE.md`
- Commands: `docs/COMMANDS.md`
- Assumptions & lessons: `docs/LESSONS.md`
- Spike plan: `docs/SPIKES.md`
- Reference: `docs/reference/*.md`

## Standing Rules

1. Production-grade code — clean, optimised, professional
2. Never recycle a product the owner has already built
3. Research deeply before suggesting anything sensitive/complex
4. Private keys never in chat/files — terminal only, testnet only
5. Every testnet transaction needs owner confirmation
6. Be honest about mock-tested vs testnet-verified
7. Mocks only for time travel or rapid iteration; real testnet wherever possible
