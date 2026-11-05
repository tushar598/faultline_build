// Interfaces stay in sync with the design docs: role ids vs docs/reference/ats.md §3, and the Attestation
// fields in IFaultlineTrigger.sol + shared/attestation.eip712.json vs docs/ARCHITECTURE.md §6.1.
import fs from "node:fs";
import path from "node:path";
import { expect } from "chai";
import { artifacts, ethers } from "hardhat";
import { parseRoleConstants } from "./helpers/roles";
import { ATTESTATION_SPEC } from "./helpers/eip712";

const ROOT = path.join(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/** Role rows of docs/reference/ats.md §3: | `ROLE_X` | `0x…` | … */
function atsDocRoles(): Record<string, string> {
  const doc = read("docs/reference/ats.md");
  const section = doc.slice(doc.indexOf("## 3. Role ids"), doc.indexOf("## 4."));
  const out: Record<string, string> = {};
  for (const m of section.matchAll(/^\| `(ROLE_\w+)` \| `(0x[0-9a-fA-F]{64})` \|/gm)) out[m[1]] = m[2];
  return out;
}

/** Fields of the `Attestation(...)` block in docs/ARCHITECTURE.md §6.1, in order. */
function architectureAttestation(): { name: string; type: string }[] {
  const doc = read("docs/ARCHITECTURE.md");
  const section = doc.slice(doc.indexOf("### 6.1 EIP-712"), doc.indexOf("### 6.2"));
  const block = section.slice(section.indexOf("Attestation("), section.indexOf("\n)"));
  return [...block.matchAll(/^\s+(\w+)\s+(\w+),?\s*\/\//gm)].map((m) => ({ type: m[1], name: m[2] }));
}

describe("interfaces", () => {
  it("IAtsBond role ids equal docs/reference/ats.md §3 byte for byte", () => {
    const sol = parseRoleConstants();
    const doc = atsDocRoles();
    const names = ["ROLE_ISSUER", "ROLE_CONTROLLER", "ROLE_AGENT", "ROLE_ADJUSTMENT_BALANCE", "ROLE_KYC", "ROLE_PAUSER"];
    expect(Object.keys(sol).sort()).to.deep.equal([...names].sort());
    for (const n of names) {
      expect(doc[n], `${n} missing in ats.md`).to.be.a("string");
      expect(sol[n], n).to.equal(doc[n]);
    }
  });

  it("Attestation fields match ARCHITECTURE §6.1 in the shared JSON and in IFaultlineTrigger (names, types, order)", async () => {
    const fromDoc = architectureAttestation();
    expect(fromDoc).to.have.length(9);
    expect(ATTESTATION_SPEC.types.Attestation).to.deep.equal(fromDoc);

    const abi = (await artifacts.readArtifact("IFaultlineTrigger")).abi as {
      type: string;
      name?: string;
      inputs?: { name: string; type: string; internalType?: string; components?: { name: string; type: string }[] }[];
    }[];
    const submit = abi.find((e) => e.type === "function" && e.name === "submit")!;
    expect(submit.inputs![0].internalType).to.equal("struct IFaultlineTrigger.Attestation");
    const fromSol = submit.inputs![0].components!.map(({ name, type }) => ({ name, type }));
    expect(fromSol).to.deep.equal(fromDoc);
  });

  it("shared EIP-712 domain is FaultlineTrigger v1 and the type string is what the trigger will hash", () => {
    expect(ATTESTATION_SPEC.domain).to.deep.equal({ name: "FaultlineTrigger", version: "1" });
    expect(ATTESTATION_SPEC.primaryType).to.equal("Attestation");
    const encoded = ethers.TypedDataEncoder.from({ Attestation: ATTESTATION_SPEC.types.Attestation }).encodeType("Attestation");
    expect(encoded).to.equal(
      "Attestation(bytes32 eventId,uint16 lossBps,uint16 magnitudeX100,uint64 observedAt,uint64 usgsUpdatedAt," +
        "uint64 nonce,bytes32 termsHash,bytes32 dataHash,uint64 deadline)",
    );
  });

  it("IFaultlinePool exposes the D2/D4/D11 surface", async () => {
    const abi = (await artifacts.readArtifact("IFaultlinePool")).abi as { type: string; name: string }[];
    const names = new Set(abi.map((e) => `${e.type}:${e.name}`));
    for (const n of ["function:sweepExcess", "function:sweepDust", "function:redeem", "function:applyLoss", "error:SupplyMismatch", "error:NotKycForToken", "error:HtsCallFailed", "error:RedemptionNotOpen"]) {
      expect(names.has(n), n).to.equal(true);
    }
    const trig = (await artifacts.readArtifact("IFaultlineTrigger")).abi as { type: string; name: string }[];
    const tnames = new Set(trig.map((e) => `${e.type}:${e.name}`));
    for (const n of ["function:submissionDeadline", "function:effectiveTime", "function:pendingCount", "function:getEventRecord"]) {
      expect(tnames.has(n), n).to.equal(true);
    }
  });
});
