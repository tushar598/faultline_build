"use client";
import { HcsLogTable } from "@/components/bond/HcsLogTable";
import { PageHeading } from "@/components/bond/PageHeading";
import { SimulatedTimeNote } from "@/components/bond/SimulatedTimeNote";
import { DataGate } from "@/components/shell/DataGate";
import { Card } from "@/components/ui/Card";
import { Hex } from "@/components/ui/Hex";
import { Note } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import { TESTNET_EVIDENCE, hashscan } from "@/config/networks";
import { describeLog } from "@/lib/describe";
import { eventInfos, eventNames } from "@/lib/eventInfo";
import type { DashboardData } from "@/state/data";
import { useNetwork } from "@/state/network";

function Evidence({ d }: { d: DashboardData }) {
  const { state } = useNetwork();
  if (state.status !== "ready") return null;
  const net = state.net;
  const s = d.snapshot;
  const rows = [
    { label: "FaultlinePool", value: s.addresses.pool, kind: "contract" as const },
    { label: "FaultlineTrigger", value: s.addresses.trigger, kind: "contract" as const },
    { label: `Bond ${s.symbols.bond}`, value: s.addresses.bond, kind: "contract" as const },
    { label: `Stablecoin ${s.symbols.stablecoin}`, value: s.addresses.stablecoin, kind: net.id === "testnet" ? ("token" as const) : ("contract" as const) },
    { label: "Oracle signer", value: s.addresses.oracle, kind: "account" as const },
    { label: "Sponsor", value: s.addresses.sponsor, kind: "account" as const },
  ];
  const txs = [...new Map(d.logs.map((l) => [l.txHash, l])).values()].reverse();
  // Event ids by name, with "(SYNTHETIC)" for synthetic records, as on the other views.
  const names = eventNames(eventInfos(d.events, d.logs, d.hcs));
  const topic = net.hcs.topicId;
  return (
    <>
      <PageHeading title="Evidence">Where every number on this dashboard comes from. On testnet each entry links to HashScan; the local chain has no explorer.</PageHeading>
      {net.id === "local" && (
        <div className="mb-5">
          <Note tone="info" title="Local chain">
            Contracts here run on a Hardhat node with mock ATS and HTS tokens (MockBond, MockUSD). Nothing on this network is testnet evidence. Switch the network to Hedera testnet for the full-demo records.
          </Note>
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Contracts and accounts" subtitle={`${net.label}, chain ${net.chainId}`}>
          <ul className="divide-y divide-neutral-100 text-sm">
            {rows.map((r) => (
              <li key={r.label} className="flex items-center justify-between gap-3 py-2">
                <span className="text-neutral-800">{r.label}</span>
                <Hex value={r.value} href={hashscan(net, r.kind, r.value)} />
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 py-2">
              <span className="text-neutral-800">HCS topic</span>
              {topic ? (
                net.explorer ? (
                  <a className="font-mono text-xs text-accent-600 hover:underline" href={hashscan(net, "topic", topic) ?? undefined} target="_blank" rel="noreferrer">
                    {topic}
                  </a>
                ) : (
                  <span className="font-mono text-xs">{topic} (local file mock)</span>
                )
              ) : (
                <span className="text-xs text-neutral-700">None configured</span>
              )}
            </li>
          </ul>
        </Card>
        {net.id === "testnet" ? (
          <Card title={TESTNET_EVIDENCE.title} subtitle="Recorded in docs/TESTNET-EVIDENCE.md; every status checked on the mirror node">
            <ul className="divide-y divide-neutral-100 text-sm">
              {TESTNET_EVIDENCE.transactions.map((t) => (
                <li key={t.hash} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-neutral-800">{t.label}</span>
                  <Hex value={t.hash} href={hashscan(net, "transaction", t.hash)} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card title="What is verified where">
            <ul className="space-y-2 text-sm text-neutral-800">
              <li className="flex items-start gap-2"><Tag tone="success">Testnet</Tag> FaultlinePool and FaultlineTrigger (D17 build) ran the full demo on Hedera testnet: a SYNTHETIC event paused and vetoed, the real Bhuj record executed (L = 7,000 bps).</li>
              <li className="flex items-start gap-2"><Tag tone="success">Testnet</Tag> The oracle service end to end: real HCS topic, live USGS record, submit and keeper.</li>
              <li className="flex items-start gap-2"><Tag tone="neutral">Local only</Tag> This local view and its mock HCS log.</li>
            </ul>
          </Card>
        )}
      </div>
      <Card title="HCS attestation log" subtitle={net.hcs.mode === "mock" ? "Local mock file oracle/.hcs-mock, same message format as the real topic" : `Mirror node, topic ${topic}`} className="mt-5">
        {d.hcsError && (
          <div className="mb-3">
            <Note tone="warning" title="HCS log unavailable">
              {d.hcsError}
            </Note>
          </div>
        )}
        <SimulatedTimeNote className="mb-3" />
        <HcsLogTable entries={d.hcs} source={net.hcs.mode === "mock" ? "the local mock topic" : `topic ${topic}`} />
      </Card>
      <Card title="Transactions seen by this dashboard" subtitle="Every transaction that emitted a pool, trigger or bond event" className="mt-5">
        <ul className="divide-y divide-neutral-100 text-sm">
          {txs.map((l) => (
            <li key={l.txHash} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span className="num min-w-0 text-neutral-800">{describeLog(l, names)}</span>
              <Hex value={l.txHash} href={hashscan(net, "transaction", l.txHash)} />
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export default function EvidencePage() {
  return <DataGate>{(d) => <Evidence d={d} />}</DataGate>;
}
