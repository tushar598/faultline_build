# ATS (Asset Tokenization Studio) v8 — reference for Faultline

Source of truth: the ATS repository at tag `v.8.0.0-ats`, commit `be4f860` (24 Jun 2026).
Read-only clone: `~/Desktop/faultline-refs/asset-tokenization-studio` (do not edit; the owner's own
working copy at `~/Desktop/asset-tokenization-studio` is the same commit but has untracked files).
Repo: <https://github.com/hashgraph/asset-tokenization-studio>.
All paths below are relative to `packages/ats/contracts/`.

Legend: ✅ verified from source in this repo · 🧪 needs testnet confirmation · ❓ not verified.

## 1. Testnet deployment (v8) ✅

From `deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json` (the latest record in the repo):

| Item | Hedera id | EVM address |
| --- | --- | --- |
| Factory proxy | `0.0.9213391` | `0xd1F118A40f3b02883D35909eF2517e7EDd78379d` |
| Business Logic Resolver (BLR) proxy | `0.0.9212226` | `0xBA2D5FC2083A0b8f164c50e65d782087fBA18E0a` |
| ProxyAdmin | `0.0.9212218` | `0x92664E864200b8fA891195CeEC93880F5Bfa6f22` |

Configuration ids (`scripts/domain/constants.ts`, same in the deployment file):
`EQUITY 0x…01`, **`BOND 0x…02`** (variable-rate bond, 94 facets), `BOND_FIXED_RATE 0x…03`,
`BOND_KPI_LINKED_RATE 0x…04`, `DEPOSIT_TOKEN 0x…05`, `LOAN 0x…06`, `LOANS_PORTFOLIO 0x…07`,
`FACTORY 0x…08` (each `0x` + 63 zeros + digit, version 1).

The older v4.0.0 ids in the ATS docs (BLR `0.0.7707874`, factory `0.0.7708432`) are what the owner's
test bond TCB used; Faultline uses v8 (owner decision 2026-10-25).

## 2. Interfaces Faultline calls ✅ (🧪 on testnet)

| Function | File | Guards (modifiers) |
| --- | --- | --- |
| `mint(address _to, uint256 _amount)` | `contracts/facets/mint/IMint.sol` | operational, activated, unpaused, single partition, `ROLE_ISSUER` or `ROLE_AGENT`, caller not recovered, within max supply, `_to` KYC `GRANTED` (+ identity registry if set), compliance (`from = 0`, sender not checked) |
| `issue(address _tokenHolder, uint256 _value, bytes _data)` | same | same as `mint` |
| `controllerRedeem(address _tokenHolder, uint256 _value, bytes _data, bytes _operatorData)` | `contracts/facets/controller/IController.sol` | operational, activated, **unpaused**, controllable, single partition, `ROLE_CONTROLLER` or `ROLE_AGENT`. **No KYC check on the holder, no maturity check** |
| `balanceOf(address)` | `contracts/facets/balanceTracker/BalanceTracker.sol` | view; free balance, adjusted for scheduled balance adjustments. **Excludes** locked / held / clearing amounts |
| `getTotalBalanceFor(address)` | same | view; includes locked, held and clearing amounts |
| `totalSupply()` | same | view; adjusted for scheduled balance adjustments |
| `decimals()` | `contracts/facets/core/Core.sol` | view (note `decimalsAt(ts)` exists: balance adjustments can change decimals → supply guard D4) |
| `isControllable()` | `IController.sol` | view |
| `hasRole(bytes32,address)`, `getRoleMemberCount(bytes32)`, `getRoleMembers(bytes32,uint256,uint256)`, `grantRole`, `revokeRole` | `contracts/facets/accessControl/IAccessControl.sol` | grant/revoke: role admin |
| `grantKyc(address _account, string _vcId, uint256 _validFrom, uint256 _validTo, address _issuer)` | `contracts/facets/kyc/IKyc.sol` | `ROLE_KYC`; account status `NOT_GRANTED`; valid dates; `_issuer` registered |
| `getKycStatusFor(address)` → `KycStatus` | same | view |
| `addIssuer(address)` / `isIssuer(address)` | `contracts/facets/ssiManagement/ISsiManagement.sol` | `ROLE_SSI_MANAGER` |
| `pause()` / `unpause()` / `paused()` | `contracts/facets/pause/IPause.sol` | `ROLE_PAUSER` (Faultline never pauses the bond) |
| `fullRedeemAtMaturity(address)` | `contracts/facets/maturity/IMaturity.sol` | `ROLE_MATURITY_REDEEMER`, maturity reached — **not used** (decision: `controllerRedeem`) |

