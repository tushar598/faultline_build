# Third-party notices

Faultline is released under the MIT License (see `LICENSE`). It uses or refers to the following third-party work,
which keeps its own license:

| Work | License | How Faultline uses it |
| --- | --- | --- |
| [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) 5.6.1 | MIT | npm dependency, imported by `contracts/` (unmodified) |
| [hiero-contracts](https://github.com/hiero-ledger/hiero-contracts) 0.2.0 (`@hiero-ledger/hiero-contracts`) | Apache-2.0 | function signatures of the HIP-719 facade and two HTS system-contract calls, restated in `contracts/interfaces/IHRC719.sol` and `IHederaTokenServiceLite.sol`; HTS response codes named in mocks |
| [Asset Tokenization Studio](https://github.com/hashgraph/asset-tokenization-studio) v8.0.0 | Apache-2.0 | public ABIs of the ATS v8 factory, bond and errors in `ops/abi/`; role ids and error names restated in `contracts/interfaces/IAtsBond.sol` and `contracts/mocks/MockBond.sol` |
| [Hiero / Hedera JavaScript SDK](https://github.com/hiero-ledger/hiero-sdk-js) (`@hashgraph/sdk`) | Apache-2.0 | npm dependency of `oracle/` and `ops/` |
| Other npm dependencies (Hardhat, ethers, Next.js, zod, Vitest, Playwright, …) | their own licenses, see each package | npm dependencies, not vendored |
| USGS earthquake data (`oracle/fixtures/real-usgs-*`) | US public domain | saved copies of the public USGS record of the 2001 Bhuj earthquake |

No third-party source file is copied into this repository with its license notice removed.
