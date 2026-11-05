// The creation code the issuer page deploys: the repo build in artifacts/ (run `npm run compile` at the root before
// `npm run web:build`), bundled at build time and loaded only on the issuer page. Its keccak is shown before anything is
// sent and compared with what each deployment transaction carried (audit.ts sentInitcodeKeccak).
import { keccak256, type InterfaceAbi } from "ethers";

export type Built = { name: string; abi: InterfaceAbi; bytecode: string; keccak: string; bytes: number };
export type IssuerBuild = { pool: Built; trigger: Built; mockBond: Built };

type Artifact = { contractName: string; abi: InterfaceAbi; bytecode: string };

const built = (a: Artifact): Built => ({ name: a.contractName, abi: a.abi, bytecode: a.bytecode, keccak: keccak256(a.bytecode), bytes: (a.bytecode.length - 2) / 2 });

/** Loads the three artifacts the page can deploy (MockBond only on the local chain). */
export async function loadBuild(): Promise<IssuerBuild> {
  const [pool, trigger, mockBond] = await Promise.all([
    import("../../../../artifacts/contracts/FaultlinePool.sol/FaultlinePool.json"),
    import("../../../../artifacts/contracts/FaultlineTrigger.sol/FaultlineTrigger.json"),
    import("../../../../artifacts/contracts/mocks/MockBond.sol/MockBond.json"),
  ]);
  return { pool: built(pool.default as Artifact), trigger: built(trigger.default as Artifact), mockBond: built(mockBond.default as Artifact) };
}

/** MockUSD fragments for the local chain, where the MockUSD admin stands in for the HTS KYC key (test/issuer.ats.test.ts
 *  checks them against the artifact). */
export const MOCK_USD_ABI = [
  "function admin() view returns (address)",
  "function grantKyc(address account)",
  "function kycGranted(address account) view returns (bool)",
  "function associatedOf(address account) view returns (bool)",
] as const;