Thin interface for Faultline (`contracts/interfaces/IAtsBond.sol`) should contain only: `mint`,
`controllerRedeem`, `balanceOf`, `totalSupply`, `decimals`, `hasRole`, `getRoleMemberCount`,
`isControllable`. Mocks mirror these names and the revert-on-non-KYC behaviour.

## 3. Role ids ✅ (`contracts/constants/roles.sol`)

| Role | Id | Faultline use |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | `0x00` | bond admin (trust assumption) |
| `ROLE_ISSUER` | `0x5eeaf5602c75bf26e73b5206d0bd6ee82f621166255e5fd73cc06bc7bd84a95f` | **pool only** |
| `ROLE_CONTROLLER` | `0xb4d2b850c3ed8a234d390d5c157bbb1824883213c335ffe2a0f0761bb168713e` | **pool only** |
| `ROLE_AGENT` | `0x9830aa071a741c08855dd42130bdb0ff50f7bdf5a4b72f12181eefded0c6542b` | **nobody** (can mint and controllerRedeem) |
| `ROLE_KYC` | `0x754f499f9fdfbb089d12bdec817a6863d593d8a3ea7f546c00a5cafd20957bfc` | KYC operator (owner's issuer account) |
| `ROLE_SSI_MANAGER` | `0x3120494a82251fe85b0403877539486dbfcf0f94c20741a3229cfad31f625ee1` | registers the VC issuer |
| `ROLE_INTERNAL_KYC_MANAGER` | `0xdd78fdcd1b38a5360405cef8d91e758ad0f42bf2ced681b803b3c2704b0a32a7` | activate internal KYC |
| `ROLE_KYC_MANAGER` | `0xec811504e835acf29535b5b62307b08000468f0c61ca6163ed6f17a03629b91e` | external KYC lists |
| `ROLE_PAUSER` | `0x3cb8b459fdb6e7dc3d2a2aa529e530f885d45e03584adb438423209c86a2731f` | spike S2 only |
| `ROLE_ADJUSTMENT_BALANCE` | `0xb246506a8ded65dd6360e8ce033fd9462936d1be64fb9f85c5f60d28cd3ca6da` | **nobody** (D4) |
| `ROLE_CORPORATE_ACTION` | `0xa1acfc499025c99f55059195e6276f639d34a18aad7b8121b9192b7f438c55cd` | coupons (spike S6, stretch) |
| `ROLE_SNAPSHOT` | `0xf7d999723d2160432933a2aeffaae83e262a5a46fe94f34614a7676d1d1f67c6` | spike S6 |
| `ROLE_LOCKER`, `ROLE_CLEARING`, hold roles | see file | **nobody** (D9) |

## 4. Fresh bond setup order (v8) ✅ source / 🧪 testnet

Matches ATS issue 1390 (<https://github.com/hashgraph/asset-tokenization-studio/issues/1390>):

1. `Factory.deployBond(BondData, FactoryRegulationData)` → bond address (event `BondDeployed`).
   - `BondData.security` (`SecurityData`): `resolver` = BLR proxy, `maxSupply` = cap,
     `resolverProxyConfiguration` = `{ key: BOND_CONFIG_ID, version: 1 }`,
     `erc20MetadataInfo` = `{ name, symbol, isin, decimals: 6 }`, `rbacs` (initial roles),
     `externalPauses/ControlLists/KycLists` = `[]`, `compliance` = `0x0`, `identityRegistry` = `0x0`,
     `arePartitionsProtected: false`, `isMultiPartition: false`, **`isControllable: true`**,
     `isWhiteList: false`, `clearingActive: false`, **`internalKycActivated: true`**,
     `erc20VotesActivated: false`.
   - `BondData.bondDetails` (`BondDetailsData`): `currency` = `bytes3("USD")` (fixed to USD),
     `nominalValue` + `nominalValueDecimals` (1 USD → e.g. `100` with `2` 🧪), `startingDate`,
     `maturityDate`.
   - `proceedRecipients` / `proceedRecipientsData` = `[]`.
   - `isin` must be **Luhn-valid** (`contracts/factory/isinValidator.sol`).
   - `FactoryRegulationData` (`contracts/constants/regulation.sol`): regulation type/sub-type +
     `AdditionalSecurityData{ countriesControlListType, listOfCountries, info }`.
2. Grant `ROLE_SSI_MANAGER` to the issuer account → `addIssuer(issuerEvmAddress)`.
3. Grant `ROLE_KYC` → `grantKyc(investor, vcId, validFrom, validTo, issuer)` for every investor
   (and any wallet that will receive a transfer).
4. Grant the pool `ROLE_ISSUER` and `ROLE_CONTROLLER`; revoke `ROLE_ISSUER` from every other address;
   check `getRoleMemberCount(ROLE_AGENT) == 0` and `getRoleMemberCount(ROLE_ADJUSTMENT_BALANCE) == 0`.
5. Never call `pause()` on the bond.

Exact factory struct definitions: `contracts/factory/IFactory.sol` (lines ~55–180),
`contracts/facets/core/ICore.sol` (`ERC20MetadataInfo`). Example bond creation in TypeScript:
`scripts/domain/bond/createConfiguration.ts` and the SDK under `packages/ats/sdk`.

## 5. VC generation for KYC ✅ / ⚠️

`tasks/utils.ts` task `createVC`: `npx hardhat createVC --holder <investorEvm> --privatekey <issuerKey>`
(run inside `packages/ats/contracts`). It writes `vc_<holder>_<ts>.vc` in the current folder.

⚠️ The task takes the private key as a **command-line argument**, so it lands in shell history.
Safer: `read -s ISSUER_PK` then `npx hardhat createVC --holder 0x… --privatekey "$ISSUER_PK"`, and
never commit `.vc` files (our `.gitignore` blocks `*.vc`).

## 6. Coupons and snapshots (stretch, spike S6) ✅ source

`contracts/facets/coupon/ICoupon.sol`: `setCoupon(Coupon)` (`recordDate, executionDate, startDate,
endDate, fixingDate, rate, rateDecimals, rateStatus`), `getCouponFor(id, account)` →
`CouponFor{ tokenBalance, …, recordDateReached, couponAmount }`, `getCouponAmountFor`,
`getCouponCount`. `contracts/facets/snapshot/ISnapshots.sol`: `takeSnapshot()`; per-snapshot balances
in `facets/balanceTrackerAtSnapshot/IBalanceTrackerAtSnapshot.sol`
(`balanceOfAtSnapshot(id, holder)`). ATS records entitlements but does **not** move cash; a payer
contract would read `balanceOfAtSnapshot` → this is what interim coupons would need.

## 7. Files to read before writing code

| File | Why |
| --- | --- |
| `contracts/facets/mint/IMint.sol`, `Mint.sol` | mint guards |
| `contracts/facets/controller/IController.sol`, `Controller.sol` | controllerRedeem guards |
| `contracts/constants/roles.sol` | role ids |
| `contracts/facets/kyc/IKyc.sol`, `Kyc.sol` | KYC status enum, grantKyc |
| `contracts/facets/ssiManagement/ISsiManagement.sol` | addIssuer |
| `contracts/domain/asset/ERC1594StorageWrapper.sol` (`_isIdentified`, `_isCompliant`) | exact KYC/compliance checks |
| `contracts/facets/balanceTracker/BalanceTracker.sol` | balanceOf vs getTotalBalanceFor |
| `contracts/factory/IFactory.sol`, `isinValidator.sol`, `constants/regulation.sol` | deployBond inputs |
| `deployments/hedera-testnet/newBlr-2026-06-12T11-19-42-198.json` | addresses |

## 8. Known ATS issues

- UI/SDK "Force Redeem" fails with "Insufficient allowance" (SDK pre-check
  `ControllerRedeemCommandHandler.execute` → `validationService.checkCanRedeem`). Direct contract
  calls work (owner's testnet runs). Root cause ❓. Candidate upstream issue.
- First-time v8 setup footguns (ISIN Luhn, role order): issue 1390 above.
