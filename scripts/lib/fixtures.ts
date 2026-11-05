// Loads the saved USGS fixtures (oracle/fixtures). No network: the real Bhuj record was fetched once and saved
// (oracle/fixtures/README.md); the synthetic-kutch-* files are hand-written and labelled SYNTHETIC.
import fs from "node:fs";
import path from "node:path";
import type { UsgsFeature } from "../../shared/ts/attestation";

const DIR = path.join(__dirname, "..", "..", "oracle", "fixtures");

/** The real USGS detail record of the 2001 Bhuj earthquake (`usp000a8ds`). */
export const BHUJ_FILE = "real-usgs-usp000a8ds-detail.geojson";
/** SYNTHETIC M7.2 → 2000 bps (Flow B second event). */
export const SYNTH_72_FILE = "synthetic-kutch-1.geojson";
/** SYNTHETIC M7.5 → 5000 bps (Flow C). */
export const SYNTH_75_FILE = "synthetic-kutch-2.geojson";
/** SYNTHETIC M7.3 → 3000 bps (Flow C third event). */
export const SYNTH_73_FILE = "synthetic-kutch-3.geojson";

/** Reads one fixture; refuses a file whose name does not say real or synthetic. */
export function loadFeature(file: string): UsgsFeature {
  if (!/^(real-usgs-|synthetic-)/.test(file)) throw new Error(`fixture ${file} must be named real-usgs-* or synthetic-*`);
  const f = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as UsgsFeature;
  if (file.startsWith("synthetic-") && !f.id.startsWith("synthetic-")) throw new Error(`synthetic fixture ${file} has a non-synthetic id ${f.id}`);
  return f;
}
