"use client";
import { useMemo } from "react";
import { AdvisoryAlert } from "@/components/bond/AdvisoryAlert";
import { ActionRow } from "@/components/bond/ActionRow";
import { EventDetails } from "@/components/bond/EventDetails";
import { PageHeading } from "@/components/bond/PageHeading";
import { SimulatedTimeNote } from "@/components/bond/SimulatedTimeNote";
import { CountdownRing } from "@/components/motion/CountdownRing";
import { DataGate } from "@/components/shell/DataGate";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Hex } from "@/components/ui/Hex";
import { EmptyState } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import { STATUS_TONE } from "@/components/bond/statusTone";
import { Timestamp } from "@/components/ui/Timestamp";
import { hashscan } from "@/config/networks";
import { TRIGGER_ABI } from "@/lib/abi";
import { eventInfos, type EventInfo } from "@/lib/eventInfo";
import { formatBps, formatDuration, formatMagnitude } from "@/lib/format";
import { canExecute, canPause, canUnpause, canVeto, remainingAt } from "@/lib/guards";
import { useData, useNow, type DashboardData } from "@/state/data";
import { useNetwork } from "@/state/network";
import { useWalletGuard } from "@/state/useWalletGuard";
import { useWallet } from "@/state/wallet";

function PendingEvent({ info, d }: { info: EventInfo; d: DashboardData }) {
  const { state } = useNetwork();
  const { refresh } = useData();
  const { run } = useWallet();
  const { w, busy } = useWalletGuard();
  const now = useNow();
  const s = d.snapshot;
  const remaining = remainingAt(info.record, s, now);
  if (state.status !== "ready") return null;
  const call = (label: string, method: string) => void run(label, [{ label, address: s.addresses.trigger, abi: [...TRIGGER_ABI], method, args: [info.record.eventId] }], refresh);
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          {info.usgsId ?? "Unnamed event"} <Tag tone="error">Pending</Tag>
          {info.synthetic && <Tag tone="warning">SYNTHETIC</Tag>}
          {info.mode === "replay" && <Tag tone="warning">REPLAY</Tag>}
        </span>
      }
      subtitle={`${formatMagnitude(info.record.magnitudeX100)}, ${formatBps(info.record.lossBps)} of loss if executed`}
    >
      <div className="space-y-4">
        <AdvisoryAlert info={info} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,18rem)_1fr]">
          <div className="space-y-4">
            <CountdownRing remaining={remaining} total={s.terms.challengeWindow} paused={s.trigger.paused} />
            <div className="text-sm">
              <p className="num font-medium text-neutral-900">
                {remaining === 0 ? "Window complete" : s.trigger.paused ? `Clock stopped: ${formatDuration(remaining)} of unpaused time left` : `Window ends in ${formatDuration(remaining)} of unpaused time`}
              </p>
              <p className="mt-0.5 text-xs text-neutral-700">
                Paused time does not count.{" "}
                <span tabIndex={0} className="cursor-help underline decoration-dotted" title={`Raw effective time (seconds, not a date): window start ${info.record.windowStart}, window end ${info.record.windowEndsAt}`}>
                  Raw values
                </span>
              </p>
            </div>
            <SimulatedTimeNote />
          </div>
          <EventDetails info={info} net={state.net} />
        </div>
        <div className="divide-y divide-neutral-100 border-t border-neutral-200 pt-4">
          <ActionRow title="Veto" description="Trustee only, inside the window; also works while paused. A veto is permanent for this event." guard={canVeto(info.record, remaining, d.account, w)} busy={busy} onRun={() => call("Veto", "veto")} label="Veto event" variant="danger" />
          <ActionRow title="Execute" description="Anyone, once the window is complete and the trigger is not paused. Applies the loss and credits the sponsor in one step." guard={canExecute(s, info.record, remaining, d.account, w)} busy={busy} onRun={() => call("Execute", "execute")} label="Execute" />
        </div>
      </div>
    </Card>
  );
}

