// Pure attestation helpers shared by the Hardhat tests/scripts (CommonJS) and the oracle (ESM): trigger terms and
// termsHash (ARCHITECTURE §6.3, §12.1 D13), dataHash (§6.4), magnitude and payout curve (§6.2), the acceptance rule
// (§6.2), replay times (D10), and building + signing the EIP-712 attestation (§6.1) with the domain and types from
// shared/attestation.eip712.json. Only dependency: ethers.
import { TypedDataEncoder, keccak256, toUtf8Bytes, type Signer } from "ethers";
import spec from "../attestation.eip712.json";
import { canonicalize } from "./jcs";

// ---------------------------------------------------------------- EIP-712 (shared/attestation.eip712.json)

/** Name and version of the trigger's EIP-712 domain. */
export const ATTESTATION_DOMAIN: { name: string; version: string } = spec.domain;
/** `types` for ethers `signTypedData` / `TypedDataEncoder` (no EIP712Domain entry). */
export const ATTESTATION_TYPES: Record<string, { name: string; type: string }[]> = { Attestation: spec.types.Attestation };

/** Full domain of one trigger instance. */
export function attestationDomain(chainId: bigint, verifyingContract: string) {
  return { ...ATTESTATION_DOMAIN, chainId, verifyingContract };
}

/** The struct the oracle signs (field names, types and order of §6.1). */
export type Attestation = {
  eventId: string;
  lossBps: bigint;
  magnitudeX100: bigint;
  observedAt: bigint;
  usgsUpdatedAt: bigint;
  nonce: bigint;
  termsHash: string;
  dataHash: string;
  deadline: bigint;
};

// ---------------------------------------------------------------- terms (§6.3, D13)

/** Trigger terms; every field goes into `termsHash`. */
export type Terms = {
  version: number;
  box: { minLat: number; maxLat: number; minLon: number; maxLon: number };
  maxDepthKm: number;
  magTypes: string[];
  floorMagX100: number;
  ceilMagX100: number;
  coolingPeriodSec: number;
  aggregation: "sum-capped-10000";
  mode: "live" | "replay";
  timeOffsetSec: number;
  source: "USGS ComCat";
};

/** D13 terms (ARCHITECTURE §12.1): Kutch box, 70 km, mww/mwc/mwb/mwr/mw, 7.0 → 8.0, 6 h cooling. */
export function kutchTerms(mode: Terms["mode"], timeOffsetSec: number): Terms {
  if (mode === "live" && timeOffsetSec !== 0) throw new Error("live terms must have timeOffsetSec 0");
  if (!Number.isSafeInteger(timeOffsetSec)) throw new Error("timeOffsetSec must be a safe integer");
  return {
    version: 1,
    box: { minLat: 22.5, maxLat: 24.5, minLon: 68.5, maxLon: 71.5 },
    maxDepthKm: 70,
    magTypes: ["mww", "mwc", "mwb", "mwr", "mw"],
    floorMagX100: 700,
    ceilMagX100: 800,
    coolingPeriodSec: 21_600,
    aggregation: "sum-capped-10000",
    mode,
    timeOffsetSec,
    source: "USGS ComCat",
  };
}

/** keccak256(utf8(JCS(terms))). */
export function termsHash(terms: Terms): string {
  return keccak256(toUtf8Bytes(canonicalize(terms)));
}

/** D14: the only chains where replay terms may be signed or deployed: 31337 (Hardhat) and 296 (Hedera testnet).
 *  An OFF-CHAIN guard: on chain the mode is only visible through `termsHash`. */
export const REPLAY_CHAIN_IDS: readonly bigint[] = [31_337n, 296n];

/** Throws unless live terms, or replay terms on a chain in `REPLAY_CHAIN_IDS` (D14). Used by `buildAttestation`
 *  and by every script that deploys a trigger. */
export function assertReplayAllowed(terms: Terms, chainId: bigint): void {
  if (terms.mode === "replay" && !REPLAY_CHAIN_IDS.includes(chainId)) {
    throw new Error(`replay terms are not allowed on chainId ${chainId} (allowed: ${REPLAY_CHAIN_IDS.join(", ")})`);
  }
}

// ---------------------------------------------------------------- USGS record (§6.4)

/** The parts of a USGS GeoJSON Feature (event detail) that Faultline reads. */
export type UsgsFeature = {
  id: string;
  properties: {
    time: number;
    updated: number;
    mag: number;
    magType: string;
    status: string;
    type: string;
    ids: string;
    net: string;
    code: string;
    [k: string]: unknown;
  };
  geometry: { type: string; coordinates: [number, number, number] };
  [k: string]: unknown;
};

/** The §6.4 subset, keeping the USGS nesting: `id`, `properties.{time, updated, mag, magType, status, type, ids,
 *  net, code}`, `geometry.coordinates`. Volatile fields (felt, cdi, sig, url, detail, …) are left out. */
export function dataSubset(f: UsgsFeature) {
  const p = f.properties;
  return {
    id: f.id,
    properties: { time: p.time, updated: p.updated, mag: p.mag, magType: p.magType, status: p.status, type: p.type, ids: p.ids, net: p.net, code: p.code },
    geometry: { coordinates: f.geometry.coordinates },
  };
}

/** keccak256(utf8(JCS(dataSubset(feature)))). */
export function dataHash(f: UsgsFeature): string {
  return keccak256(toUtf8Bytes(canonicalize(dataSubset(f))));
}

