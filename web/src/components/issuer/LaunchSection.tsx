"use client";
import { CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Hex } from "@/components/ui/Hex";
import { Note } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import type { Check } from "@/lib/issuer/audit";
import { kycCommand, topicCommand, topicMemo } from "@/lib/issuer/opsSteps";
import { planFor, stepStatus, type StepDef, type StepId, type WizardState } from "@/lib/issuer/wizard";
import { CodeBlock, Field } from "./Field";

export type StepView = { error?: string; lines?: string[]; checks?: Check[] };

const KIND_LABEL = { wallet: "Wallet", ops: "ops/ command", check: "Read only" } as const;

/** Step c and d: the wizard, one row per step, with the wallet action, the ops/ command and its check, or the audit. */
export function LaunchSection({
  wizard,
  views,
  busy,
  phase,
  canSend,
  walletOnChain,
  txUrl,
  onRun,
  onSkip,
  onReset,
}: {
  wizard: WizardState;
  views: Partial<Record<StepId, StepView>>;
  busy: StepId | null;
  phase: string | null;
  canSend: boolean;
  /** The backup-trustee step is signed by the trustee, not the admin: it only needs a wallet on this chain. */
  walletOnChain: boolean;
  txUrl: (hash: string) => string | null;
  onRun: (id: StepId, extra?: { topicId?: string }) => void;
  onSkip: (id: StepId) => void;
  onReset: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const plan = planFor(wizard.mode);
  const done = plan.filter((s) => wizard.steps[s.id]).length;
  return (
    <Card
      title="c. Launch"
      subtitle={`${done} of ${plan.length} steps finished. Progress is kept in this browser; closing the tab resumes here. Each wallet step is simulated first and sent with gas = estimate x 1.3.`}
      action={
        confirmReset ? (
          <div className="flex gap-2">
            <Button variant="danger" onClick={onReset}>
              Confirm reset
            </Button>
            <Button onClick={() => setConfirmReset(false)}>Keep</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirmReset(true)} disabled={busy !== null} title="Forget this launch in this browser (contracts already deployed stay on chain)">
            Reset launch
          </Button>
        )
      }
    >
      <ol className="divide-y divide-neutral-100">
        {plan.map((s, i) => (
          <StepRow key={s.id} n={i + 1} def={s} wizard={wizard} view={views[s.id]} busy={busy} phase={busy === s.id ? phase : null} canSend={s.id === "backupTrustee" ? walletOnChain : canSend} txUrl={txUrl} onRun={onRun} onSkip={onSkip} />
        ))}
      </ol>
    </Card>
  );
}

