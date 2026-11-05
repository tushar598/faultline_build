"use client";
import { useMemo, useState } from "react";
import { KutchMap } from "@/components/bond/KutchMap";
import { HoldersTable } from "@/components/bond/HoldersTable";
import { PageHeading } from "@/components/bond/PageHeading";
import { SignedCheck } from "@/components/bond/SignedCheck";
import { SimulatedTimeNote } from "@/components/bond/SimulatedTimeNote";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { CountdownRing } from "@/components/motion/CountdownRing";
import { LossIndexBar } from "@/components/motion/LossIndexBar";
import { ReplayTimeline, type Step } from "@/components/motion/ReplayTimeline";
import { DataGate } from "@/components/shell/DataGate";
import { Card } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Hex } from "@/components/ui/Hex";
import { EmptyState, Note, Skeleton } from "@/components/ui/Notes";
import { Stat } from "@/components/ui/Stat";
import { Tag } from "@/components/ui/Tag";
import { Timestamp } from "@/components/ui/Timestamp";
import { hashscan } from "@/config/networks";
import { eventInfos, type EventInfo } from "@/lib/eventInfo";
import { consensusSeconds, formatAmount, formatBps, formatMagnitude, formatUsd } from "@/lib/format";
import { remainingAt } from "@/lib/guards";
import { eventIdOf } from "@/lib/shared";
import { useNow, type DashboardData } from "@/state/data";
import { useNetwork } from "@/state/network";
import { useUsgs } from "@/state/useUsgs";

const BHUJ = "usp000a8ds";
const BHUJ_EVENT_ID = eventIdOf(BHUJ);
const usd = (v: bigint) => formatAmount(v);

function UsgsPanel({ info, d }: { info: EventInfo | null; d: DashboardData }) {
  const usgsId = info?.usgsId ?? BHUJ;
  const usgs = useUsgs(usgsId, info?.record.dataHash ?? null);
  const box = d.terms?.matchesChain ? d.terms.terms.box : null;
  if (usgs.status === "error") return <Note tone="warning" title="USGS record unavailable">{usgs.error}</Note>;
  if (usgs.status !== "ready") return <Skeleton className="h-80 w-full" />;
  const f = usgs.record.feature;
  const [lon, lat, depth] = f.geometry.coordinates;
  return (
    <div className="space-y-4">
      {box ? <KutchMap box={box} epicentre={{ lat, lon }} label={`${f.properties.mag !== null ? `M${f.properties.mag}` : ""} ${f.properties.magType}`} /> : <Note tone="info">The insured box is shown once a terms file matching the on-chain termsHash is available.</Note>}
      <DefinitionList
        items={[
          {
            term: "Record",
            value: (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{f.id}</span>
                {usgs.record.source === "synthetic" ? <Tag tone="warning">SYNTHETIC, not a real USGS event</Tag> : <Tag tone="info">{usgs.record.source === "live" ? "Live USGS ComCat API" : "Saved copy of the real USGS record"}</Tag>}
              </span>
            ),
          },
          { term: "Magnitude", value: `${formatMagnitude(Math.round((f.properties.mag ?? 0) * 100))} ${f.properties.magType}` },
          { term: "Status", value: f.properties.status },
          { term: "Epicentre and depth", value: `${lat.toFixed(3)} N, ${lon.toFixed(3)} E, ${depth} km` },
          { term: "Origin time (real)", value: <Timestamp unix={Math.floor(f.properties.time / 1000)} /> },
          {
            term: "dataHash vs chain",
            value: !info ? (
              "Not on chain yet"
            ) : usgs.matchesChain ? (
              <Tag tone="success">Record hashes to the on-chain dataHash</Tag>
            ) : (
              <Tag tone="warning">No version of this record matches the on-chain dataHash</Tag>
            ),
          },
        ]}
      />
    </div>
  );
}