/** keccak256(utf8(USGS preferred event id)) (§6.1). */
export function eventIdOf(usgsId: string): string {
  return keccak256(toUtf8Bytes(usgsId));
}

// ---------------------------------------------------------------- magnitude and payout (§6.2)

/** `Math.round(mag * 100)`: USGS `mag` is a float, e.g. `8.03 * 100` is `802.9999999999999` in JS. */
export function magnitudeX100(mag: number): number {
  if (!Number.isFinite(mag) || mag < 0) throw new Error(`bad magnitude ${mag}`);
  return Math.round(mag * 100);
}

/** Linear curve in integer maths: 0 at or below `floorMagX100` (no event), 10000 from `ceilMagX100` up, floor in
 *  between. D13: `min(10000, floor((m - 700) * 10000 / 100))`; Bhuj 770 → 7000. */
export function lossBpsFor(magX100: number, terms: Terms): number {
  if (!Number.isInteger(magX100)) throw new Error(`magX100 must be an integer, got ${magX100}`);
  if (magX100 <= terms.floorMagX100) return 0;
  return Math.min(10_000, Math.floor(((magX100 - terms.floorMagX100) * 10_000) / (terms.ceilMagX100 - terms.floorMagX100)));
}

// ---------------------------------------------------------------- times (D10)

/** `floor(time / 1000) + timeOffsetSec` (0 offset for live terms). */
export const observedAtOf = (f: UsgsFeature, terms: Terms): number => Math.floor(f.properties.time / 1000) + terms.timeOffsetSec;
/** `floor(updated / 1000) + timeOffsetSec`. */
export const usgsUpdatedAtOf = (f: UsgsFeature, terms: Terms): number => Math.floor(f.properties.updated / 1000) + terms.timeOffsetSec;

// ---------------------------------------------------------------- acceptance rule (§6.2)

export type Rejection = "status" | "type" | "magType" | "box" | "depth" | "cooling" | "belowFloor";

/**
 * §6.2: `reviewed`, `earthquake`, magType in the terms list, epicentre inside the box (inclusive), depth <=
 * maxDepthKm, the cooling period has passed, and a magnitude above the curve floor. The USGS-ids ledger (D8) is the
 * oracle's job, not this function's.
 *
 * `nowSec` is the real clock (chain time). Cooling (D14): live mode `nowSec - observedAt >= coolingPeriodSec`;
 * replay mode measures the age of the real USGS origin time, `nowSec - floor(time / 1000) >= coolingPeriodSec`, not
 * of the shifted `observedAt` (which sits in the bond's risk period, so a shifted clock would hold a testnet replay
 * for 6 h). A replayed event is decades old, so the demo never exercises the cooling period.
 */
export function checkAcceptance(f: UsgsFeature, terms: Terms, nowSec: number): { ok: true } | { ok: false; reason: Rejection } {
  const p = f.properties;
  const [lon, lat, depthKm] = f.geometry.coordinates;
  if (p.status !== "reviewed") return { ok: false, reason: "status" };
  if (p.type !== "earthquake") return { ok: false, reason: "type" };
  if (!terms.magTypes.includes(p.magType)) return { ok: false, reason: "magType" };
  const b = terms.box;
  if (lat < b.minLat || lat > b.maxLat || lon < b.minLon || lon > b.maxLon) return { ok: false, reason: "box" };
  if (depthKm > terms.maxDepthKm) return { ok: false, reason: "depth" };
  const originSec = terms.mode === "replay" ? Math.floor(p.time / 1000) : observedAtOf(f, terms);
  if (nowSec - originSec < terms.coolingPeriodSec) return { ok: false, reason: "cooling" };
  if (lossBpsFor(magnitudeX100(p.mag), terms) === 0) return { ok: false, reason: "belowFloor" };
  return { ok: true };
}

// ---------------------------------------------------------------- build and sign (§6.1)

/** Builds the attestation for an accepted event on `chainId`; throws `rejected: <reason>` otherwise, and refuses
 *  replay terms outside `REPLAY_CHAIN_IDS` (D14). */
export function buildAttestation(args: { feature: UsgsFeature; terms: Terms; chainId: bigint; nonce: bigint; deadline: bigint; nowSec: number }): Attestation {
  const { feature, terms } = args;
  assertReplayAllowed(terms, args.chainId);
  const verdict = checkAcceptance(feature, terms, args.nowSec);
  if (!verdict.ok) throw new Error(`rejected: ${verdict.reason}`);
  const mag = magnitudeX100(feature.properties.mag);
  return {
    eventId: eventIdOf(feature.id),
    lossBps: BigInt(lossBpsFor(mag, terms)),
    magnitudeX100: BigInt(mag),
    observedAt: BigInt(observedAtOf(feature, terms)),
    usgsUpdatedAt: BigInt(usgsUpdatedAtOf(feature, terms)),
    nonce: args.nonce,
    termsHash: termsHash(terms),
    dataHash: dataHash(feature),
    deadline: args.deadline,
  };
}

/** EIP-712 digest the trigger's `hashAttestation(att)` must return. */
export function attestationDigest(att: Attestation, chainId: bigint, verifyingContract: string): string {
  return TypedDataEncoder.hash(attestationDomain(chainId, verifyingContract), ATTESTATION_TYPES, att);
}

/** EIP-712 signature by `signer` (the oracle key) for one trigger on one chain. */
export function signAttestation(signer: Signer, att: Attestation, chainId: bigint, verifyingContract: string): Promise<string> {
  return signer.signTypedData(attestationDomain(chainId, verifyingContract), ATTESTATION_TYPES, att);
}
