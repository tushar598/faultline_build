"use client";
import { useState } from "react";
import { ActionRow } from "@/components/bond/ActionRow";
import { HoldersTable } from "@/components/bond/HoldersTable";
import { PageHeading } from "@/components/bond/PageHeading";
import { PendingBanner } from "@/components/bond/PendingBanner";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { DataGate } from "@/components/shell/DataGate";
import { AmountInput } from "@/components/ui/AmountInput";
import { Card } from "@/components/ui/Card";
import { EmptyState, Note } from "@/components/ui/Notes";
import { Stat } from "@/components/ui/Stat";
import { Tag } from "@/components/ui/Tag";
import { ERC20_ABI, POOL_ABI } from "@/lib/abi";
import { formatAmount, formatBps, formatUsd, parseUsd } from "@/lib/format";
import { canClaim, canInvest, canRedeem } from "@/lib/guards";
import type { AccountSnapshot } from "@/lib/types";
import { chainNowAt, useData, useNow, type DashboardData } from "@/state/data";
import { useWalletGuard } from "@/state/useWalletGuard";
import { useWallet, type TxStep } from "@/state/wallet";

const usd = (v: bigint) => formatAmount(v);

function KycTag({ label, ok }: { label: string; ok: boolean | null }) {
  if (ok === null) return <Tag tone="neutral">{label}: unknown</Tag>;
  return <Tag tone={ok ? "success" : "error"}>{`${label}: ${ok ? "granted" : "not granted"}`}</Tag>;
}

function Position({ a, lossBps }: { a: AccountSnapshot; lossBps: number }) {
  return (
    <>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-4">
          <Stat label="ATS balance" value={formatAmount(a.bondBalance)} unit="units" emphasis hint="What the ATS bond token reports. It does not change at a write-down." />
        </div>
        <div className="rounded-md border border-accent-100 bg-accent-50 p-4">
          <Stat label="Effective value" value={<AnimatedNumber value={a.principal + a.coupon} format={usd} />} unit="USD" emphasis hint={`Principal ${formatUsd(a.principal)} + accrued coupon ${formatUsd(a.coupon)} at L = ${formatBps(lossBps)}`} />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Claimable" value={<AnimatedNumber value={a.claimable} format={usd} />} unit="USD" />
        <Stat label="Stablecoin balance" value={formatAmount(a.stableBalance)} unit="USD" />
        <Stat label="Allowance to pool" value={formatAmount(a.allowance)} unit="USD" />
        <div>
          <div className="text-xs font-medium text-neutral-700">KYC</div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <KycTag label="Bond" ok={a.bondKyc} />
            <KycTag label="Stablecoin" ok={a.stableKyc} />
          </div>
        </div>
      </div>
    </>
  );
}

function Investor({ d }: { d: DashboardData }) {
  const { refresh } = useData();
  const { run } = useWallet();
  const { w, busy } = useWalletGuard();
  const now = useNow();
  const [amount, setAmount] = useState("");
  const s = d.snapshot;
  const a = d.account;
  const chainNow = chainNowAt(s, now);
  const units = amount ? parseUsd(amount) : null;
  const invest = canInvest(s, a, w, units, chainNow);
  const redeem = canRedeem(s, a, w, chainNow);
  const claim = canClaim(a, w);

  const doInvest = () => {
    if (!a || units === null) return;
    const steps: TxStep[] = [];
    if (a.allowance < units) steps.push({ label: "Approve stablecoin", address: s.addresses.stablecoin, abi: [...ERC20_ABI], method: "approve", args: [s.addresses.pool, units] });
    steps.push({ label: "Invest", address: s.addresses.pool, abi: [...POOL_ABI], method: "invest", args: [units] });
    void run(steps.length > 1 ? "Approve and invest" : "Invest", steps, refresh).then((ok) => ok && setAmount(""));
  };
  const one = (label: string, method: string) => void run(label, [{ label, address: s.addresses.pool, abi: [...POOL_ABI], method, args: [] }], refresh);

  return (
    <>
      <PageHeading title="Investor">Your units, what they are worth after any write-down, and the actions open to you now. Every transaction is signed in your wallet.</PageHeading>
      <PendingBanner d={d} />
      <Card title="Your position" subtitle={a ? a.address : "No wallet connected"}>
        {a ? <Position a={a} lossBps={s.books.appliedLossBps} /> : <EmptyState title="No wallet connected">Sign in with a wallet to see its units, effective value and claimable balance.</EmptyState>}
        {s.books.appliedLossBps > 0 && (
          <div className="mt-4">
            <Note tone="info" title="Why the two numbers differ">
              The loss index is {formatBps(s.books.appliedLossBps, true)}. The pool writes down principal through this one index instead of burning units, so the ATS balance stays the same and each unit is worth less. Units are burned only when you redeem.
            </Note>
          </div>
        )}
      </Card>
      <Card title="Actions" className="mt-5">
        <div className="divide-y divide-neutral-100">
          <ActionRow
            title="Invest"
            description={`Pay stablecoin into the pool and receive bond units one to one. Minimum ${formatUsd(s.terms.minTicket)}; open during the issuance window only.`}
            guard={invest}
            busy={busy}
            onRun={doInvest}
            label={a && units !== null && a.allowance < units ? "Approve and invest" : "Invest"}
          >
            <AmountInput id="invest-amount" label="Amount" value={amount} onChange={setAmount} />
          </ActionRow>
          <ActionRow title="Redeem" description="Burn all your units and get principal at the current loss index plus your accrued coupon credited as claimable." guard={redeem} busy={busy} onRun={() => one("Redeem", "redeem")} label="Redeem all units" />
          <ActionRow title="Claim" description="Withdraw your claimable balance to your wallet." guard={claim} busy={busy} onRun={() => one("Claim", "claim")} label={a && a.claimable > 0n ? `Claim ${formatUsd(a.claimable)}` : "Claim"} />
        </div>
      </Card>
      <Card title="All holders" subtitle="Every address that received units, read from Invested and bond Transfer events" className="mt-5">
        <HoldersTable rows={d.holders} highlight={a?.address} lossBps={s.books.appliedLossBps} />
      </Card>
    </>
  );
}

export default function InvestorPage() {
  return <DataGate>{(d) => <Investor d={d} />}</DataGate>;
}