function steps(info: EventInfo | null, d: DashboardData, now: number, explorer: (h: string) => string | null): Step[] {
  const s = d.snapshot;
  const r = info?.record ?? null;
  const att = info?.attestations[0];
  const submitted = info?.logs.find((l) => l.name === "AttestationSubmitted");
  const executed = info?.logs.find((l) => l.name === "EventExecuted");
  const vetoed = info?.logs.find((l) => l.name === "EventVetoed");
  const lossLog = executed ? d.logs.find((l) => l.name === "LossApplied" && l.txHash === executed.txHash) : undefined;
  const remaining = r ? remainingAt(r, s, now) : 0;
  const atsTotal = d.holders.reduce((t, h) => t + h.bondBalance, 0n);
  const effective = d.holders.reduce((t, h) => t + h.principal + h.coupon, 0n);
  const tx = (h: string) => <Hex value={h} href={explorer(h)} />;
  return [
    {
      key: "hcs",
      title: "Attestation published to HCS",
      state: att ? "done" : "waiting",
      body: att ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="num">Sequence {att.sequenceNumber}, consensus</span>
          <Timestamp unix={consensusSeconds(att.consensusTimestamp)} />
          <SignedCheck ok={att.signedByOracle} />
        </span>
      ) : (
        "Waiting for the oracle to publish the signed attestation."
      ),
    },
    {
      key: "submit",
      title: "Submitted to the trigger",
      state: submitted ? "done" : "waiting",
      body: submitted ? (
        <span className="flex flex-wrap items-center gap-2">
          {submitted.timestamp !== null && (
            <span>
              Block time <Timestamp unix={submitted.timestamp} />
            </span>
          )}{" "}
          {tx(submitted.txHash)}
          <span className="num text-xs text-neutral-700">
            {formatMagnitude(r!.magnitudeX100)}, {formatBps(r!.lossBps)}
          </span>
        </span>
      ) : (
        "Waiting for the relayer to submit the attestation on chain."
      ),
    },
    {
      key: "window",
      title: "Challenge window",
      state: !r || r.status === "None" ? "waiting" : r.status === "Pending" ? "active" : r.status === "Vetoed" ? "stopped" : "done",
      body:
        r?.status === "Pending" ? (
          <CountdownRing remaining={remaining} total={s.terms.challengeWindow} paused={s.trigger.paused} size={104} />
        ) : r?.status === "Vetoed" ? (
          <span>Vetoed by the trustee {vetoed ? tx(vetoed.txHash) : null}. No loss applied.</span>
        ) : r && r.status !== "None" ? (
          "Window complete without a veto."
        ) : (
          "Starts when the attestation is submitted."
        ),
    },
    {
      key: "execute",
      title: "Executed: loss index raised",
      state: executed ? "done" : r?.status === "Vetoed" || r?.status === "Superseded" ? "stopped" : "waiting",
      body: executed ? (
        <span className="flex flex-wrap items-center gap-2">
          <span className="num font-semibold">
            L {lossLog ? formatBps(Number(lossLog.args.previousBps)) : "?"} to {formatBps(Number(executed.args.newCumulativeBps))}
          </span>
          {executed.timestamp !== null && (
            <span>
              Block time <Timestamp unix={executed.timestamp} />
            </span>
          )}{" "}
          {tx(executed.txHash)}
        </span>
      ) : (
        "Anyone can execute once the window is complete."
      ),
    },
    {
      key: "sponsor",
      title: "Sponsor credited",
      state: lossLog ? "done" : "waiting",
      body: lossLog ? `${formatUsd(BigInt(String(lossLog.args.sponsorCredit)))} of collateral credited to the sponsor, claimable now.` : "The collateral matching the loss is credited in the same transaction as the execute.",
    },
    {
      key: "holders",
      title: "Every holder's effective value dropped",
      state: executed ? "done" : "waiting",
      body: executed ? (
        <span className="num">
          ATS balances unchanged at {formatAmount(atsTotal)} units; effective value now {formatUsd(effective)} including accrued coupon.
        </span>
      ) : (
        "ATS balances stay the same; the effective value of every unit follows the loss index."
      ),
    },
  ];
}

