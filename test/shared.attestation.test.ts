// shared/ts/attestation.ts: termsHash, dataHash, magnitude and curve, acceptance rule, replay times, build + sign,
// and the on-chain digest check against FaultlineTrigger.hashAttestation (pending until Part 2 adds the contract;
// test/shared.eip712.test.ts checks the same digest off chain meanwhile).
import { expect } from "chai";
import { ethers } from "hardhat";
import {
  REPLAY_CHAIN_IDS,
  assertReplayAllowed,
  buildAttestation,
  checkAcceptance,
  dataHash,
  dataSubset,
  eventIdOf,
  kutchTerms,
  lossBpsFor,
  magnitudeX100,
  observedAtOf,
  termsHash,
  usgsUpdatedAtOf,
  type UsgsFeature,
} from "../shared/ts/attestation";
import { canonicalize } from "../shared/ts/jcs";
import { BHUJ_FILE, SYNTH_72_FILE, SYNTH_73_FILE, SYNTH_75_FILE, loadFeature } from "../scripts/lib/fixtures";
import { ATTESTATION_SPEC } from "./helpers/eip712";

const bhuj = () => loadFeature(BHUJ_FILE);
const with_ = (f: UsgsFeature, p: Partial<UsgsFeature["properties"]>, coords?: [number, number, number]): UsgsFeature => ({
  ...f,
  properties: { ...f.properties, ...p },
  geometry: { ...f.geometry, coordinates: coords ?? f.geometry.coordinates },
});

describe("shared/ts attestation — terms and hashes", () => {
  it("D13 terms canonicalise to the expected JCS text; termsHash = keccak256(utf8(JCS))", () => {
    const t = kutchTerms("live", 0);
    const text =
      '{"aggregation":"sum-capped-10000","box":{"maxLat":24.5,"maxLon":71.5,"minLat":22.5,"minLon":68.5},"ceilMagX100":800,' +
      '"coolingPeriodSec":21600,"floorMagX100":700,"magTypes":["mww","mwc","mwb","mwr","mw"],"maxDepthKm":70,"mode":"live",' +
      '"source":"USGS ComCat","timeOffsetSec":0,"version":1}';
    expect(canonicalize(t)).to.equal(text);
    expect(termsHash(t)).to.equal(ethers.keccak256(ethers.toUtf8Bytes(text)));
  });

  it("termsHash ignores key order but changes with mode or offset, so replay terms never match a live bond (D10)", () => {
    const t = kutchTerms("replay", 123);
    const shuffled = Object.fromEntries(Object.entries(t).reverse()) as typeof t; // same fields, reversed key order
    expect(termsHash(shuffled)).to.equal(termsHash(t));
    expect(termsHash(kutchTerms("replay", 124))).to.not.equal(termsHash(t));
    expect(termsHash(kutchTerms("live", 0))).to.not.equal(termsHash(kutchTerms("replay", 0)));
    expect(() => kutchTerms("live", 5)).to.throw(/live/);
  });

  it("dataHash covers exactly the §6.4 subset of the real Bhuj record", () => {
    const f = bhuj();
    expect(canonicalize(dataSubset(f))).to.equal(
      '{"geometry":{"coordinates":[70.232,23.419,16]},"id":"usp000a8ds","properties":{"code":"p000a8ds",' +
        '"ids":",usp000a8ds,choy20010126031640,gcmtm012601a,gcmt20010126031640,duputel012601a,atlas20010126031640,iscgem1763683,",' +
        '"mag":7.7,"magType":"mwc","net":"us","status":"reviewed","time":980479000500,"type":"earthquake","updated":1651259174319}}',
    );
    // Volatile fields do not move it; a scientific change does.
    expect(dataHash(with_(f, { felt: 99, url: "x", sig: 1, mmi: 1 }))).to.equal(dataHash(f));
    expect(dataHash(with_(f, { mag: 7.6 }))).to.not.equal(dataHash(f));
    expect(dataHash(with_(f, {}, [70.232, 23.419, 17]))).to.not.equal(dataHash(f));
    expect(eventIdOf("usp000a8ds")).to.equal(ethers.id("usp000a8ds"));
  });
});