function StepRow({ n, def, wizard, view, busy, phase, canSend, txUrl, onRun, onSkip }: { n: number; def: StepDef; wizard: WizardState; view?: StepView; busy: StepId | null; phase: string | null; canSend: boolean; txUrl: (h: string) => string | null; onRun: (id: StepId, extra?: { topicId?: string }) => void; onSkip: (id: StepId) => void }) {
  const status = stepStatus(wizard, def.id);
  const rec = wizard.steps[def.id];
  const running = busy === def.id;
  const p = wizard.inputs.parties;
  const [topicId, setTopicId] = useState(wizard.out.topicId ?? "");
  const Icon = running ? Loader2 : status === "done" ? CheckCircle2 : status === "skipped" ? MinusCircle : view?.error ? XCircle : Circle;
  const tone = status === "done" ? "text-success-700" : status === "skipped" ? "text-neutral-500" : view?.error ? "text-error-700" : "text-neutral-500";
  const ready = status === "ready";
  const actionLabel = def.kind === "wallet" ? "Run with wallet" : def.kind === "ops" ? "Check" : "Run checks";
  const opsCmd =
    def.kind !== "ops"
      ? null
      : def.id === "topic"
        ? topicCommand({ oracle: p.oracle, trustee: p.trustee, payer: p.topicPayer, memo: topicMemo(p.bondSymbol) })
        : kycCommand({ stablecoin: p.stablecoin, accounts: def.id === "poolHtsKyc" ? (wizard.out.pool ? [wizard.out.pool] : []) : p.investors, kycKeyHolder: p.kycKeyHolder });
  return (
    <li className="py-3.5" data-step={def.id} aria-label={`Step ${n}: ${def.title}`}>
      <div className="flex flex-wrap items-start gap-3">
        <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${tone} ${running ? "animate-spin" : ""}`} strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-neutral-900">
              {n}. {def.title}
            </span>
            <Tag tone={def.kind === "ops" ? "warning" : def.kind === "wallet" ? "accent" : "neutral"}>{KIND_LABEL[def.kind]}</Tag>
            <Tag tone={status === "done" ? "success" : status === "ready" ? "info" : "neutral"}>{status === "done" ? "Done" : status === "skipped" ? "Skipped" : status === "ready" ? "Ready" : "Waiting"}</Tag>
          </div>
          <p className="mt-0.5 text-xs text-neutral-700">{def.detail}</p>
          {rec?.note && <p className="mt-0.5 text-xs text-neutral-700">{rec.note}</p>}
          {rec?.txs && rec.txs.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
              {rec.txs.map((h) => (
                <li key={h}>
                  <Hex value={h} href={txUrl(h)} />
                </li>
              ))}
            </ul>
          )}
          {running && phase && <p className="mt-1 text-xs font-medium text-accent-800">{phase}</p>}
          {ready && opsCmd && (
            <div className="mt-2 space-y-2">
              <p className="text-xs text-neutral-800">Run from the repo root (the owner, with keys in the Hardhat keystore). First the dry run, then the same line with EXECUTE=1. The networks in ops/hardhat.config.ts that hold the keys can be changed with SUBMIT, ADMIN, PAYER or KYC.</p>
              <CodeBlock label="Dry run" code={opsCmd.dryRun} />
              <CodeBlock label="Send (owner only)" code={opsCmd.execute} />
              {def.id === "investorHtsKyc" && <p className="text-xs text-neutral-700">Each investor first associates with the stablecoin from its own wallet (the token&apos;s associate(), as in spike S3); the command lists who is not associated yet.</p>}
              {def.id === "poolHtsKyc" && <p className="text-xs text-neutral-700">A wallet call to 0x167 grantTokenKyc may pass when the token&apos;s KYC key is exactly the wallet&apos;s account key (read from the Hedera node source), but that path is not testnet-verified, so the page does not offer it.</p>}
            </div>
          )}
          {ready && !opsCmd && def.kind === "ops" && <p className="mt-1 text-xs text-error-700">The stablecoin is not an HTS token or no account is listed: there is no command to run.</p>}
          {ready && def.id === "topic" && wizard.mode === "testnet" && (
            <div className="mt-2 max-w-xs">
              <Field id="w-topic" label="Topic id printed by the command" value={topicId} onChange={setTopicId} mono />
            </div>
          )}
          {view?.lines && view.lines.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs text-neutral-800">
              {view.lines.map((l) => (
                <li key={l} className="font-mono">
                  {l}
                </li>
              ))}
            </ul>
          )}
          {view?.checks && <CheckList checks={view.checks} />}
          {view?.error && (
            <div className="mt-2">
              <Note tone="error" title="This step did not finish">
                {view.error}
              </Note>
            </div>
          )}
        </div>
        {ready && def.optional && (
          <Button onClick={() => onSkip(def.id)} disabled={busy !== null}>
            Skip
          </Button>
        )}
        {ready && (
          <Button variant={def.kind === "wallet" ? "primary" : "secondary"} disabled={busy !== null || (def.kind === "wallet" && !canSend)} onClick={() => onRun(def.id, def.id === "topic" ? { topicId } : undefined)} title={def.kind === "wallet" && !canSend ? (def.id === "backupTrustee" ? "Connect the trustee wallet on this network first" : "Sign in with the admin wallet on this network first") : undefined}>
            {running ? "Working" : actionLabel}
          </Button>
        )}
      </div>
    </li>
  );
}

export function CheckList({ checks }: { checks: Check[] }) {
  const failed = checks.filter((c) => !c.ok && !c.warn).length;
  const warned = checks.filter((c) => !c.ok && c.warn).length;
  return (
    <div className="mt-2">
      <p className={`text-xs font-semibold ${failed ? "text-error-700" : "text-success-800"}`}>
        {failed ? `${failed} of ${checks.length} checks failed` : `All ${checks.length - warned} checks passed`}
        {warned > 0 && <span className="text-warning-800">, {warned} warning{warned > 1 ? "s" : ""}</span>}
      </p>
      <ul className="mt-1 space-y-0.5">
        {checks.map((c) => (
          <li key={c.label} className="flex gap-2 text-xs">
            <span className={`w-9 shrink-0 font-semibold ${c.ok ? "text-success-800" : c.warn ? "text-warning-800" : "text-error-700"}`}>{c.ok ? "PASS" : c.warn ? "WARN" : "FAIL"}</span>
            <span className="text-neutral-900">
              {c.label}
              {c.detail && <span className="text-neutral-700"> ({c.detail})</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
