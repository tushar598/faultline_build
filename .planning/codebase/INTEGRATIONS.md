# Integrations

Generated: 2026-10-25 · Source: codebase analysis of `faultline/`

---

## 1. Hedera Network (Primary Blockchain)

| Integration | Protocol | Endpoint | Status |
| --- | --- | --- | --- |
| JSON-RPC Relay (Hashio) | HTTP JSON-RPC | `https://testnet.hashio.io/api` | Configured in `hardhat.config.ts` |
| Mirror Node REST | HTTP REST | `https://testnet.mirrornode.hedera.com` | In `.env.example` |
| Chain ID | — | 296 (testnet), 295 (mainnet), 31337 (local) | Hardhat config |

**Known issues:**
- Hashio rejects large `eth_call` / `eth_estimateGas` payloads from Hardhat 3's HTTP provider (spikes use plain ethers `JsonRpcProvider` as workaround)
- Hashio rejected a large-gas MetaMask call → admin transactions go through scripts, not MetaMask
- Gas limit: 15M per transaction; unused gas fully refunded

## 2. ATS v8 (Asset Tokenization Studio)

| Item | Identifier | Purpose |
| --- | --- | --- |
| Factory proxy | `0.0.9213391` / `0xd1F118A40f3b02883D35909eF2517e7EDd78379d` | Deploy bond tokens |
| BLR proxy | `0.0.9212226` / `0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a` | Business Logic Resolver |
| Bond config ID | `0x…02` (BOND, version 1) | Variable-rate bond, 94 facets |

**Interface contract calls:**
- `mint(address, uint256)` / `issue(address, uint256, bytes)` — needs `ROLE_ISSUER`, recipient KYC
- `controllerRedeem(address, uint256, bytes, bytes)` — needs `ROLE_CONTROLLER`, no KYC/maturity check
- `balanceOf`, `totalSupply`, `decimals`, `hasRole`, `getRoleMemberCount`
- `grantKyc(account, vcId, validFrom, validTo, issuer)` — needs `ROLE_KYC`

**Trust assumptions:** Bond `DEFAULT_ADMIN_ROLE` holder could re-grant `ROLE_ISSUER` or pause the bond. Supply guard (D4) mitigates foreign mints.

**Status:** Design only; spike S1 will verify on testnet.

## 3. HTS Stablecoin (Hedera Token Service)

| Aspect | Detail |
| --- | --- |
| Token spec | HTS fungible token with ERC-20 facade |
| Decimals | 6 |
| Keys | Admin + Supply + KYC + Freeze (ECDSA); **no wipe key** |
| Association | HIP-719 `IHRC719(token).associate()` from pool contract |
| KYC | Required on pool, sponsor, and all investors |

**Trust assumptions:** Token admin/KYC/freeze keys are external trust assumptions. No wipe key prevents draining the pool.

**Status:** Not created yet; spike S3 will create test token `fUSD`.

## 4. USGS Earthquake API (ComCat)

| Aspect | Detail |
| --- | --- |
| Base URL | `https://earthquake.usgs.gov/fdsnws/event/1` |
| Format | GeoJSON (RFC 7946) |
| Endpoints used | `/query?eventid=<id>&format=geojson` (detail), `/query?format=geojson&...` (search) |
| Rate limits | None documented; public domain data |

**Oracle acceptance rule:**
- `properties.status == "reviewed"` (not automatic/deleted)
- `properties.type == "earthquake"`
- `properties.magType` in `{mww, mwc, mwb, mwr, mw}` (moment magnitudes)
- Epicentre inside geographic box, depth ≤ maxDepthKm
- Cooling period elapsed (6h placeholder)

**Known quirks:**
- `properties.ids` has leading/trailing commas (`,usp000a8ds,...,`)
- Deleted event by id → HTTP 409; unknown id → 404
- "Magnitude Types" page returns 403 to scripts
- Events can be merged (ids change) → oracle keeps an id ledger (D8)

**Fixtures:** Real Bhuj earthquake (usp000a8ds, M7.7) stored in `oracle/fixtures/`

## 5. HCS (Hedera Consensus Service)

| Aspect | Detail |
| --- | --- |
| Purpose | Immutable audit trail for oracle attestations |
| Message limit | 1024 bytes per chunk |
| Access | Submit key restricts who can publish |
| Read | Mirror node REST `/api/v1/topics/<id>/messages` |

**Message format:** JSON with `v`, `kind`, `chainId`, `trigger`, `attestation` (EIP-712 fields), `signature`, `usgsId`

**Status:** Not created yet; spike S5 will test topic create/publish/read.

## 6. Hedera Schedule Service (Stretch Goal)

| Aspect | Detail |
| --- | --- |
| System contract | `0x16b` |
| Max schedule horizon | 62 days |
| Purpose | Keeper-free coupon payments (if feasible) |
| Response codes | 22 = success; 306 = too far; 373/374 = recursive scheduling limits |

**Status:** Stretch goal; spike S4 will test recursive self-scheduling.

## 7. EIP-712 (Attestation Signing)

| Aspect | Detail |
| --- | --- |
| Domain name | `"FaultlineTrigger"` |
| Domain version | `"1"` |
| Chain binding | `chainId` + `verifyingContract` (one trigger per bond) |
| Type | `Attestation(bytes32 eventId, uint16 lossBps, uint16 magnitudeX100, ...)` |

**Flow:** Oracle signs → publishes to HCS → submits to trigger contract → ECDSA.recover verifies

## 8. Testnet Accounts

| Account | Hedera ID | EVM Address | Role |
| --- | --- | --- | --- |
| Deployer (bond admin, fUSD KYC key) | `0.0.11329142` | `0xbF89BCE061513D4763047D5F5A16846F149Ca248` | Bond admin, KYC operator |
| Investor A | `0.0.11329421` | `0xCE69d905EFc74B2fa4c93D6924EF5903DF8d9bda` | Completed by its first signed tx (smoke run) |

**Note:** the full set of eight `FLH_*` accounts is in docs/ACCOUNTS.md.
