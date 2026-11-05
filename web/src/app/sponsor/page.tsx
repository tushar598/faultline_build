"use client";
import { useState } from "react";
import { ActionRow } from "@/components/bond/ActionRow";
import { ActivityTable } from "@/components/bond/ActivityTable";
import { PageHeading } from "@/components/bond/PageHeading";
import { PendingBanner } from "@/components/bond/PendingBanner";
import { SimulatedTimeNote } from "@/components/bond/SimulatedTimeNote";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { DataGate } from "@/components/shell/DataGate";
import { AmountInput } from "@/components/ui/AmountInput";
import { Card } from "@/components/ui/Card";
import { Hex } from "@/components/ui/Hex";
import { Note } from "@/components/ui/Notes";
import { Stat } from "@/components/ui/Stat";
import { Tag } from "@/components/ui/Tag";
import { hashscan } from "@/config/networks";
import { ERC20_ABI, POOL_ABI } from "@/lib/abi";
import { eventInfos, eventNames } from "@/lib/eventInfo";
import { formatAmount, formatBps, formatUsd, parseUsd } from "@/lib/format";
import { canClaim, canFundCoupons, canSweep } from "@/lib/guards";
import { chainNowAt, useData, useNow, type DashboardData } from "@/state/data";
import { useNetwork } from "@/state/network";
import { useWalletGuard } from "@/state/useWalletGuard";
import { useWallet, type TxStep } from "@/state/wallet";

const usd = (v: bigint) => formatAmount(v);
const SPONSOR_EVENTS = new Set(["CouponsFunded", "LossApplied", "ExcessSwept", "DustSwept"]);

function Sponsor({ d }: { d: DashboardData }) {
  const { state } = useNetwork();
  const { refresh } = useData();
  const { run } = useWallet();
  const { w, busy } = useWalletGuard();
  const now = useNow();
  const [amount, setAmount] = useState("");
  const s = d.snapshot;
  const a = d.account;
  const chainNow = chainNowAt(s, now);
  const value = amount ? parseUsd(amount) : null;
  const sponsorClaimable = a?.isSponsor ? a.claimable : null;
  const covered = s.books.couponReserve >= s.books.requiredReserveForCap;
  const names = eventNames(eventInfos(d.events, d.logs, d.hcs));
  if (state.status !== "ready") return null;

  const fund = () => {
    if (!a || value === null) return;
    const steps: TxStep[] = [];
    if (a.allowance < value) steps.push({ label: "Approve stablecoin", address: s.addresses.stablecoin, abi: [...ERC20_ABI], method: "approve", args: [s.addresses.pool, value] });
    steps.push({ label: "Fund coupons", address: s.addresses.pool, abi: [...POOL_ABI], method: "fundCoupons", args: [value] });
    void run(steps.length > 1 ? "Approve and fund coupons" : "Fund coupons", steps, refresh).then((ok) => ok && setAmount(""));
  };
  const one = (label: string, method: string) => void run(label, [{ label, address: s.addresses.pool, abi: [...POOL_ABI], method, args: [] }], refresh);

  return (
    <>
      <PageHeading title="Sponsor">The insured party pre-funds the coupon reserve and receives the matching collateral when a write-down executes. Payouts are pulled with claim().</PageHeading>
      <PendingBanner d={d} />
      {a && !a.isSponsor && (
        <div className="mb-5">
          <Note tone="info" title="The connected wallet is not the sponsor">
            Sponsor actions need {s.addresses.sponsor}. The figures below are read-only.
          </Note>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Coupon reserve" action={<Tag tone={covered ? "success" : "warning"}>{covered ? "Covers the full cap" : "Below the full-cap requirement"}</Tag>}>
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Funded" value={<AnimatedNumber value={s.books.couponReserve} format={usd} />} unit="USD" />
            <Stat label="Left" value={<AnimatedNumber value={s.books.couponReserveLeft} format={usd} />} unit="USD" hint={`Paid to holders ${formatUsd(s.books.couponPaid)}`} />
            <Stat label="Needed for the full cap" value={formatAmount(s.books.requiredReserveForCap)} unit="USD" hint={`${formatBps(s.terms.couponBps)} a year over the risk period`} />
            <Stat label="Units issued" value={formatAmount(s.books.unitsIssued)} unit="units" />
          </div>
        </Card>
        <Card title="Collateral credited">
          <div className="grid grid-cols-2 gap-5">
            <Stat label="Sponsor credited" value={<AnimatedNumber value={s.books.sponsorCredited} format={usd} />} unit="USD" emphasis hint="floor(units issued x L / 10,000)" />
            <Stat label="Loss index" value={formatBps(s.books.appliedLossBps)} hint={`${(s.books.appliedLossBps / 100).toFixed(2)}% of principal`} />
            <Stat label="Sponsor claimable" value={sponsorClaimable === null ? "Connect the sponsor wallet" : <AnimatedNumber value={sponsorClaimable} format={usd} />} unit={sponsorClaimable === null ? undefined : "USD"} />
            <div>
              <div className="text-xs font-medium text-neutral-700">Sponsor address</div>
              <div className="mt-1">
                <Hex value={s.addresses.sponsor} href={hashscan(state.net, "account", s.addresses.sponsor)} />
              </div>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Actions" className="mt-5">
        <div className="divide-y divide-neutral-100">
          <ActionRow title="Fund coupons" description="Add stablecoin to the coupon reserve. Allowed for the sponsor before issuance closes; investors can subscribe only while the reserve covers the full term." guard={canFundCoupons(s, a, w, value, chainNow)} busy={busy} onRun={fund} label="Fund coupons">
            <AmountInput id="fund-amount" label="Amount" value={amount} onChange={setAmount} />
          </ActionRow>
          <ActionRow title="Claim" description="Withdraw write-down collateral, unused reserve and dust credited to the sponsor." guard={a && !a.isSponsor ? { ok: false, reason: "Connect the sponsor wallet." } : canClaim(a, w)} busy={busy} onRun={() => one("Claim", "claim")} label="Claim" />
          <ActionRow title="Sweep excess" description="Credit the sponsor with everything not owed to holders or claimants. Anyone can call it once redemption is open." guard={canSweep(s, w, a, chainNow, false)} busy={busy} onRun={() => one("Sweep excess", "sweepExcess")} label="Sweep excess" variant="secondary" />
          <ActionRow title="Sweep dust" description="Final cleanup after every unit is redeemed: the rounding dust goes to the sponsor." guard={canSweep(s, w, a, chainNow, true)} busy={busy} onRun={() => one("Sweep dust", "sweepDust")} label="Sweep dust" variant="secondary" />
        </div>
      </Card>
      <Card title="Sponsor activity" className="mt-5">
        <SimulatedTimeNote className="mb-3" />
        <ActivityTable logs={d.logs} net={state.net} names={names} filter={(l) => SPONSOR_EVENTS.has(l.name) || (l.name === "Claimed" && String(l.args.account).toLowerCase() === s.addresses.sponsor.toLowerCase())} />
      </Card>
    </>
  );
}

export default function SponsorPage() {
  return <DataGate>{(d) => <Sponsor d={d} />}</DataGate>;
}
