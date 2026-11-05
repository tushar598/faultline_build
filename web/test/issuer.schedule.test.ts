// Issuer page step b: every constructor rule of FaultlinePool / FaultlineTrigger, the D17 bounds and requiredReserve.
import { describe, expect, it } from "vitest";
import { DAY, MAX_GRACE_SEC, MAX_WINDOW_SEC, atsBondDates, defaultScheduleDraft, scheduleWarnings, validateSchedule, type ScheduleDraft } from "@/lib/issuer/schedule";

const NOW = 1_800_000_000;
const ok = defaultScheduleDraft(NOW, "local");
const errs = (d: Partial<ScheduleDraft>) => {
  const r = validateSchedule({ ...ok, ...d });
  return r.ok ? {} : r.errors;
};

describe("issuer schedule validation", () => {
  it("the local default is valid: 1 day issuance, 365 days risk, 30 days grace, 48 h window, 6 %", () => {
    const r = validateSchedule(ok);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.maturity - r.value.riskStart).toBe(BigInt(365 * DAY));
    expect(r.value.cap).toBe(10_000_000_000n);
    expect(r.value.minTicket).toBe(100_000_000n);
    // 10,000 USD x 6 % x 1 year = 600 USD exactly
    expect(r.requiredReserve).toBe(600_000_000n);
  });

  it("the testnet default is valid and has a 120 s window", () => {
    const r = validateSchedule(defaultScheduleDraft(NOW, "testnet"));
    expect(r.ok && r.value.challengeWindow).toBe(120n);
  });

  it("issuanceStart < issuanceEnd <= riskStart < maturity, each edge", () => {
    expect(errs({ issuanceEnd: ok.issuanceStart }).issuanceEnd).toBeDefined();
    expect(errs({ riskStart: ok.issuanceEnd - 1 }).riskStart).toBeDefined();
    expect(errs({ riskStart: ok.issuanceEnd, maturity: ok.issuanceEnd + 1 })).toEqual({});
    expect(errs({ maturity: ok.riskStart }).maturity).toBeDefined();
  });

  it("0 < grace <= 365 days and 0 < window <= 30 days (D17), at the bounds", () => {
    expect(errs({ graceSec: 0 }).graceSec).toBeDefined();
    expect(errs({ graceSec: MAX_GRACE_SEC })).toEqual({});
    expect(errs({ graceSec: MAX_GRACE_SEC + 1 }).graceSec).toBeDefined();
    expect(errs({ challengeWindowSec: 0 }).challengeWindowSec).toBeDefined();
    expect(errs({ challengeWindowSec: MAX_WINDOW_SEC })).toEqual({});
    expect(errs({ challengeWindowSec: MAX_WINDOW_SEC + 1 }).challengeWindowSec).toBeDefined();
    expect(errs({ graceSec: NaN }).graceSec).toBeDefined();
  });

  it("couponBps, cap and minTicket must be above 0; 6 decimals at most; minTicket at most the cap", () => {
    expect(errs({ couponBps: "0" }).couponBps).toBeDefined();
    expect(errs({ couponBps: "65536" }).couponBps).toBeDefined();
    expect(errs({ couponBps: "6.5" }).couponBps).toBeDefined();
    expect(errs({ cap: "0" }).cap).toBeDefined();
    expect(errs({ cap: "1.0000001" }).cap).toBeDefined();
    expect(errs({ minTicket: "0" }).minTicket).toBeDefined();
    expect(errs({ minTicket: "10000.000001" }).minTicket).toMatch(/Above the cap/);
    expect(errs({ cap: "1,000.5", minTicket: "0.000001" })).toEqual({});
  });

  it("dates must be real and within 2000 to 2200 (SEC-22 stays far away)", () => {
    expect(errs({ issuanceStart: NaN }).issuanceStart).toBeDefined();
    expect(errs({ maturity: 7_258_118_401 }).maturity).toBeDefined();
  });

  it("requiredReserve rounds up like the contract", () => {
    const r = validateSchedule({ ...ok, cap: "0.000001", minTicket: "0.000001", couponBps: "1", maturity: ok.riskStart + 1 });
    expect(r.ok && r.requiredReserve).toBe(1n);
  });

  it("warns when issuance is open or closed at chain time, and on a short testnet window", () => {
    const r = validateSchedule(ok);
    if (!r.ok) throw new Error("default invalid");
    expect(scheduleWarnings(r.value, ok.issuanceStart + 1, "local")[0]).toMatch(/already open/);
    expect(scheduleWarnings(r.value, ok.issuanceEnd, "local")[0]).toMatch(/already closed/);
    const t = validateSchedule({ ...defaultScheduleDraft(NOW, "testnet"), challengeWindowSec: 60 });
    if (!t.ok) throw new Error("testnet invalid");
    expect(scheduleWarnings(t.value, NOW, "testnet").some((w) => /120 s/.test(w))).toBe(true);
  });

  it("ATS bond dates: start 2 min after deploy, mature at maturity + grace - 60; refuses a start after issuance opens", () => {
    const r = validateSchedule(defaultScheduleDraft(NOW, "testnet"));
    if (!r.ok) throw new Error("testnet invalid");
    const d = atsBondDates(r.value, NOW);
    expect(d.startingDate).toBe(NOW + 120);
    expect(BigInt(d.maturityDate)).toBe(r.value.maturity + r.value.grace - 60n);
    expect(d.problems).toEqual([]);
    expect(atsBondDates(r.value, Number(r.value.issuanceStart)).problems[0]).toMatch(/start after issuance/);
  });
});
