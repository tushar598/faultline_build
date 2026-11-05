"use client";
import { useMemo } from "react";
import { ActivityTable } from "@/components/bond/ActivityTable";
import { PageHeading } from "@/components/bond/PageHeading";
import { PendingBanner } from "@/components/bond/PendingBanner";
import { PoolTotals } from "@/components/bond/PoolTotals";
import { SimulatedTimeNote } from "@/components/bond/SimulatedTimeNote";
import { ScheduleTimeline } from "@/components/bond/ScheduleTimeline";
import { TermsCard } from "@/components/bond/TermsCard";
import { LossIndexBar } from "@/components/motion/LossIndexBar";
import { DataGate } from "@/components/shell/DataGate";
import { Card } from "@/components/ui/Card";
import { Stat } from "@/components/ui/Stat";
import { Tag } from "@/components/ui/Tag";
import { Timestamp } from "@/components/ui/Timestamp";
import { eventInfos, eventNames } from "@/lib/eventInfo";
import { PHASE_LABEL, phaseAt } from "@/lib/phase";
import { chainNowAt, useNow, type DashboardData } from "@/state/data";
import { useNetwork } from "@/state/network";

function Overview({ d }: { d: DashboardData }) {
  const { state } = useNetwork();
  const now = useNow();
  const s = d.snapshot;
  const chainNow = chainNowAt(s, now);
  const phase = phaseAt(s, chainNow);
  const names = useMemo(() => eventNames(eventInfos(d.events, d.logs, d.hcs)), [d.events, d.logs, d.hcs]);
  if (state.status !== "ready") return null;
  return (
    <>
      <PageHeading title="Overview">Bond status, loss index and pool books, read from the chain. Amounts are in USD base units of the 6-decimal stablecoin.</PageHeading>
      <PendingBanner d={d} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Bond status" className="lg:col-span-2" action={<Tag tone="accent">{PHASE_LABEL[phase]}</Tag>}>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat label="Chain time" value={<Timestamp unix={chainNow} />} />
            <Stat label="Submissions close, redemption opens after" value={<Timestamp unix={s.schedule.submissionDeadline} />} hint={s.trigger.totalPausedSeconds > 0 ? `Includes ${s.trigger.totalPausedSeconds.toLocaleString("en-US")} s of pause` : "Maturity plus grace plus paused time"} />
            <Stat label="Pending events" value={s.trigger.pendingCount} hint={s.trigger.paused ? "Trigger paused" : "Trigger running"} />
          </div>
          <ScheduleTimeline s={s} now={chainNow} />
          <SimulatedTimeNote className="mt-3" />
        </Card>
        <Card title="Loss index L" subtitle="Cumulative write-down of original principal">
          <LossIndexBar bps={s.books.appliedLossBps} large />
          <p className="mt-4 text-xs text-neutral-700">ATS balances do not change at a write-down. A unit is worth (10,000 minus L) / 10,000 of its notional plus accrued coupon, which the investor view shows as effective value.</p>
        </Card>
      </div>
      <Card title="Pool totals" className="mt-5">
        <PoolTotals s={s} />
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card title="Terms" subtitle="Trigger terms are checked against the on-chain termsHash before they are shown" className="lg:col-span-2">
          <TermsCard s={s} terms={d.terms} />
        </Card>
        <Card title="Recent activity" subtitle="Pool and trigger events, newest first" className="lg:col-span-3">
          <SimulatedTimeNote className="mb-3" />
          <ActivityTable logs={d.logs} net={state.net} names={names} limit={10} />
        </Card>
      </div>
    </>
  );
}

export default function OverviewPage() {
  return <DataGate>{(d) => <Overview d={d} />}</DataGate>;
}