describe("shared/ts attestation — magnitude and curve (§6.2, D13)", () => {
  it("magnitudeX100 rounds (USGS mag is a float): 8.2 → 820 and 4.35 → 435, where floor(mag*100) gives 819 / 434", () => {
    expect(7.7 * 100).to.equal(770); // exact in IEEE-754 (ARCHITECTURE §6.2 said otherwise; corrected)
    expect(magnitudeX100(7.7)).to.equal(770);
    expect(8.2 * 100).to.equal(819.9999999999999);
    expect(magnitudeX100(8.2)).to.equal(820);
    expect(Math.floor(4.35 * 100)).to.equal(434);
    expect(magnitudeX100(4.35)).to.equal(435);
    expect(() => magnitudeX100(NaN)).to.throw();
  });

  it("lossBps = min(10000, floor((m - 700) * 10000 / 100)); 0 at or below 7.0; Bhuj 770 → 7000", () => {
    const t = kutchTerms("live", 0);
    const table: [number, number][] = [[699, 0], [700, 0], [701, 100], [720, 2000], [730, 3000], [750, 5000], [770, 7000], [799, 9900], [800, 10000], [850, 10000]];
    for (const [m, bps] of table) expect(lossBpsFor(m, t), String(m)).to.equal(bps);
    expect(() => lossBpsFor(770.5, t)).to.throw();
  });
});

describe("shared/ts attestation — acceptance rule (§6.2)", () => {
  const t = kutchTerms("live", 0);
  const ok = observedAtOf(bhuj(), t) + t.coolingPeriodSec;

  it("accepts the real Bhuj record once the cooling period has passed (inclusive)", () => {
    expect(checkAcceptance(bhuj(), t, ok)).to.deep.equal({ ok: true });
    expect(checkAcceptance(bhuj(), t, ok - 1)).to.deep.equal({ ok: false, reason: "cooling" });
  });

  it("live cooling (D14 unchanged): 1 h old rejected, 7 h old accepted; exactly 21600 s accepted, 21599 s rejected", () => {
    const origin = Math.floor(bhuj().properties.time / 1000);
    expect(observedAtOf(bhuj(), t)).to.equal(origin);
    const at = (ageSec: number) => checkAcceptance(bhuj(), t, origin + ageSec);
    expect(at(3_600)).to.deep.equal({ ok: false, reason: "cooling" });
    expect(at(7 * 3_600)).to.deep.equal({ ok: true });
    expect(at(21_600)).to.deep.equal({ ok: true });
    expect(at(21_599)).to.deep.equal({ ok: false, reason: "cooling" });
  });

  it("rejects automatic status, non-earthquake type, non-moment magType, outside the box, too deep, below the floor", () => {
    const f = bhuj();
    const cases: [UsgsFeature, string][] = [
      [with_(f, { status: "automatic" }), "status"],
      [with_(f, { type: "quarry blast" }), "type"],
      [with_(f, { magType: "mb" }), "magType"],
      [with_(f, {}, [71.6, 23.419, 16]), "box"],
      [with_(f, {}, [70.232, 22.4, 16]), "box"],
      [with_(f, {}, [70.232, 23.419, 71]), "depth"],
      [with_(f, { mag: 7.0 }), "belowFloor"],
    ];
    for (const [feature, reason] of cases) expect(checkAcceptance(feature, t, ok), reason).to.deep.equal({ ok: false, reason });
  });

  it("box edges and maxDepthKm are inclusive", () => {
    const f = bhuj();
    for (const c of [[68.5, 22.5, 70], [71.5, 24.5, 0]] as [number, number, number][]) {
      expect(checkAcceptance(with_(f, {}, c), t, ok)).to.deep.equal({ ok: true });
    }
  });

  it("every synthetic Kutch fixture is accepted and gives its documented loss; ids are synthetic", () => {
    for (const [file, bps] of [[SYNTH_72_FILE, 2000], [SYNTH_75_FILE, 5000], [SYNTH_73_FILE, 3000]] as const) {
      const f = loadFeature(file);
      expect(f.id.startsWith("synthetic-kutch-")).to.equal(true);
      expect(f.properties.net).to.equal("synthetic");
      expect(checkAcceptance(f, t, observedAtOf(f, t) + t.coolingPeriodSec)).to.deep.equal({ ok: true });
      expect(lossBpsFor(magnitudeX100(f.properties.mag), t)).to.equal(bps);
    }
    expect(() => loadFeature("usgs-made-up.geojson")).to.throw(/real-usgs-\* or synthetic-\*/);
  });
});

