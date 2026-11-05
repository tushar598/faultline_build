// Faultline oracle CLI (run from oracle/: `npm run <command> -- …`, or `npx tsx src/cli.ts <command> …`).
//   verify-config                                  refusal gate only: chainId, termsHash, type hash, D14, oracle key
//   replay --usgs-event <id> [--offline]           one record through the full pipeline (replay terms only, D10/D14);
//   replay --fixture <file>                        --offline reads fixtures/real-usgs-<id>-detail.geojson; --fixture
//                                                  reads fixtures/<file> (real-usgs-* or SYNTHETIC synthetic-* only)
//   watch [--once]                                 box search every pollIntervalSec + pending re-check every pendingPollSec
//   keeper [--once]                                execute every pending event whose window is complete
//   status <eventId | usgsId>                      chain record + ledger entry
// Global: --config <file> (default $ORACLE_CONFIG, else ./config.local.json). Keys: see src/keys.ts (env only).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { eventIdOf } from "../../shared/ts/attestation.js";
import { chainFacts, chainTime, eventRecord, linkText, provider as makeProvider, triggerAt } from "./chain.js";
import { checkStartup, loadConfig, resolveIn, type Config } from "./config.js";
import { MockHcs, realHcs, type HcsPublisher } from "./hcs.js";
import { hederaEvmSender, type EvmSender } from "./hederaEvm.js";
import { walletFor } from "./keys.js";
import { keeperOnce } from "./keeper.js";
import { Ledger } from "./ledger.js";
import { log } from "./log.js";
import { Oracle, loop, type Outcome } from "./service.js";
import { UsgsClient, parseFeature, type DetailResult } from "./usgs.js";

const FIXTURES = path.resolve(import.meta.dirname, "..", "fixtures");

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    "usgs-event": { type: "string" },
    offline: { type: "boolean", default: false },
    fixture: { type: "string" },
    once: { type: "boolean", default: false },
  },
});
const command = positionals[0];
const configPath = opts.config ?? process.env.ORACLE_CONFIG ?? "config.local.json";

async function open(needs: { signer: boolean; relayer: boolean }) {
  const cfg = loadConfig(configPath);
  const p = makeProvider(cfg.rpcUrl, cfg.chainId);
  const facts = await chainFacts(p, cfg.trigger);
  const signer = needs.signer ? walletFor("oracle", facts.chainId) : undefined;
  checkStartup(cfg, facts, signer?.address);
  const relayer = needs.relayer ? walletFor("relayer", facts.chainId).connect(p) : undefined;
  const trigger = triggerAt(cfg.trigger, p);
  const ledger = new Ledger(resolveIn(cfg, cfg.stateDir), facts.chainId, cfg.trigger);
  const evm: EvmSender | undefined =
    relayer && cfg.evm.transport === "hedera-sdk" ? await hederaEvmSender({ network: cfg.evm.network, payerAccountId: cfg.evm.payerAccountId, wallet: relayer, provider: p, chainId: facts.chainId }) : undefined;
  log.info("config verified", {
    chainId: facts.chainId,
    trigger: cfg.trigger,
    termsHash: cfg.termsHash,
    mode: cfg.terms.mode,
    timeOffsetSec: cfg.terms.timeOffsetSec,
    hcs: `${cfg.hcs.mode}:${cfg.hcs.topicId}`,
    oracle: signer?.address ?? "(not loaded)",
    relayer: relayer?.address ?? "(not loaded)",
    evmTransport: cfg.evm.transport,
  });
  return { cfg, p, facts, signer, relayer, trigger, ledger, evm };
}

async function hcsFor(cfg: Config, signerKey?: string, relayerKey?: string): Promise<HcsPublisher> {
  if (cfg.hcs.mode === "mock") return new MockHcs(cfg.hcs.topicId, resolveIn(cfg, cfg.hcs.mockDir));
  if (!signerKey || !relayerKey) throw new Error("real HCS needs the oracle (submit key) and the relayer (payer) keys");
  return realHcs({ topicId: cfg.hcs.topicId, network: cfg.hcs.network, payerAccountId: cfg.hcs.payerAccountId, payerKeyHex: relayerKey, submitKeyHex: signerKey });
}

async function oracleFor() {
  const o = await open({ signer: true, relayer: true });
  const hcs = await hcsFor(o.cfg, o.signer!.privateKey, o.relayer!.privateKey);
  const [riskStart, maturity] = (await Promise.all([o.trigger.getFunction("riskStart")(), o.trigger.getFunction("maturity")()])).map(Number) as [number, number];
  const usgs = new UsgsClient(o.cfg.usgs);
  const oracle = new Oracle({
    chainId: o.facts.chainId,
    provider: o.p,
    triggerAddress: o.cfg.trigger,
    trigger: o.trigger,
    triggerAsRelayer: triggerAt(o.cfg.trigger, o.relayer!),
    evm: o.evm,
    signer: o.signer!,
    terms: o.cfg.terms,
    ledger: o.ledger,
    hcs,
    usgs,
    attestationTtlSec: o.cfg.attestationTtlSec,
    risk: { riskStart, maturity },
  });
  return { ...o, oracle, usgs, hcs };
}

function printOutcome(chainId: bigint, r: Outcome): void {
  console.log(`\n${r.usgsId} → ${r.decision}: ${r.detail}`);
  if (r.eventId) console.log(`  eventId ${r.eventId}`);
  if (r.hcsSeq) console.log(`  HCS sequence ${r.hcsSeq}`);
  if (r.txHash) console.log(`  tx ${r.txHash} ${linkText(chainId, r.txHash)}`);
}