function Trustee({ d }: { d: DashboardData }) {
  const { state } = useNetwork();
  const { refresh } = useData();
  const { run } = useWallet();
  const { w, busy } = useWalletGuard();
  const s = d.snapshot;
  const a = d.account;
  const infos = useMemo(() => eventInfos(d.events, d.logs, d.hcs), [d.events, d.logs, d.hcs]);
  const pending = infos.filter((i) => i.record.status === "Pending");
  const advised = pending.filter((i) => i.advisories.length > 0);
  if (state.status !== "ready") return null;
  const control = (label: string, method: "pause" | "unpause") => void run(label, [{ label, address: s.addresses.trigger, abi: [...TRIGGER_ABI], method, args: [] }], refresh);
  const pauseGuard = canPause(s, a, w);
  const unpauseGuard = canUnpause(s, a, w);

  return (
    <>
      <PageHeading title="Trustee">Pending events and their challenge windows. The trustee can veto inside the window and pause the trigger; only the admin can unpause.</PageHeading>
      {advised.length > 0 && (
        <div className="mb-5 rounded-md border-2 border-error-500 bg-white px-4 py-3 text-sm font-semibold text-error-800" role="alert">
          Oracle advises veto on {advised.length} pending event{advised.length > 1 ? "s" : ""}: {advised.map((i) => i.usgsId ?? i.record.eventId.slice(0, 10)).join(", ")}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Trigger" className="lg:col-span-2" action={s.trigger.paused ? <Tag tone="warning">Paused</Tag> : <Tag tone="success">Running</Tag>}>
          <DefinitionList
            items={[
              { term: "Pending events", value: s.trigger.pendingCount },
              { term: "Challenge window", value: `${formatDuration(s.terms.challengeWindow)} of unpaused time` },
              { term: "Paused since", value: s.trigger.paused ? <Timestamp unix={s.trigger.pauseStart} /> : "Not paused" },
              { term: "Total paused time", value: `${formatDuration(s.trigger.totalPausedSeconds)}${s.trigger.paused ? " plus the running pause" : ""}` },
              { term: "Oracle (signer)", value: <Hex value={s.addresses.oracle} href={hashscan(state.net, "account", s.addresses.oracle)} /> },
              { term: "Trigger contract", value: <Hex value={s.addresses.trigger} href={hashscan(state.net, "contract", s.addresses.trigger)} /> },
            ]}
          />
        </Card>
        <Card title="Controls" subtitle={a ? `Connected: ${a.isTrustee ? "trustee" : ""}${a.isTrustee && a.isAdmin ? " and " : ""}${a.isAdmin ? "admin" : ""}${!a.isTrustee && !a.isAdmin ? "no trigger role" : ""}` : "Connect the trustee wallet"}>
          <div className="space-y-3">
            <div>
              <Button variant="danger" disabled={!pauseGuard.ok || busy} onClick={() => control("Pause trigger", "pause")} title={pauseGuard.ok ? undefined : pauseGuard.reason}>
                Pause trigger
              </Button>
              {!pauseGuard.ok && <p className="mt-1 text-xs text-neutral-700">{pauseGuard.reason}</p>}
              <p className="mt-1.5 text-xs text-neutral-700">Stops submit and execute and freezes every challenge clock. Redemption also waits.</p>
            </div>
            {a?.isAdmin && (
              <div className="border-t border-neutral-200 pt-3">
                <Button variant="primary" disabled={!unpauseGuard.ok || busy} onClick={() => control("Unpause trigger", "unpause")}>
                  Unpause trigger
                </Button>
                {!unpauseGuard.ok && <p className="mt-1 text-xs text-neutral-700">{unpauseGuard.reason}</p>}
                <p className="mt-1.5 text-xs text-neutral-700">Admin only. The paused time is added to every window and to the submission deadline.</p>
              </div>
            )}
          </div>
        </Card>
      </div>
      <div className="mt-5 space-y-5">
        {pending.length === 0 ? (
          <Card title="Pending events">
            <EmptyState title="No pending events">When the oracle submits an attestation, it appears here with its challenge window.</EmptyState>
          </Card>
        ) : (
          pending.map((i) => <PendingEvent key={i.record.eventId} info={i} d={d} />)
        )}
      </div>
      <Card title="All events" subtitle="Every eventId the trigger has seen" className="mt-5">
        {infos.length === 0 ? (
          <EmptyState>No attestation has been submitted to this trigger.</EmptyState>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-neutral-200 text-xs text-neutral-700">
                <tr>
                  <th scope="col" className="px-5 py-2 text-left font-medium">Event</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Magnitude</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Loss (bps)</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Nonce</th>
                  <th scope="col" className="px-5 py-2 text-left font-medium">HCS advisories</th>
                </tr>
              </thead>
              <tbody className="num divide-y divide-neutral-100">
                {infos.map((i) => (
                  <tr key={i.record.eventId}>
                    <td className="px-5 py-2">
                      <span className="font-mono text-xs">{i.usgsId ?? i.record.eventId.slice(0, 18)}</span>
                      {i.synthetic && <span className="ml-2"><Tag tone="warning">SYNTHETIC</Tag></span>}
                    </td>
                    <td className="px-3 py-2">
                      <Tag tone={STATUS_TONE[i.record.status]}>{i.record.status}</Tag>
                    </td>
                    <td className="px-3 py-2 text-right">{formatMagnitude(i.record.magnitudeX100)}</td>
                    <td className="px-3 py-2 text-right">{i.record.lossBps.toLocaleString("en-US")}</td>
                    <td className="px-3 py-2 text-right">{i.record.nonce}</td>
                    <td className="px-5 py-2 text-xs">{i.advisories.length ? `${i.advisories.length} (oracle advised veto)` : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

export default function TrusteePage() {
  return <DataGate>{(d) => <Trustee d={d} />}</DataGate>;
}