describe("shared/ts attestation — replay, build and sign", () => {
  it("replay (D10): observedAt = floor(time/1000) + offset, usgsUpdatedAt = floor(updated/1000) + offset", () => {
    const t = kutchTerms("replay", 1_000_000);
    expect(observedAtOf(bhuj(), t)).to.equal(980_479_000 + 1_000_000);
    expect(usgsUpdatedAtOf(bhuj(), t)).to.equal(1_651_259_174 + 1_000_000);
  });

  it("replay cooling (D14): measured on the real clock from the USGS origin time, not from the shifted observedAt", () => {
    const origin = Math.floor(bhuj().properties.time / 1000);
    const now = 1_793_000_000; // a 2026 wall clock
    // observedAt shifted to exactly `now` (0 s old in the bond's timeline), but the real event is ~25 years old.
    const fresh = kutchTerms("replay", now - origin);
    expect(observedAtOf(bhuj(), fresh)).to.equal(now);
    expect(checkAcceptance(bhuj(), fresh, now)).to.deep.equal({ ok: true });
    // Real age decides, with the same inclusive boundary as live: 21600 s accepted, 21599 s rejected, whatever the
    // offset says (here observedAt would be 7 h old on the shifted clock).
    const recent = with_(bhuj(), { time: (now - 21_600) * 1000 });
    const old7h = kutchTerms("replay", -3_600); // shifted observedAt = now - 25200 (7 h)
    expect(checkAcceptance(recent, old7h, now)).to.deep.equal({ ok: true });
    expect(checkAcceptance(recent, old7h, now - 1)).to.deep.equal({ ok: false, reason: "cooling" });
    expect(now - 1 - observedAtOf(recent, old7h)).to.equal(7 * 3_600 - 1); // shifted clock alone would have accepted
  });

  it("replay terms build only on chainId 31337 / 296 (D14); 295 mainnet, 297 previewnet and 1 are refused; live is unrestricted", () => {
    expect(REPLAY_CHAIN_IDS).to.deep.equal([31_337n, 296n]);
    const replay = kutchTerms("replay", 777);
    const live = kutchTerms("live", 0);
    const nowSec = Math.floor(bhuj().properties.time / 1000) + 10 * 365 * 86_400;
    const build = (terms: typeof live, chainId: bigint) => buildAttestation({ feature: bhuj(), terms, chainId, nonce: 1n, deadline: 2_000_000_000n, nowSec });
    for (const ok of [31_337n, 296n]) {
      expect(() => assertReplayAllowed(replay, ok)).to.not.throw();
      expect(build(replay, ok).termsHash).to.equal(termsHash(replay));
    }
    for (const bad of [295n, 297n, 1n]) {
      expect(() => assertReplayAllowed(replay, bad)).to.throw(`replay terms are not allowed on chainId ${bad}`);
      expect(() => build(replay, bad)).to.throw(/replay terms are not allowed/);
      expect(() => assertReplayAllowed(live, bad)).to.not.throw();
      expect(build(live, bad).termsHash).to.equal(termsHash(live));
    }
  });

  it("buildAttestation(Bhuj) fills every §6.1 field; a rejected record throws with its reason", () => {
    const t = kutchTerms("replay", 777);
    const now = observedAtOf(bhuj(), t) + t.coolingPeriodSec;
    const att = buildAttestation({ feature: bhuj(), terms: t, chainId: 296n, nonce: 1n, deadline: 2_000_000_000n, nowSec: now });
    expect(att).to.deep.equal({
      eventId: ethers.id("usp000a8ds"),
      lossBps: 7000n,
      magnitudeX100: 770n,
      observedAt: 980_479_777n,
      usgsUpdatedAt: 1_651_259_951n,
      nonce: 1n,
      termsHash: termsHash(t),
      dataHash: dataHash(bhuj()),
      deadline: 2_000_000_000n,
    });
    expect(Object.keys(att)).to.deep.equal(ATTESTATION_SPEC.types.Attestation.map((x) => x.name));
    expect(() => buildAttestation({ feature: with_(bhuj(), { status: "automatic" }), terms: t, chainId: 296n, nonce: 1n, deadline: 1n, nowSec: now })).to.throw("rejected: status");
  });

  // Pending: needs FaultlineTrigger and test/helpers/trigger.ts (Part 2). Port the reference body then.
  it("on chain: the signed digest == trigger.hashAttestation(att), and a trigger with these terms accepts the signature");
});
