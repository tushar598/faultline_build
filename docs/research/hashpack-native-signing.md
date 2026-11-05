# Research: signing the issuer page's native Hedera steps with HashPack

Status: **research and proposal only (2026-11-06). No code or design has changed.** Waiting for the owner's OK.

Question: can the issuer page sign the two native Hedera transactions that today need an `ops/` script, using a native
Hedera wallet (HashPack) through `@hashgraph/hedera-wallet-connect`? The two scripts are
`ops/scripts/issuer/hcs-topic.ts` (TopicCreate, D16 keys) and `ops/scripts/issuer/hts-kyc.ts` (TokenGrantKyc on the
stablecoin).

Labels used below:

- **docs-confirmed**: stated in an official doc, a package README or type definitions, or the ATS source.
- **checked**: read by me from the public mirror node or from this repo.
- **inference**: my reading, not stated in any doc.
- **not testnet-verified**: nothing in this note has been run against testnet with a wallet.

## Sources (read 2026-11-06)

| Source | Version / date |
| --- | --- |
| `@hashgraph/hedera-wallet-connect` README and `dist/*.d.ts` (npm tarball) | **2.1.3** (latest on npm, published 2026-04-14) |
| `@hashgraph/asset-tokenization-sdk` (local repo `~/Desktop/asset-tokenization-studio`, commit `be4f860e` "v8.0.0") | **8.0.0** (latest on npm); it pins `@hashgraph/hedera-wallet-connect` 2.1.2 |
| ATS SDK overview | https://docs.tokenization-studio.hedera.com/ats/developer-guides/sdk-overview/ |
| Hedera docs, create a topic | https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/create-a-topic |
| Hedera docs, enable KYC account flag | https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/enable-kyc-account-flag |
| Reown, Hedera JSON-RPC reference | https://docs.reown.com/advanced/multichain/rpc-reference/hedera-rpc |
| Hedera docs, keys and signatures | https://docs.hedera.com/hedera/core-concepts/keys-and-signatures |
| HashPack support | https://www.hashpack.app/support |

npm facts, from `npm view` on 2026-11-06 (**checked**):

- `@hashgraph/hedera-wallet-connect` 2.1.3 has these peer dependencies:
  - `@hiero-ledger/sdk` **2.79.0**, an exact pin. This is the renamed Hedera JS SDK; ops/ uses `@hashgraph/sdk` 2.81.0.
  - `@hiero-ledger/proto` ^2.25.0
  - `@reown/appkit` ^1.8.10, `@reown/appkit-controllers` ^1.8.10 and `@reown/walletkit` ^1.2.8
  - `@walletconnect/modal` ^2.7.0
  - `ethers` ^6.13.5. The web app uses 6.17.0, which fits.
- Current npm versions of the related packages: `@reown/appkit` 1.8.24, `@walletconnect/sign-client` 2.26.0 and
  `@hashgraph/sdk` 2.81.0.

## What the library offers (docs-confirmed)

The README describes two paths. Both go over the WalletConnect network, and both need a Reown (WalletConnect)
`projectId`:

1. **Reown AppKit + `HederaAdapter` (hedera namespace) + `HederaProvider`.** The README marks this path as recommended.
   For EVM operations it tells you to use Reown's `WagmiAdapter`. The `HederaAdapter` with `namespace: 'eip155'` is
   deprecated.
2. **`DAppConnector` directly.** The README calls this the legacy path, "maintained for backwards compatibility". It
   needs only `@walletconnect/modal`.

The JSON-RPC methods (HIP-820, Reown Hedera RPC reference):

- `hedera_signAndExecuteTransaction({ signerAccountId: "hedera:testnet:0.0.x", transactionList })`
  - `transactionList` is the base64 transaction from `transactionToBase64String(tx)`.
  - The wallet signs and **submits** the transaction.
  - It returns `nodeId`, `transactionHash` and `transactionId`.
