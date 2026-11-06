# Testnet accounts (FLH_*)

The Hedera testnet accounts of this repo. The owner created them on 2026-11-06 and sets each key in the global
Hardhat 3 keystore (`cd ops && npx hardhat keystore set <NAME>`). Keys are never in this repo, in a chat or in a log.
Only public ids and addresses are recorded here.

All eight are ECDSA (secp256k1) accounts funded by an HBAR transfer to their EVM address, so they were **hollow** on
2026-11-06 (mirror node: `key` null). An account is completed by its first signed transaction as payer. The scripts
check this before they send: a hollow account's key must derive to its EVM alias, and a complete account's key must
match its on-chain public key.

| Role | Keystore name | Hedera id | EVM address | HBAR on 2026-11-06 | Pays for |
| --- | --- | --- | --- | --- | --- |
| Deployer: contracts admin, fUSD treasury and admin/supply/KYC key, bond admin | `FLH_DEPLOYER_PRIVATE_KEY` | `0.0.11329142` | `0xbF89BCE061513D4763047D5F5A16846F149Ca248` | 40 | token, bond and contract deploys, wiring, sweeps |
| Trustee: `TRUSTEE_ROLE` (pause, veto), HCS topic admin key | `FLH_TRUSTEE_PRIVATE_KEY` | `0.0.11329263` | `0x965eB9d778a912b23e467ba28490927b25E655ee` | 30 | pause, veto, grant to the backup trustee |
| Backup trustee: second `TRUSTEE_ROLE` holder (D17) | `FLH_TRUSTEE_BACKUP_PRIVATE_KEY` | `0.0.11329384` | `0xD66383855628a46A3E300ad889E9dF2eA9c5A0B0` | 20 | nothing in the demo (holds the role only) |
| Sponsor: funds the coupon reserve, receives the written-down principal | `FLH_SPONSOR_PRIVATE_KEY` | `0.0.11329411` | `0x457DC9004E8e68FFEbed749C18Ed27F94Ca66FE3` | 20 | associate, approve, fundCoupons, claim |
| Investor A | `FLH_INVESTOR_A_PRIVATE_KEY` | `0.0.11329421` | `0xCE69d905EFc74B2fa4c93D6924EF5903DF8d9bda` | 15 | associate, approve, invest, redeem, claim |
| Investor B | `FLH_INVESTOR_B_PRIVATE_KEY` | `0.0.11329470` | `0xF9786F3fc700F6ADE804DfC5c2A07c8CaB4C301F` | 15 | associate, approve, invest, redeem, claim |
| Oracle signer: EIP-712 attestations, HCS submit key (D16) | `FLH_ORACLE_PRIVATE_KEY` | `0.0.11329557` | `0x90A59Def9432C863A76F995Cd1eE57a881bb5a76` | 40 | nothing: it only signs (the relayer pays) |
| Relayer: pays the oracle's HCS and EVM fees (D16), topic auto-renew account | `FLH_RELAYER_PRIVATE_KEY` | `0.0.11329581` | `0x2f9A68d7880c9052A7Dac59aFe5b8223CF2eD5Db` | 50 | TopicCreate, HCS messages, `submit`, `execute` |

Ids and EVM addresses were checked against the public mirror node on 2026-11-06
(`/api/v1/accounts/<id>`: `evm_address` matches, `max_automatic_token_associations` -1).

The oracle signer also has a funded Hedera account. No script pays from it; the preflights only report it.

HBAR budget: the smoke preflight estimated about 31.5 HBAR for the deployer (the run used 32.3). The owner topped the
accounts up the same day; balances before the smoke run (mirror node,
2026-11-06): deployer 140, trustee 130, backup trustee 70, sponsor 120, investor A 15, investor B 75, oracle 40,
relayer 150 HBAR. The demo preflight (`ops:demo:0`) checks
the budget per account and requires the deployer to keep at least 10 HBAR.

All eight keystore names are set (`npx hardhat keystore list` in ops/, names only, 2026-11-06).
