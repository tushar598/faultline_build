// What an attestation actually binds. Coordinates and the zone are NOT signed fields: the epicentre and depth are bound
// through `dataHash` (hash of the canonical USGS record) and the box, curve and depth limit through `termsHash`. The chain
// checks the signature and termsHash; it cannot read the record. Mock-tested; shared/ts hashes also ran on testnet.
import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { checkAcceptance, dataHash, kutchTerms, termsHash, type UsgsFeature } from "../shared/ts/attestation";
import { BHUJ_FILE, loadFeature } from "../scripts/lib/fixtures";
import { ATTESTATION_SPEC } from "./helpers/eip712";
import { advance } from "./helpers/time";
import { EV_A, Status, WINDOW, makeAtt, sign, submit, triggerFixture } from "./helpers/trigger";

const bhuj = (): UsgsFeature => loadFeature(BHUJ_FILE);
const moved = (coords: [number, number, number]): UsgsFeature => ({ ...bhuj(), geometry: { ...bhuj().geometry, coordinates: coords } });
const [LON, LAT, DEPTH] = bhuj().geometry.coordinates;

describe("Attestation binding", () => {
  it("the signed struct has no coordinate or zone field: they cannot be tampered with on chain, only through the hashes", () => {
    const names = ATTESTATION_SPEC.types.Attestation.map((f) => f.name);
    expect(names).to.deep.equal(["eventId", "lossBps", "magnitudeX100", "observedAt", "usgsUpdatedAt", "nonce", "termsHash", "dataHash", "deadline"]);
  });

  describe("every signed field", () => {
    const tamper: Record<string, Record<string, string | bigint>> = {
      eventId: { eventId: ethers.id("other") },
      lossBps: { lossBps: 5_001n },
      magnitudeX100: { magnitudeX100: 701n },
      observedAt: { observedAt: 1n },
      usgsUpdatedAt: { usgsUpdatedAt: 1n },
      nonce: { nonce: 2n },
      termsHash: { termsHash: ethers.id("other") },
      dataHash: { dataHash: ethers.id("other") },
      deadline: { deadline: 2n ** 63n },
    };
    it("the table covers all nine fields", () => {
      expect(Object.keys(tamper)).to.deep.equal(ATTESTATION_SPEC.types.Attestation.map((f) => f.name));
    });
    for (const [field, change] of Object.entries(tamper)) {
      it(`changing ${field} after signing reverts InvalidSignature, before any other check`, async () => {
        const f = await loadFixture(triggerFixture);
        const att = makeAtt(f);
        const sig = await sign(f.oracle, att, await f.trigger.getAddress());
        await expect(f.trigger.submit({ ...att, ...change }, sig)).to.be.revertedWithCustomError(f.trigger, "InvalidSignature");
        expect(await f.trigger.pendingCount()).to.equal(0n);
      });
    }
  });

  describe("dataHash binds the epicentre, depth and record state", () => {
    it("moving the epicentre by 0.001 degree in either axis, or the depth by 1 km, changes dataHash", () => {
      const original = dataHash(bhuj());
      expect(dataHash(moved([LON + 0.001, LAT, DEPTH]))).to.not.equal(original);
      expect(dataHash(moved([LON, LAT + 0.001, DEPTH]))).to.not.equal(original);
      expect(dataHash(moved([LON, LAT, DEPTH + 1]))).to.not.equal(original);
    });
    it("magnitude, status and the update time change it; the volatile fields do not", () => {
      const f = bhuj();
      const original = dataHash(f);
      for (const p of [{ mag: 7.8 }, { status: "automatic" }, { updated: f.properties.updated + 1 }]) {
        expect(dataHash({ ...f, properties: { ...f.properties, ...p } })).to.not.equal(original);
      }
      expect(dataHash({ ...f, properties: { ...f.properties, felt: 99, url: "x" } })).to.equal(original);
    });
    it("the oracle rule refuses the record once it leaves the box or passes the depth limit", () => {
      const terms = kutchTerms("replay", 0);
      const nowSec = Math.floor(bhuj().properties.time / 1000) + 10 ** 9;
      expect(checkAcceptance(bhuj(), terms, nowSec)).to.deep.equal({ ok: true });
      expect(checkAcceptance(moved([72, LAT, DEPTH]), terms, nowSec)).to.deep.equal({ ok: false, reason: "box" });
      expect(checkAcceptance(moved([LON, 25, DEPTH]), terms, nowSec)).to.deep.equal({ ok: false, reason: "box" });
      expect(checkAcceptance(moved([LON, LAT, 71]), terms, nowSec)).to.deep.equal({ ok: false, reason: "depth" });
    });
    it("LIMIT, pinned: the chain cannot read the record. An oracle-signed wrong dataHash is accepted; the defence is the public record, the challenge window and the veto", async () => {
      const f = await loadFixture(triggerFixture);
      const claimed = dataHash(moved([LON + 5, LAT, DEPTH])); // a record the real USGS event does not match
      await submit(f, makeAtt(f, { dataHash: claimed }));
      const stored = (await f.trigger.getEventRecord(EV_A)).dataHash;
      expect(stored).to.equal(claimed);
      expect(stored).to.not.equal(dataHash(bhuj())); // anyone re-hashing the USGS record sees the mismatch
      await f.trigger.connect(f.trustee).veto(EV_A);
      await advance(WINDOW);
      await expect(f.trigger.execute(EV_A)).to.be.revertedWithCustomError(f.trigger, "NotPending");
      expect(await f.pool.appliedLossBps()).to.equal(0);
    });
  });

  describe("termsHash binds the zone and the rule", () => {
    const changed: Record<string, (t: ReturnType<typeof kutchTerms>) => ReturnType<typeof kutchTerms>> = {
      "box edge": (t) => ({ ...t, box: { ...t.box, maxLat: t.box.maxLat + 0.5 } }),
      "curve floor": (t) => ({ ...t, floorMagX100: t.floorMagX100 - 10 }),
      "curve ceiling": (t) => ({ ...t, ceilMagX100: t.ceilMagX100 + 10 }),
      "depth limit": (t) => ({ ...t, maxDepthKm: t.maxDepthKm + 1 }),
      "cooling period": (t) => ({ ...t, coolingPeriodSec: t.coolingPeriodSec - 1 }),
      "magnitude types": (t) => ({ ...t, magTypes: [...t.magTypes, "mb"] }),
    };
    for (const [name, change] of Object.entries(changed)) {
      it(`changing the ${name} changes termsHash, and a correctly signed attestation on those terms reverts TermsMismatch`, async () => {
        const base = kutchTerms("live", 0);
        const other = termsHash(change(base));
        expect(other).to.not.equal(termsHash(base));
        const f = await loadFixture(triggerFixture);
        await expect(submit(f, makeAtt(f, { termsHash: other }))).to.be.revertedWithCustomError(f.trigger, "TermsMismatch").withArgs(other);
        expect((await f.trigger.getEventRecord(EV_A)).status).to.equal(Status.None);
      });
    }
  });
});
