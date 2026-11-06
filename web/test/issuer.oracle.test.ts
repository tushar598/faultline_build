// The oracle step box: the ops/ commands of ops/scripts/issuer/oracle-replay.ts for one issuer-page bond.
import { describe, expect, it } from "vitest";
import { deploymentId, type Deployment } from "@/lib/issuer/deployments";
import { SYNTHETIC_ORIGIN_SEC, entryFile, oracleSteps } from "@/lib/issuer/oracleSteps";
import { BHUJ_ORIGIN_SEC, bhujReplayOffset } from "@/lib/issuer/terms";
import { kutchTerms, termsHash } from "@/lib/shared";

const TRIGGER = "0x48910D43726D083021a795482a0e1bFFeFF1467E";
const riskStart = 1_793_971_324;
const replay = kutchTerms("replay", bhujReplayOffset(riskStart));
const dep = (over: Partial<Deployment> = {}): Deployment => ({
  id: deploymentId(296, TRIGGER), label: "FLKB 0x4891…467E", chainId: 296, trigger: TRIGGER, pool: "0x7e83a5AFe73C8c88e8463BAc37A28f4873Aa662e",
  bond: "0x72C422ED8F00537aeced760f0c7B840ee2Bbe836", stablecoin: "0x0000000000000000000000000000000000aCe152", topicId: "0.0.11339156",
  termsHash: termsHash(replay), terms: replay, schedule: { issuanceStart: riskStart - 1440, issuanceEnd: riskStart, riskStart, maturity: 1_793_973_664, grace: 60, challengeWindow: 120 },
  fromBlock: 42_738_633, createdAt: "2026-11-06T12:20:00.000Z", ...over,
});

describe("oracle step", () => {
  it("one entry file per trigger, under ops/out/issuer", () => {
    expect(entryFile(TRIGGER)).toBe("out/issuer/bond-48910d43.json");
    expect(entryFile(TRIGGER.toLowerCase())).toBe("out/issuer/bond-48910d43.json");
  });

  it("commands with this bond's file; EXECUTE only on the send lines", () => {
    const s = oracleSteps(dep());
    if (!s.ok) throw new Error(s.reason);
    expect(s.synthetic.dryRun).toBe("DEPLOYMENT=out/issuer/bond-48910d43.json EVENT=synthetic npm run ops:issuer:oracle");
    expect(s.synthetic.execute).toBe("DEPLOYMENT=out/issuer/bond-48910d43.json EXECUTE=1 EVENT=synthetic npm run ops:issuer:oracle");
    expect(s.bhuj.dryRun).toBe("DEPLOYMENT=out/issuer/bond-48910d43.json USGS_OFFLINE=1 npm run ops:issuer:oracle");
    expect(s.bhuj.execute).toBe("DEPLOYMENT=out/issuer/bond-48910d43.json EXECUTE=1 USGS_OFFLINE=1 npm run ops:issuer:oracle");
    expect(s.synthetic.dryRun + s.bhuj.dryRun).not.toContain("EXECUTE");
  });

  it("the save command writes the exact config entry to that file (quoted heredoc: nothing expands)", () => {
    const s = oracleSteps(dep());
    if (!s.ok) throw new Error(s.reason);
    const [head, ...rest] = s.save.split("\n");
    expect(head).toBe("mkdir -p ops/out/issuer && cat > ops/out/issuer/bond-48910d43.json <<'EOF'");
    expect(rest.at(-1)).toBe("EOF");
    const entry = JSON.parse(rest.slice(0, -1).join("\n"));
    expect(entry).toMatchObject({ chainId: 296, trigger: TRIGGER, topicId: "0.0.11339156", termsHash: termsHash(replay), fromBlock: 42_738_633 });
    expect(entry.terms).toEqual(replay);
  });

  it("times: Bhuj at riskStart + 60 s, SYNTHETIC 60 s later, deadline = maturity + grace", () => {
    const s = oracleSteps(dep());
    if (!s.ok) throw new Error(s.reason);
    expect(SYNTHETIC_ORIGIN_SEC - BHUJ_ORIGIN_SEC).toBe(60);
    expect(s.bhuj.observedAt).toBe(riskStart + 60);
    expect(s.synthetic.observedAt).toBe(riskStart + 120);
    expect(s.deadline).toBe(1_793_973_724);
  });

  it("no commands off testnet, without a topic, or for live terms", () => {
    expect(oracleSteps(dep({ chainId: 31337, id: deploymentId(31337, TRIGGER) })).ok).toBe(false);
    expect(oracleSteps(dep({ topicId: null })).ok).toBe(false);
    const live = kutchTerms("live", 0);
    const s = oracleSteps(dep({ terms: live, termsHash: termsHash(live) }));
    expect(s.ok).toBe(false);
  });
});
