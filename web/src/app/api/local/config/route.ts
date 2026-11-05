// LOCAL ONLY: the addresses of the bond `npm run deploy:local` (or the dashboard demo script) last deployed, read from
// oracle/config.local.json, plus the terms file behind its termsHash. Both files are public data (no keys).
import path from "node:path";
import { connection } from "next/server";
import { ORACLE_DIR, localApiDisabled, localApiEnabled, readJson } from "@/lib/server/repo";
import type { Terms } from "@/lib/shared";

type OracleLocalConfig = { rpcUrl: string; chainId: number; trigger: string; termsFile: string; hcs: { mode: string; topicId: string }; fromBlock?: number };

export async function GET() {
  await connection();
  if (!localApiEnabled()) return localApiDisabled();
  const cfg = await readJson<OracleLocalConfig>(path.join(ORACLE_DIR, "config.local.json"));
  if (!cfg) return Response.json({ error: "No local deployment found (oracle/config.local.json). Run `npm run deploy:local` against a Hardhat node." }, { status: 404 });
  if (cfg.chainId !== 31337) return Response.json({ error: `oracle/config.local.json is for chainId ${cfg.chainId}, not the local chain 31337.` }, { status: 409 });
  const terms = /^[\w./-]+\.json$/.test(cfg.termsFile) && !cfg.termsFile.includes("..") ? await readJson<Terms>(path.join(ORACLE_DIR, cfg.termsFile)) : null;
  return Response.json({ rpcUrl: cfg.rpcUrl, chainId: cfg.chainId, trigger: cfg.trigger, topicId: cfg.hcs.mode === "mock" ? cfg.hcs.topicId : null, fromBlock: cfg.fromBlock ?? 0, terms });
}
