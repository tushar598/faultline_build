# Hedera — reference for Faultline

Checked 2026-10-25. Legend: ✅ verified against the linked official source · 🧪 needs a testnet spike ·
❓ could not verify.

Local copies of official interfaces: `~/Desktop/faultline-refs/hiero-contracts/package/`
(`npm pack @hiero-ledger/hiero-contracts@0.2.0`, repo <https://github.com/hiero-ledger/hiero-contracts>).

## 1. Networks, chain ids, RPC ✅

Source: <https://docs.hedera.com/hedera/core-concepts/smart-contracts/json-rpc-relay>,
<https://docs.hedera.com/hedera/core-concepts/smart-contracts/deploying-smart-contracts>

| Network | Chain id | Hashio JSON-RPC | Mirror node REST |
| --- | --- | --- | --- |
| Mainnet | 295 (`0x127`) | `https://mainnet.hashio.io/api` | `https://mainnet.mirrornode.hedera.com` |
| Testnet | 296 (`0x128`) | `https://testnet.hashio.io/api` | `https://testnet.mirrornode.hedera.com` (reachable from the owner's Mac, 2026-10-25) |
| Previewnet | 297 (`0x129`) | `https://previewnet.hashio.io/api` | — |
| Local dev nets | 298 (`0x12A`) | — | — |

- Hashio is "for development and testing purposes only". Fine for us.
- The relay reports `msg.value` / gas price with **18 decimals (weibar)**; inside the EVM, HBAR is
  **tinybar (8 decimals)**. ✅ (same page)
- Explorer: HashScan `https://hashscan.io/testnet/…` (transaction, contract, topic pages).

## 2. EVM version ✅

Source: deploying-smart-contracts page above, "EVM hard fork history" table.

- Cancun shipped on Hedera mainnet in **v0.50** (`TLOAD`/`TSTORE`, `MCOPY`, `BLOBHASH`, `BLOBBASEFEE`,
  EIP-6780 `SELFDESTRUCT`). Blob (type 3) transactions are rejected (HIP-866). Hedera now runs the
  Pectra (Prague) execution layer.
- ⇒ Our `evmVersion: "cancun"` is safe. (HIP-865: <https://hips.hedera.com/hip/hip-865>)
- `block.chainid` returns 295/296/297/298. `block.basefee` returns 0. `block.gaslimit` returns the tx
  gas limit. No PRNG opcode (use `0x169` if ever needed).

## 3. Gas ✅

Source: <https://docs.hedera.com/evm/development/gas-fees>

- **15 million gas per transaction** (unchanged). Network throughput is throttled by ops/sec (HIP-1249).
- Unused gas is **fully refunded** now (the old "charged at least 80% of the limit" rule is gone).
- All Faultline functions are O(1), well under the limit.

## 4. HTS token (the stablecoin) ✅ / 🧪

Sources: <https://docs.hedera.com/evm/hedera-services/hybrid/erc-compatibility>,
<https://docs.hedera.com/learn/core-concepts/tokens/airdrops> (associations),
HIP-719 <https://hips.hedera.com/hip/hip-719>, interfaces in hiero-contracts.

- An HTS token has an EVM address and a **facade** that speaks ERC-20 (`transfer`, `approve`,
  `transferFrom`, `balanceOf`, `decimals`, `allowance`) — HIP-218/376. ✅
- **Association:** the recipient (account *or contract*) must be associated before receiving, unless
  it has a free auto-association slot. `maxAutoAssociations`: `0` none, `-1` unlimited (default for
  auto-created accounts), `>0` limited. ✅ Whether a contract created via `eth_sendRawTransaction`
  gets `-1` by default ❓ → spike S3.
- Association from a contract, two ways ✅ (signatures from hiero-contracts):
  - HIP-719 facade on the token address:
    `interface IHRC719 { function associate() external returns (uint256 responseCode); function dissociate() external returns (uint256); function isAssociated() external view returns (bool); }`
    (`token-service/IHRC719.sol`). The pool calls `IHRC719(token).associate()`.
  - HTS system contract `0x167`: `associateToken(address account, address token) returns (int64)`
    (`token-service/IHederaTokenService.sol`).
  - Success code `22`; `TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT = 194` (treat as OK in `initialize`).
- **KYC:** if the token has a KYC key, every holder (pool, sponsor, investors) needs
  `TokenGrantKycTransaction` (SDK) or `grantTokenKyc(token, account)` on `0x167`. Missing KYC →
  `ACCOUNT_KYC_NOT_GRANTED_FOR_TOKEN = 176`. `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT = 184`. ✅ codes
  (`common/HederaResponseCodes.sol`); behaviour through the ERC-20 facade 🧪 (does `transferFrom`
  revert or return false?) → spike S3.
- **Token config for Faultline** (owner decision): `TokenCreateTransaction` with
  `setDecimals(6)`, `setTokenType(FungibleCommon)`, `setAdminKey`, `setSupplyKey`, `setKycKey`,
  optional `setFreezeKey`, **no `setWipeKey`**, no custom fees, `setFreezeDefault(false)`,
  ECDSA keys. (SDK methods confirmed present in `@hashgraph/sdk@2.81.0`.)

## 5. HCS (attestation log) ✅ (testnet-verified in spike S5, 2026-10-25)

Sources: <https://docs.hedera.com/hedera/sdks-and-apis/sdks/consensus-service/submit-a-message>,
<https://docs.hedera.com/hedera/sdks-and-apis/rest-api/topics>, mirror node OpenAPI
(`https://testnet.mirrornode.hedera.com/api/v1/docs/openapi.yml`, schema `TopicMessage`), fee table
<https://docs.hedera.com/hedera/networks/mainnet/fees>. This repo's topic: `0.0.11330395` (full demo, two attestation messages); evidence in docs/TESTNET-EVIDENCE.md.

- Create: `new TopicCreateTransaction().setSubmitKey(oracleKey).setTopicMemo("faultline")` →
  receipt `topicId`. A submit key makes the topic private-write: a message signed by another key fails with
  `INVALID_SIGNATURE` **at consensus** (the wrong payer is still charged, ≈ $0.00017), not at precheck. ✅
  No admin key → immutable topic. The SDK sets the auto-renew account to the operator and the period to
  7,776,000 s (90 days). ✅
- Publish: `new TopicMessageSubmitTransaction().setTopicId(id).setMessage(bytes)`. Receipt carries
  `topicSequenceNumber` and `topicRunningHash` (48 bytes). ✅
  **Max 1024 bytes per chunk**; default max 20 chunks (`setMaxChunks`, `setChunkSize`). A larger message becomes
  one transaction **per chunk** (tx id valid start +1 ns each), each with its own sequence number, consensus time,
  running hash and fee. `execute()` returns only the first chunk's response; `executeAll()` returns all. ✅
  Keep each attestation JSON ≤ 1024 bytes so it is one message (the §6.5 sample is 636 bytes with dummy values).
- Cost (measured on testnet, $0.0781/HBAR): submit ≈ **$0.0001 + $0.00000068 × bytes** (636 B → 0.00684 HBAR,
  1,024 B → 0.01022 HBAR); the table's "ConsensusSubmitMessage $0.0008" matches a full 1,024-byte message.
  TopicCreate charged **$0.02** (table says $0.01; the difference is not explained). ✅
- Delay: consensus ≈ 0.6–1.2 s after submit; visible on the mirror node **≈ 3–5 s after submit**
  (3.14 s for one chunk, 4.69 s for two). ✅
- Read (mirror node REST) ✅:
  - `GET /api/v1/topics/{id}/messages` — params that work: `limit`, `order=asc|desc`, `sequencenumber=N`,
    `sequencenumber=gte:N`, `timestamp=<consensus ts>`, `encoding=utf-8` (returns `message` as plain text).
  - `GET /api/v1/topics/{id}/messages/{sequence_number}`, `GET /api/v1/topics/messages/{consensus_timestamp}`,
    `GET /api/v1/topics/{id}` (`memo`, `submit_key`, `admin_key`, `auto_renew_account`, `auto_renew_period`,
    `custom_fees`, `fee_exempt_key_list`, `fee_schedule_key`, `deleted`, `created_timestamp`).
  - Message fields: `chunk_info` (`initial_transaction_id {account_id, nonce, scheduled, transaction_valid_start}`,
    `number`, `total`; present even for a one-chunk message), `consensus_timestamp`, `message` (base64),
    `payer_account_id`, `running_hash` (base64, equals the receipt's `topicRunningHash`), `running_hash_version`
    (3), `sequence_number`, `topic_id`.
  - The mirror node does not re-assemble chunks; a reader concatenates them in `chunk_info.number` order.
- SDK classes confirmed present in `@hashgraph/sdk@2.81.0`: `Client.forTestnet`,
  `PrivateKey.fromStringECDSA`, `TopicCreateTransaction`, `TopicMessageSubmitTransaction`,
  `TopicMessageQuery`.

## 6. Schedule Service (HIP-1215) — stretch only ✅ / 🧪

Sources: <https://docs.hedera.com/evm/hedera-services/system-contracts/schedule-service>,
<https://docs.hedera.com/learn/core-concepts/transactions/scheduled>, interfaces
`schedule-service/IHRC1215.sol`, `IHederaScheduleService.sol`, `HederaScheduleService.sol`.

- Address `0x16b`. HIP-1215 functions need node ≥ **0.68**.
- `scheduleCall(address to, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData) returns (int64 responseCode, address scheduleAddress)` — selector `0x6f5bfde8`; caller contract pays.
- `scheduleCallWithPayer(address to, address payer, uint256 expirySecond, uint256 gasLimit, uint64 value, bytes callData)` (`0xe6599c18`), `executeCallOnPayerSignature(...)` (`0x105772b2`),
  `deleteSchedule(address) returns (int64)` (`0x72d42394`),
  `hasScheduleCapacity(uint256 expirySecond, uint256 gasLimit) view returns (bool)` (`0xdfb4a999`).
- **Do not revert**: success = code `22` + schedule address; failure = zero address + error code.
- Max expiry **62 days (5,356,800 s)** in the future.
- Fees = HAPI ScheduleSign fee + 20% markup; the scheduling contract must hold HBAR.
- Response codes worth handling (`common/HederaResponseCodes.sol`):
  `SCHEDULE_EXPIRATION_TIME_TOO_FAR_IN_FUTURE = 306`, `…_MUST_BE_HIGHER_THAN_CONSENSUS_TIME = 307`,
  `SCHEDULE_FUTURE_THROTTLE_EXCEEDED = 308`, `SCHEDULE_FUTURE_GAS_LIMIT_EXCEEDED = 309`,
  `SCHEDULE_EXPIRY_IS_BUSY = 370`, `NO_SCHEDULING_ALLOWED_AFTER_SCHEDULED_RECURSION = 373`,
  `RECURSIVE_SCHEDULING_LIMIT_REACHED = 374`.
- **Correction to HANDOVER §4/§15:** code 373's official text is "A contract operation attempted to
  schedule another transaction after it had already scheduled a recursive contract call", and 374 says
  "A contract can schedule recursive calls a finite number of times (approximately four million…)".
  So recursive self-scheduling (a scheduled call that schedules the next one) looks **supported**;
  what fails is scheduling *again* in the same operation after a recursive schedule. 🧪 spike S4
  must confirm before any design relies on it.
- `forge script` cannot simulate `0x16b`; Hardhat tests put a mock there with `hardhat_setCode`
  (see tooling.md).

## 7. Account / key notes

- This repo's accounts: the eight `FLH_*` accounts in docs/ACCOUNTS.md (ECDSA, created hollow by an HBAR transfer to
  their EVM address). Their keys stay in the owner's Hardhat 3 keystore.
- Contracts: never read `msg.value` in a constructor; fund by a normal call. (HANDOVER §15, one dev
  article: <https://dev.to/edycutjong/hederas-evm-speaks-tinybar-its-rpc-speaks-weibar-and-both-mistakes-return-success-132e> — community source, not official.)
- `receive()` bypass by native HAPI transfers ❓ (unverified; Faultline contracts have no `receive`).