- `hedera_signTransaction({ signerAccountId, transactionBody })` returns a base64 `signatureMap` and does not submit
  anything. The README's multi-sig section uses it like this:
  1. The wallet signs.
  2. Another party adds its signature with `addSignatureToTransaction(tx, privateKey)`.
  3. That party executes the transaction.

  The README also says: "Transaction Must Be Frozen", and "Signatures can be added in any order. Hedera validates that
  all required signatures are present when the transaction is executed."
- Neither the README nor the Reown reference says whether the wallet signs with anything other than the key of
  `signerAccountId`. I assume it does not: the wallet holds only that account's key (**inference**).

The ATS SDK 8.0.0 uses this library:

- `packages/ats/sdk/src/port/out/hs/walletconnect/HederaWalletConnectTransactionAdapter.ts` loads it lazily, because it
  is browser-only.
- The adapter sends `hedera_signAndExecuteTransaction` with the full frozen transaction bytes, and
  `hedera_signTransaction` with the body bytes.
- It pre-freezes a transaction with one node, `0.0.3`, so that HashPack signs the existing body bytes without
  re-encoding them. Its comment says that re-encoding can drop proto fields in older wallets (**docs-confirmed**, ATS
  source).

The ATS SDK cannot do either of our two steps (**checked**, ATS source 8.0.0):

- No `TopicCreateTransaction` and no `TokenGrantKycTransaction` appear anywhere in `packages/ats/sdk/src`.
- `Kyc.grantKyc()` in `ComplianceOperations.ts` is `executeContractCall(securityId, IAsset, "grantKyc", …)`: a call on
  the **bond** contract.
- So the Discord answer's "grantKyc()/revokeKyc()" covers bond KYC only. The issuer page already does that from the
  browser in step `bondKyc`.

**Conclusion:** the ATS SDK does not cover our two steps. If we do this, we use `@hashgraph/hedera-wallet-connect` and
`@hiero-ledger/sdk` directly. We do not need the ATS SDK.

## Answers

### a. TopicCreate with a submit key and an admin key different from the payer's

Who must sign (**docs-confirmed**, Hedera "create a topic"):

- The **payer**.
- The **admin key**, if one is set: "If an Admin Key is specified, the Admin Key must sign the transaction."
- The **auto-renew account**, if one is set: "If an Auto Renew Account is specified, that account must also sign this
  transaction." The page also says the auto-renew account defaults to the payer.
- The **submit key does not sign.** It is only set, so the oracle's public key is enough. That matches D16 and
  `hcs-topic.ts`, which needs no oracle signature.

What that means for our layout, which is the D16 layout used in `hcs-topic.ts`, demo phase 1 and spike S7 (payer =
auto-renew = relayer, admin = trustee):

- The topic needs **two** signatures: the relayer's and the trustee's.
- A single HashPack session (one account) cannot produce both through `hedera_signAndExecuteTransaction`
  (**inference** from the rules above).

Options:

| Option | Signers | One wallet call? | Change to D16 | Status |
| --- | --- | --- | --- | --- |
| A1. Trustee pays and is the auto-renew account; admin = trustee; submit = oracle public key | trustee only | yes: `hedera_signAndExecuteTransaction` from the trustee's HashPack account | the relayer no longer pays for the topic or auto-renews it; it still pays every message | rule docs-confirmed, flow **not testnet-verified** |
| A2. Keep D16: relayer pays. Trustee signs in HashPack (`hedera_signTransaction`), then the relayer adds its signature and executes | trustee (wallet) + relayer (ops/ key) | no: still needs an ops/ step for the relayer | none | README pattern docs-confirmed; **not testnet-verified** |
| A3. Keep D16, both in HashPack: sign as the trustee, switch HashPack to the relayer account, then `hedera_signAndExecuteTransaction` with the partly signed bytes | trustee + relayer, both imported in HashPack | two wallet calls | none | **not documented**: whether a wallet keeps signatures that are already in `transactionList` is not stated anywhere I found |