function readFixture(file: string): DetailResult {
  if (!/^(real-usgs-|synthetic-)[\w.-]+\.geojson$/.test(file)) throw new Error(`fixture ${file} must be named real-usgs-*.geojson or synthetic-*.geojson`);
  const json = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), "utf8")) as { id?: string };
  if (file.startsWith("synthetic-")) {
    if (!String(json.id).startsWith("synthetic-")) throw new Error(`synthetic fixture ${file} has a non-synthetic id`);
    log.warn(`using a SYNTHETIC record (${file}) — not a real USGS event`);
  }
  return { kind: "ok", feature: parseFeature(json) };
}

async function main(): Promise<number> {
  switch (command) {
    case "verify-config": {
      const o = await open({ signer: Boolean(process.env.ORACLE_PRIVATE_KEY ?? process.env.HARDHAT_ACCOUNT_ORACLE), relayer: false });
      console.log(`OK: chainId ${o.facts.chainId}, trigger ${o.cfg.trigger}, oracle on chain ${o.facts.oracle}, termsHash ${o.cfg.termsHash} (${o.cfg.terms.mode}${o.cfg.terms.mode === "replay" ? `, offset ${o.cfg.terms.timeOffsetSec} s` : ""})`);
      return 0;
    }
    case "replay": {
      const o = await oracleFor();
      if (o.cfg.terms.mode !== "replay") throw new Error("replay needs replay terms (D10); this bond's terms are live");
      let usgsId: string;
      let res: DetailResult;
      if (opts.fixture) {
        res = readFixture(opts.fixture);
        usgsId = res.kind === "ok" ? res.feature.id : opts.fixture;
      } else {
        usgsId = opts["usgs-event"] ?? "";
        if (!usgsId) throw new Error("replay needs --usgs-event <id> or --fixture <file>");
        res = opts.offline ? readFixture(`real-usgs-${usgsId}-detail.geojson`) : await o.usgs.detail(usgsId);
      }
      const r = await o.oracle.process(usgsId, res);
      printOutcome(o.facts.chainId, r);
      return r.decision === "error" || r.decision === "conflict" ? 1 : 0;
    }
    case "watch": {
      const o = await oracleFor();
      if (opts.once) {
        for (const r of [...(await o.oracle.pendingOnce()), ...(await o.oracle.searchOnce())]) printOutcome(o.facts.chainId, r);
        return 0;
      }
      const ctl = new AbortController();
      process.once("SIGINT", () => {
        log.info("SIGINT: finishing the current step, then stopping");
        ctl.abort();
      });
      await loop(
        [
          { name: "pending re-check (D15)", everySec: o.cfg.pendingPollSec, run: () => o.oracle.pendingOnce() },
          { name: "box search", everySec: o.cfg.pollIntervalSec, run: () => o.oracle.searchOnce() },
        ],
        ctl.signal,
      );
      log.info("stopped cleanly");
      return 0;
    }
    case "keeper": {
      const o = await open({ signer: false, relayer: true });
      const run = () => keeperOnce({ chainId: o.facts.chainId, provider: o.p, trigger: o.trigger, triggerAsRelayer: triggerAt(o.cfg.trigger, o.relayer!), fromBlock: o.cfg.fromBlock, ledger: o.ledger, evm: o.evm });
      if (opts.once) {
        const out = await run();
        for (const r of out) console.log(`\nexecute ${r.eventId}: ${r.outcome} → ${r.status}${r.txHash ? `\n  ${linkText(o.facts.chainId, r.txHash)}` : ""}`);
        if (!out.length) console.log("\nkeeper: nothing to execute");
        return out.some((r) => !r.outcome.startsWith("mined")) ? 1 : 0;
      }
      const ctl = new AbortController();
      process.once("SIGINT", () => ctl.abort());
      await loop([{ name: "keeper", everySec: o.cfg.pendingPollSec, run }], ctl.signal);
      return 0;
    }
    case "status": {
      const o = await open({ signer: false, relayer: false });
      const q = positionals[1];
      if (!q) throw new Error("status needs <eventId | usgsId>");
      const look = q.startsWith("0x") && q.length === 66 ? undefined : o.ledger.lookup([q]);
      const eventId = q.startsWith("0x") && q.length === 66 ? q : look?.kind === "known" ? look.eventId : eventIdOf(q);
      const rec = await eventRecord(o.trigger, eventId);
      const entry = o.ledger.get(eventId);
      if (entry && (entry.chainStatus !== rec.status || entry.chainNonce !== rec.nonce)) {
        o.ledger.update(eventId, (e) => {
          e.chainStatus = rec.status;
          e.chainNonce = rec.nonce;
        });
      }
      const now = await chainTime(o.p);
      console.log(JSON.stringify({ eventId, chain: { ...rec, windowRemaining: Number(await o.trigger.getFunction("windowRemaining")(eventId)), chainTime: now }, ledger: o.ledger.get(eventId) ?? null }, null, 2));
      return 0;
    }
    default:
      console.error("usage: cli.ts <verify-config | replay | watch | keeper | status> [--config file] …  (see the header of src/cli.ts)");
      return 2;
  }
}

main().then(
  (code) => process.exit(code),
  (e: Error) => {
    log.error(e.message);
    process.exit(1);
  },
);