function Replay({ d }: { d: DashboardData }) {
  const { state } = useNetwork();
  const now = useNow();
  const infos = useMemo(() => eventInfos(d.events, d.logs, d.hcs), [d.events, d.logs, d.hcs]);
  const [picked, setPicked] = useState<string | null>(null);
  const info = infos.find((i) => i.record.eventId === (picked ?? BHUJ_EVENT_ID)) ?? (picked ? null : (infos[0] ?? null));
  const s = d.snapshot;
  if (state.status !== "ready") return null;
  const isReplay = info?.mode === "replay" || d.terms?.terms.mode === "replay";
  const atsTotal = d.holders.reduce((t, h) => t + h.bondBalance, 0n);
  const effective = d.holders.reduce((t, h) => t + h.principal + h.coupon, 0n);
  return (
    <>
      <PageHeading
        title="Quake replay"
        action={
          infos.length > 1 ? (
            <label className="text-xs text-neutral-700">
              <span className="mr-2 font-medium">Event</span>
              <select value={info?.record.eventId ?? ""} onChange={(e) => setPicked(e.target.value)} className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-900">
                {infos.map((i) => (
                  <option key={i.record.eventId} value={i.record.eventId}>
                    {i.usgsId ?? i.record.eventId.slice(0, 12)}
                    {i.synthetic ? " (SYNTHETIC)" : ""}, {i.record.status}
                  </option>
                ))}
              </select>
            </label>
          ) : null
        }
      >
        Investors earn a coupon for carrying earthquake risk. If a reviewed USGS quake inside the box crosses M7.0, principal is written down on a linear curve and the sponsor receives the matching collateral after the challenge window.
      </PageHeading>
      {isReplay && (
        <div className="mb-5">
          <Note tone="warning" title="REPLAY of a historical record">
            {info?.usgsId === BHUJ || !info ? "The 2001 Bhuj earthquake (USGS usp000a8ds)" : `USGS record ${info.usgsId}`} is replayed into this bond&apos;s risk period (D10). It is not a live earthquake. Origin and update times below are the real ones; on chain they are shifted by a fixed offset.
          </Note>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={info?.usgsId === BHUJ || !info ? "Bhuj, Gujarat, 26 January 2001" : (info.usgsId ?? "Event")} subtitle="Epicentre against the insured box">
          <UsgsPanel info={info} d={d} />
        </Card>
        <Card title="What happened, step by step" subtitle="From the HCS log and on-chain events">
          <SimulatedTimeNote className="mb-4" />
          {info || d.hcs.length || d.logs.length ? <ReplayTimeline steps={steps(info, d, now, (h) => hashscan(state.net, "transaction", h))} /> : <EmptyState>Nothing submitted yet. Run the replay with the oracle CLI.</EmptyState>}
        </Card>
      </div>
      <Card title="Outcome" className="mt-5">
        <div className="grid gap-6 md:grid-cols-3">
          <LossIndexBar bps={s.books.appliedLossBps} large />
          <Stat label="Sponsor credited" value={<AnimatedNumber value={s.books.sponsorCredited} format={usd} className="text-3xl font-semibold" />} unit="USD" hint="Collateral moved to the sponsor's claimable balance" />
          <Stat label="Holders' effective value" value={<AnimatedNumber value={effective} format={usd} className="text-3xl font-semibold" />} unit="USD" hint={`ATS balances total ${formatAmount(atsTotal)} units, unchanged by the write-down`} />
        </div>
      </Card>
      <Card title="Holders" subtitle="ATS balance next to effective value" className="mt-5">
        <HoldersTable rows={d.holders} lossBps={s.books.appliedLossBps} />
      </Card>
    </>
  );
}

export default function ReplayPage() {
  return <DataGate>{(d) => <Replay d={d} />}</DataGate>;
}