A1 is the only option that removes the ops/ step completely.

### b. TokenGrantKyc when the token's KYC key is the connected account's key

Who must sign (**docs-confirmed**, Hedera "enable KYC account flag"): the **KYC key** and the **fee payer**.
Preconditions:

- The token has a KYC key (otherwise `TOKEN_HAS_NO_KYC_KEY`).
- The account is associated (otherwise `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT`).

If the connected HashPack account pays and its account key **is** the token's KYC key, one signature covers both roles,
so `hedera_signAndExecuteTransaction` is enough (**inference** from the docs rule; **not testnet-verified**).

This holds for our token (**checked**, mirror node 2026-11-06): fUSD `0.0.11329874` has `kyc_key` ECDSA
`03f39002…bddb441`, which equals the account key of the deployer `0.0.11329142`. This is the same `sameKey` condition
that `hts-kyc.ts` already enforces.

### c. ECDSA accounts on testnet; MetaMask and HashPack on one page

ECDSA keys:

- Hedera's docs list HashPack as supporting both ED25519 and ECDSA keys (**docs-confirmed**, Hedera docs).
- HashPack imports an account from its account id plus a private key or a mnemonic (**docs-confirmed**, HashPack
  support page).
- `DAppConnector` takes `[HederaChainId.Mainnet, HederaChainId.Testnet]` (**docs-confirmed**, README).
- The ATS adapter reads `ed25519 || ECDSASecp256k1` from the returned signature map, so ECDSA signatures do come back
  through this path (**docs-confirmed**, ATS source).

Not confirmed:

- Whether HashPack shows an imported ECDSA account's EVM alias correctly.
- Whether HashPack can import a **hollow** account. Today the trustee `0.0.11329263`, the relayer `0.0.11329581` and the
  backup trustee are still hollow; the trustee is completed by its first tx in demo phase 2.

MetaMask and HashPack on one page:

- Today the web app uses only the injected EIP-1193 provider: `window.ethereum` through ethers `BrowserProvider` in
  `web/src/lib/issuer/tx.ts` (**checked**).
- A hedera-namespace WalletConnect session is a separate channel. Nothing in the docs says it conflicts with an injected
  provider, so I expect both to stay connected at the same time, with no switching for EVM steps (**inference, not
  documented, not testnet-verified**).
- The page must then check, before every native step, that the HashPack account maps (via the mirror node) to the
  address the step needs: trustee for the topic, KYC key holder for KYC. MetaMask keeps every EVM step as it is today.

### d. What would change in the wizard and in the audit

- `web/src/lib/issuer/wizard.ts`: on testnet, `topic`, `poolHtsKyc` and `investorHtsKyc` stay `kind: "ops"`, with an
  optional native path. The command and the "Check" button stay.
- The steps would read:
  - **topic**: "Sign with HashPack (trustee pays)" sends TopicCreate per option A1. "Check" then reads the topic as
    today.
  - **poolHtsKyc / investorHtsKyc**: "Sign with HashPack (KYC key holder)" sends one TokenGrantKyc per account that is
    associated but not yet GRANTED. Accounts that are not associated are skipped with the same message as today.
- **Pass/fail stays on the mirror node:** `checkTopic` (submit key = oracle, admin key = trustee) and `checkHtsKyc`
  (GRANTED). These do not care who signed, so the **audit step and its checks do not change** (**checked**,
  `web/src/lib/issuer/opsSteps.ts`, `audit.ts`).
- New refusals before any wallet prompt, mirroring the ops scripts:
  - The HashPack account maps to the expected EVM address.
  - The topic: admin key = the connected account's key, and the submit key is derived from the oracle address the
    issuer entered.
  - KYC: token `kyc_key` == the connected account's key (`sameKey`), and the token is an HTS token (long-zero address).
