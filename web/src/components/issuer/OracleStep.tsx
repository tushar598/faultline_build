"use client";
// The oracle step of an issuer-page bond (src/lib/issuer/oracleSteps.ts): save the entry, then the SYNTHETIC event
// (pause and veto) and the real Bhuj record (execute), as ops/ commands with this bond's values filled in.
import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Hex } from "@/components/ui/Hex";
import { Note } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import { formatIst } from "@/lib/format";
import type { Deployment } from "@/lib/issuer/deployments";
import { oracleSteps } from "@/lib/issuer/oracleSteps";
import { CodeBlock } from "./Field";

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="num mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-800">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-neutral-900">{title}</p>
        {children}
      </div>
    </li>
  );
}

export function OracleStepCard({ deployment, oracle, oracleHref, className }: { deployment: Deployment; oracle?: string; oracleHref?: string | null; className?: string }) {
  const s = oracleSteps(deployment);
  return (
    <Card
      className={className}
      title="Oracle step (ops/ command)"
      subtitle="A browser wallet cannot sign this: the oracle signs the attestation with its own key and the relayer publishes it to HCS, then submits it. Run from the repo root; the dry run sends nothing."
      action={<Tag tone="warning">Oracle key holder only</Tag>}
    >
      {!s.ok ? (
        <Note tone="info">{s.reason}</Note>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-neutral-800">
            EXECUTE=1 sends only with the bond&apos;s oracle key and the relayer key in the ops/ Hardhat keystore; the helper stops if the trigger&apos;s oracle is another account
            {oracle ? (
              <>
                {" "}(this trigger&apos;s oracle: <Hex value={oracle} href={oracleHref ?? null} />)
              </>
            ) : null}
            . Order: the SYNTHETIC event first, then Bhuj. The oracle can submit until {formatIst(s.deadline)}, later by any paused time.
          </p>
          <ol className="divide-y divide-neutral-100">
            <Step n={1} title={`Save this bond's entry (once): ops/${s.file}`}>
              <CodeBlock label="Save the entry" code={s.save} />
            </Step>
            <Step n={2} title={`SYNTHETIC event, pause and veto (from ${formatIst(s.synthetic.observedAt)})`}>
              <CodeBlock label="Dry run" code={s.synthetic.dryRun} />
              <CodeBlock label="Send (oracle key holder)" code={s.synthetic.execute} />
              <p className="text-xs text-neutral-700">
                Open /trustee with the trustee wallet before you send. Inside the {deployment.schedule.challengeWindow} s window: trustee Pause, then Veto event; the admin wallet Unpause.
              </p>
            </Step>
            <Step n={3} title={`Real Bhuj record usp000a8ds, execute (from ${formatIst(s.bhuj.observedAt)})`}>
              <CodeBlock label="Dry run" code={s.bhuj.dryRun} />
              <CodeBlock label="Send (oracle key holder)" code={s.bhuj.execute} />
              <p className="text-xs text-neutral-700">
                USGS_OFFLINE=1 uses the saved real USGS record (oracle/fixtures/real-usgs-usp000a8ds-detail.geojson, the same dataHash as the live record); remove it to fetch the record
                live from USGS. After the window, press Execute on /trustee (any wallet). If the command ends with an RPC error, read the event status here before running it again.
              </p>
            </Step>
          </ol>
        </div>
      )}
    </Card>
  );
}
