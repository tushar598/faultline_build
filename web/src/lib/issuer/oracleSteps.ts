// The oracle step of a bond launched from the issuer page: the exact ops/ commands of ops/scripts/issuer/oracle-replay.ts
// for this bond, shown on the issuer page (step e) and on /trustee. A browser wallet cannot do this step: the oracle signs
// an EIP-712 attestation with its own key and the relayer publishes it to HCS (a native transaction) before trigger.submit.
// Only the holder of the bond's oracle key can send; anyone can read the commands and run the dry run.
import { getAddress } from "ethers";
import { BHUJ_ORIGIN_SEC } from "@/lib/issuer/terms";
import { configEntry, type Deployment } from "@/lib/issuer/deployments";

/** Origin time of the labelled SYNTHETIC fixture oracle/fixtures/synthetic-kutch-testnet-a.geojson (`time`
 *  980479060500 ms): Bhuj + 60 s. */
export const SYNTHETIC_ORIGIN_SEC = BHUJ_ORIGIN_SEC + 60;

export type OracleCommand = { dryRun: string; execute: string; observedAt: number };
export type OracleSteps =
  | { ok: true; file: string; save: string; synthetic: OracleCommand; bhuj: OracleCommand; deadline: number }
  | { ok: false; reason: string };

/** The entry file for this bond, relative to ops/ (the helper's DEPLOYMENT). One file per trigger, so a second bond
 *  never overwrites the first. */
export const entryFile = (trigger: string) => `out/issuer/bond-${getAddress(trigger).slice(2, 10).toLowerCase()}.json`;

/** The commands, from the repo root, or why there are none. The helper needs Hedera testnet, an HCS topic and replay
 *  terms (D10, D14). */
export function oracleSteps(d: Deployment): OracleSteps {
  if (d.chainId !== 296) return { ok: false, reason: "The oracle helper runs on Hedera testnet only. On the local network the e2e world and npm run demo drive the oracle." };
  if (!d.topicId) return { ok: false, reason: "This bond has no HCS topic yet: finish the topic step first." };
  if (d.terms.mode !== "replay") return { ok: false, reason: "This bond's terms are live: the oracle service watches USGS itself and there is no replay to run." };
  const file = entryFile(d.trigger);
  const save = `mkdir -p ops/out/issuer && cat > ops/${file} <<'EOF'\n${configEntry(d)}\nEOF`;
  const cmd = (env: string): { dryRun: string; execute: string } => ({
    dryRun: `DEPLOYMENT=${file}${env} npm run ops:issuer:oracle`,
    execute: `DEPLOYMENT=${file} EXECUTE=1${env} npm run ops:issuer:oracle`,
  });
  return {
    ok: true,
    file,
    save,
    synthetic: { ...cmd(" EVENT=synthetic"), observedAt: SYNTHETIC_ORIGIN_SEC + d.terms.timeOffsetSec },
    bhuj: { ...cmd(" USGS_OFFLINE=1"), observedAt: BHUJ_ORIGIN_SEC + d.terms.timeOffsetSec },
    // submissionDeadline before any pause: maturity + grace; each pause moves it later.
    deadline: d.schedule.maturity + d.schedule.grace,
  };
}