- With A1, `checkTopic` would not check `auto_renew_account` (it does not today). The issuer page would show that the
  trustee pays and auto-renews.
- The transaction ids go into the step's `txs`, like the EVM steps.

## Proposal (needs the owner's OK; nothing implemented)

Keep `ops/scripts/issuer/*` as the fallback and as the D16-exact path. Add an **optional** "Sign with HashPack" button to
the three steps, testnet only. On the local chain these steps stay MockUSD calls and the "nothing to create" check.

Files:

| File | What |
| --- | --- |
| `web/package.json` | `@hashgraph/hedera-wallet-connect` 2.1.3, `@hiero-ledger/sdk` 2.79.0 (exact, as the peer pin requires), `@walletconnect/modal` ^2.7.0 (DAppConnector path); decide between DAppConnector and AppKit first |
| `web/src/lib/hedera/walletConnect.ts` | browser-only, lazy `import()` like the ATS adapter; `DAppConnector` init for `hedera:testnet`, connect/disconnect, the connected account id |
| `web/src/lib/issuer/nativeSteps.ts` | build and freeze `TopicCreateTransaction` and `TokenGrantKycTransaction` (one node, as ATS does), the refusals listed in d., `signAndExecuteTransaction`, then the existing mirror checks |
| `web/src/lib/issuer/wizard.ts`, `steps.ts` | a `native` flag on the three testnet step definitions; record tx ids |
| `web/src/components/issuer/LaunchSection.tsx` | the HashPack connect control and the per-step button, next to the existing command |
| `web/src/config/networks.ts` | `walletConnectProjectId` (public), read from `NEXT_PUBLIC_WC_PROJECT_ID` |
| `docs/` | the issuer-page section and COMMANDS: both paths, and which one is testnet-verified |

Tests:

- `web/test/issuer.native.test.ts`, unit tests with a fake connector (no network):
  - The built transactions carry exactly the memo, the submit key (derived from the oracle address), the admin key,
    the auto-renew account, the token and the account.
  - Every refusal: wrong HashPack account, KYC key mismatch, not associated, ED25519 key, non-HTS stablecoin.
  - Nothing is sent when a refusal fires.
  - No private key ever appears in the web code.
- Keep `web/test/issuer.ats.test.ts` "the npm scripts the commands name exist", because the fallback stays.
- Playwright cannot drive HashPack. The wallet path needs one manual testnet run by the owner:
  1. Topic, option A1, from the trustee.
  2. KYC for one pool, from the deployer.

  After that run, the evidence goes in docs and the label changes from "not testnet-verified".

Risks:

- **D16 deviation (A1):** the trustee pays for the topic (~0.4 HBAR, S7 measured 0.3935) and becomes its auto-renew
  account. If the owner wants D16 exactly, A2 still needs an ops/ step, and A3 is undocumented.
- **External service:** a Reown project id, and the WalletConnect relay must be up. Allowed origins must be configured
  in the Reown dashboard.
- **Dependency weight and churn:**
  - A second Hedera SDK (`@hiero-ledger/sdk`, exact pin 2.79.0) in the web bundle.
  - Reown packages.
  - The README calls DAppConnector "legacy", while the recommended AppKit path is heavier.
  - Browser-only code needs care with Next.js SSR, so it must be loaded lazily.
- **Hollow accounts:** HashPack import of a hollow ECDSA account is undocumented. The trustee may need its first EVM tx
  (from MetaMask) before it can be used in HashPack.
- **Two wallets on one page:** a user can easily connect the wrong account. The page must refuse before prompting.
- **Wallet re-encoding:** the ATS source notes that re-encoding can drop proto fields in older wallets. Pre-freeze with
  one node as ATS does, and check the result on the mirror node, as we do today.
- **Security gain:** keys stay in the wallet; the keystore password is not needed for these steps. The ops/ path still
  needs it.
