// Pure attestation helpers shared by the Hardhat tests/scripts (CommonJS) and the oracle (ESM).
// This step: trigger terms and termsHash (ARCHITECTURE §6.3, §12.1 D13) and the replay chain guard (D14).
// Only dependency: ethers.
import { keccak256, toUtf8Bytes } from "ethers";
import { canonicalize } from "./jcs";

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
