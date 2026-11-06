"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Contract, getAddress } from "ethers";
import { PageHeading } from "@/components/bond/PageHeading";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { DefinitionList } from "@/components/ui/DefinitionList";
import { Hex } from "@/components/ui/Hex";
import { Note, Skeleton } from "@/components/ui/Notes";
import { Tag } from "@/components/ui/Tag";
import { TESTNET_ISSUER_DEFAULTS, hashscan } from "@/config/networks";
import { POOL_ABI, TRIGGER_ABI } from "@/lib/abi";
import { plainError } from "@/lib/errors";
import { shortHex } from "@/lib/format";
import { loadBuild, type IssuerBuild } from "@/lib/issuer/build";
import { configEntry, deploymentId, loadDeployments, removeDeployment, saveDeployment, selectBond, type Deployment } from "@/lib/issuer/deployments";
import { defaultScheduleDraft, validateSchedule, type ScheduleDraft } from "@/lib/issuer/schedule";
import { launchInputs, runStep } from "@/lib/issuer/steps";
import { buildTerms, defaultTermsDraft, followRiskStart, testnetDemoTermsDraft, type TermsDraft } from "@/lib/issuer/terms";
import type { TxPhase } from "@/lib/issuer/tx";
import { clearWizard, completeStep, createWizard, isFinished, isLocked, loadWizard, modeForChain, recordOutputs, saveWizard, skipStep, validateParties, type IssuerMode, type StepId, type WizardState } from "@/lib/issuer/wizard";
import { browserStore } from "@/lib/walletSession";
import { useNetwork } from "@/state/network";
import { useWallet } from "@/state/wallet";
import { CodeBlock } from "./Field";
import { LaunchSection, type StepView } from "./LaunchSection";
import { PartiesSection, investorsOf, type FormParties } from "./PartiesSection";
import { ScheduleSection } from "./ScheduleSection";
import { TermsSection } from "./TermsSection";

type Form = { chainId: number; chainNow: number; terms: TermsDraft; schedule: ScheduleDraft; parties: FormParties };

const PHASE_TEXT: Record<TxPhase, string> = { checking: "Checking the call against the chain", signing: "Confirm in your wallet", pending: "Waiting for the transaction to be mined" };

/** Starting values: chain time from the node; on the local chain the parties come from the node's own unlocked test
 *  accounts and the stablecoin from the built-in local bond; on testnet from the full-demo accounts. */
async function defaults(provider: import("ethers").JsonRpcProvider, chainId: number, mode: IssuerMode, builtInTrigger: string | null): Promise<Form> {
  const chainNow = Number((await provider.getBlock("latest"))!.timestamp);
  const base = { bondName: "Faultline Kutch Bond", bondSymbol: "FLKB", topicPayer: "", kycKeyHolder: "", backupTrustee: "" };
  if (mode === "testnet") {
    const schedule = defaultScheduleDraft(chainNow, "testnet");
    const { investors, ...parties } = TESTNET_ISSUER_DEFAULTS;
    return { chainId, chainNow, terms: testnetDemoTermsDraft(schedule.riskStart), schedule, parties: { ...base, ...parties, investorsText: investors.join("\n") } };
  }
  const accounts = ((await provider.send("eth_accounts", []).catch(() => [])) as string[]).map((a) => getAddress(a));
  let stablecoin = "";
  if (builtInTrigger) {
    try {
      const pool = String(await new Contract(builtInTrigger, TRIGGER_ABI, provider).pool());
      stablecoin = String(await new Contract(pool, POOL_ABI, provider).stablecoin());
    } catch {
      stablecoin = "";
    }
  }
  // Hardhat test accounts in the local world's order (scripts/lib/e2e.ts deployWorld): sponsor #1, trustee #2, oracle #3,
  // investors #5 and #6, backup trustee #8.
  return {
    chainId,
    chainNow,
    terms: defaultTermsDraft(),
    schedule: defaultScheduleDraft(chainNow, "local"),
    parties: { ...base, sponsor: accounts[1] ?? "", trustee: accounts[2] ?? "", oracle: accounts[3] ?? "", backupTrustee: accounts[8] ?? "", stablecoin, investorsText: [accounts[5], accounts[6]].filter(Boolean).join("\n") },
  };
}

function deploymentOf(w: WizardState): Deployment | null {
  const o = w.out;
  if (!o.auditPassed || !o.bond || !o.pool || !o.trigger || o.fromBlock === undefined) return null;
  const { schedule, terms } = launchInputs(w);
  return {
    id: deploymentId(w.chainId, o.trigger),
    label: `${w.inputs.parties.bondSymbol} ${shortHex(o.trigger)}`,
    chainId: w.chainId,
    trigger: o.trigger,
    pool: o.pool,
    bond: o.bond,
    stablecoin: w.inputs.parties.stablecoin,
    topicId: o.topicId ?? null,
    termsHash: terms.value.hash,
    terms: terms.value.terms,
    schedule: { issuanceStart: Number(schedule.issuanceStart), issuanceEnd: Number(schedule.issuanceEnd), riskStart: Number(schedule.riskStart), maturity: Number(schedule.maturity), grace: Number(schedule.grace), challengeWindow: Number(schedule.challengeWindow) },
    fromBlock: o.fromBlock,
    createdAt: new Date().toISOString(),
  };
}

export function IssuerView() {
  const router = useRouter();
  const { state: net } = useNetwork();
  const { available, address, chainId: walletChain, connect, switchTo } = useWallet();
  const chainId = net.status === "ready" ? net.net.chainId : null;
  const mode = chainId ? modeForChain(chainId) : null;

  const [build, setBuild] = useState<IssuerBuild | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  useEffect(() => {
    loadBuild().then(setBuild, (e: unknown) => setBuildError(plainError(e)));
  }, []);

  // The wizard of this chain: from localStorage until this page changes it.
  const [local, setLocal] = useState<{ chainId: number; w: WizardState | null } | null>(null);
  const stored = useMemo(() => (chainId ? loadWizard(browserStore(), chainId) : null), [chainId]);
  const wizard = local && local.chainId === chainId ? local.w : stored;
  const update = (w: WizardState | null) => {
    if (!chainId) return;
    if (w) saveWizard(browserStore(), w);
    else clearWizard(browserStore(), chainId);
    setLocal({ chainId, w });
  };

  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const builtInTrigger = net.status === "ready" && !net.deployment ? net.net.trigger : null;
  const formKey = net.status === "ready" ? `${net.net.chainId}` : null;
  const [reloadForm, setReloadForm] = useState(0);
  useEffect(() => {
    if (net.status !== "ready" || !mode) return;
    let stop = false;
    defaults(net.provider, net.net.chainId, mode, builtInTrigger).then(
      (f) => !stop && setForm(f),
      (e: unknown) => !stop && setFormError(plainError(e)),
    );
    return () => {
      stop = true;
    };
    // Defaults are loaded once per network (and on "Restart from chain time"), not on every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formKey, mode, reloadForm]);

  const [views, setViews] = useState<Partial<Record<StepId, StepView>>>({});
  const [busy, setBusy] = useState<StepId | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  useEffect(() => {
    const read = () => setDeployments(loadDeployments(browserStore()));
    read();
    window.addEventListener("faultline:deployments", read);
    return () => window.removeEventListener("faultline:deployments", read);
  }, []);

  if (net.status === "loading") return <Skeleton className="h-40 w-full" />;
  if (net.status === "error")
    return (
      <Note tone="error" title="Cannot load this network">
        {net.error}
      </Note>
    );
  if (!mode || !chainId)
    return (
      <Note tone="error" title="Not a launch network">
        The issuer page launches bonds only on the local chain (31337) or Hedera testnet (296).
      </Note>
    );

  const locked = wizard ? isLocked(wizard) : false;
  const formHere = form && form.chainId === chainId ? form : null;
  const terms = wizard ? wizard.inputs.terms : formHere?.terms;
  const schedule = wizard ? wizard.inputs.schedule : formHere?.schedule;
  const formParties: FormParties | undefined = wizard ? { ...wizard.inputs.parties, investorsText: wizard.inputs.parties.investors.join("\n") } : formHere?.parties;
  const walletOnChain = Boolean(address) && walletChain === chainId;
  const isAdmin = Boolean(address && wizard && getAddress(wizard.inputs.parties.admin) === getAddress(address));
  const canSend = walletOnChain && (!wizard || isAdmin);

  const termsOk = terms ? buildTerms(terms, chainId).ok : false;
  const scheduleV = schedule ? validateSchedule(schedule) : null;
  const parties = formParties ? { ...formParties, admin: address ?? "", investors: investorsOf(formParties.investorsText) } : null;
  const partyProblems = parties ? validateParties(parties, address, mode) : [];
  const startProblems = [
    ...(!address ? ["Sign in with your wallet: it becomes the admin."] : []),
    ...(address && walletChain !== chainId ? [`Switch the wallet to chain ${chainId}.`] : []),
    ...(!termsOk ? ["Fix the trigger terms."] : []),
    ...(scheduleV && !scheduleV.ok ? ["Fix the schedule and economics."] : []),
    ...partyProblems,
    ...(!build ? ["The repo build is not loaded yet."] : []),
  ];

  const start = () => {
    if (!parties || !terms || !schedule || startProblems.length) return;
    try {
      update(createWizard({ terms, schedule, parties }, chainId));
      setViews({});
    } catch (e) {
      setFormError(plainError(e));
    }
  };

  const run = async (id: StepId, extra?: { topicId?: string }) => {
    if (!wizard || !build || net.status !== "ready" || !address || !window.ethereum) return;
    setBusy(id);
    setViews((v) => ({ ...v, [id]: {} }));
    try {
      const mirrorUrl = net.net.hcs.mode === "mirror" ? net.net.hcs.mirrorUrl : net.net.logs.mode === "mirror" ? net.net.logs.mirrorUrl : null;
      const r = await runStep(id, wizard, { eth: window.ethereum, chainId, provider: net.provider, build, wallet: address, mirrorUrl, onPhase: (label, p) => setPhase(`${label}: ${PHASE_TEXT[p]}`) }, extra);
      let next = r.out ? recordOutputs(wizard, r.out) : wizard;
      if (r.passed) next = completeStep(next, id, { txs: r.txs, note: r.note });
      update(next);
      setViews((v) => ({ ...v, [id]: { lines: r.lines, checks: r.checks, error: r.passed ? undefined : id === "audit" ? "At least one check failed: fix the cause, then run the checks again." : "The check did not pass yet." } }));
      if (r.passed && id === "audit") {
        const d = deploymentOf(next);
        if (d) saveDeployment(browserStore(), d);
      }
    } catch (e) {
      setViews((v) => ({ ...v, [id]: { error: plainError(e) } }));
    } finally {
      setBusy(null);
      setPhase(null);
    }
  };

  const txUrl = (h: string) => hashscan(net.net, "transaction", h);
  const finished = wizard ? isFinished(wizard) : false;
  const result = wizard && finished ? deploymentOf(wizard) : null;
  const mine = deployments.filter((d) => d.chainId === chainId);

  return (
    <>
      <PageHeading title="Issuer" action={<Tag tone={mode === "local" ? "neutral" : "warning"}>{mode === "local" ? "Local chain, mock tokens" : "Hedera testnet, NOT testnet-verified"}</Tag>}>
        Launch a new Faultline bond with your own wallet: terms, schedule, then each deployment and wiring step in order. Nothing changes in the contracts; this page deploys the repo build.
      </PageHeading>
      <div className="space-y-5">
        {mode === "testnet" ? (
          <Note tone="warning" title="Not testnet-verified">
            Nobody has launched a bond from this page on Hedera testnet yet. Every step mirrors a transaction the scripts ran in the full demo, but from a browser wallet it is unproven: the HCS topic and the HTS KYC grants run from ops/ instead. Production would use multisig keys, a 48 to 72 hour window and audited contracts.
          </Note>
        ) : (
          <Note tone="info" title="Local chain">
            Mock-tested only: MockBond stands in for the ATS bond and MockUSD for the HTS stablecoin, whose admin (the local deployer) signs the KYC steps.
          </Note>
        )}
        {(formError || buildError) && (
          <Note tone="error" title="Cannot prepare the form">
            {formError ?? buildError}
          </Note>
        )}

        {!terms || !schedule || !formParties ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <PartiesSection parties={formParties} onChange={(p) => formHere && setForm({ ...formHere, parties: p })} wallet={wizard ? wizard.inputs.parties.admin : address} mode={mode} locked={Boolean(wizard)} problems={partyProblems} />
            <TermsSection draft={terms} onChange={(t) => formHere && setForm({ ...formHere, terms: t })} chainId={chainId} riskStart={schedule.riskStart} locked={Boolean(wizard)} />
            <ScheduleSection draft={schedule} onChange={(s) => formHere && setForm({ ...formHere, schedule: s, terms: followRiskStart(formHere.terms, formHere.schedule.riskStart, s.riskStart) })} chainNow={formHere?.chainNow ?? Math.floor(Date.now() / 1000)} mode={mode} locked={Boolean(wizard)} onReset={() => setReloadForm((x) => x + 1)} />

            <Card title="Build to deploy" subtitle="Creation code bundled from the repo's artifacts/ when this dashboard was built (run npm run compile first). After each deployment the page reads the transaction back and compares.">
              {build ? (
                <DefinitionList
                  items={[
                    { term: `FaultlinePool (${build.pool.bytes.toLocaleString("en-US")} bytes)`, value: <Hex value={build.pool.keccak} full /> },
                    { term: `FaultlineTrigger (${build.trigger.bytes.toLocaleString("en-US")} bytes)`, value: <Hex value={build.trigger.keccak} full /> },
                    ...(mode === "local" ? [{ term: `MockBond (${build.mockBond.bytes.toLocaleString("en-US")} bytes, local only)`, value: <Hex value={build.mockBond.keccak} full /> }] : []),
                    ...(wizard?.out.initcodeKeccak?.pool ? [{ term: "Pool deployment carried", value: <span className={wizard.out.initcodeKeccak.pool === build.pool.keccak ? "text-success-800" : "text-error-700"}>{wizard.out.initcodeKeccak.pool === build.pool.keccak ? "the same code" : wizard.out.initcodeKeccak.pool}</span> }] : []),
                    ...(wizard?.out.initcodeKeccak?.trigger ? [{ term: "Trigger deployment carried", value: <span className={wizard.out.initcodeKeccak.trigger === build.trigger.keccak ? "text-success-800" : "text-error-700"}>{wizard.out.initcodeKeccak.trigger === build.trigger.keccak ? "the same code" : wizard.out.initcodeKeccak.trigger}</span> }] : []),
                  ]}
                />
              ) : (
                <Skeleton className="h-16 w-full" />
              )}
            </Card>

            {!wizard ? (
              <Card title="c. Launch">
                <div className="flex flex-wrap items-center gap-3">
                  {!address ? (
                    <Button variant="primary" onClick={connect} disabled={!available}>
                      {available ? "Sign in with wallet" : "No browser wallet found"}
                    </Button>
                  ) : walletChain !== chainId ? (
                    <Button variant="primary" onClick={() => void switchTo(net.net)}>
                      Switch wallet to chain {chainId}
                    </Button>
                  ) : (
                    <Button variant="primary" onClick={start} disabled={startProblems.length > 0}>
                      Start the launch
                    </Button>
                  )}
                  <span className="text-xs text-neutral-700">The inputs freeze when the launch starts.</span>
                </div>
                {address && startProblems.length > 0 && (
                  <ul className="mt-3 list-disc pl-5 text-xs text-neutral-800">
                    {startProblems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </Card>
            ) : (
              <>
                {!walletOnChain && <Note tone="warning" title="Wallet">{!address ? "Sign in with the admin wallet to continue." : `Switch the wallet to chain ${chainId} to continue.`}</Note>}
                {walletOnChain && !isAdmin && (
                  <Note tone="warning" title="Another wallet">
                    This launch belongs to {wizard.inputs.parties.admin}; connect that wallet to send its steps. Only the backup trustee step is signed by the trustee {wizard.inputs.parties.trustee}.
                  </Note>
                )}
                <LaunchSection
                  wizard={wizard}
                  views={views}
                  busy={busy}
                  phase={phase}
                  canSend={canSend}
                  walletOnChain={walletOnChain}
                  txUrl={txUrl}
                  onSkip={(id) => {
                    try {
                      update(skipStep(wizard, id, "skipped on this page"));
                    } catch (e) {
                      setViews((v) => ({ ...v, [id]: { error: plainError(e) } }));
                    }
                  }}
                  onRun={(id, extra) => void run(id, extra)}
                  onReset={() => {
                    update(null);
                    setViews({});
                  }}
                />
                {locked && !finished && <p className="text-xs text-neutral-700">Contracts already deployed stay on chain if you reset; this page then forgets them.</p>}
              </>
            )}
          </>
        )}

        {result && (
          <Card title="e. New deployment" subtitle="Saved in this browser under my deployments. Copy the entry for a config file or an oracle config." action={<Tag tone="success">Audit passed</Tag>}>
            <div className="space-y-3">
              <CodeBlock label="Deployment config entry" code={configEntry(result)} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  onClick={() => {
                    selectBond(browserStore(), chainId, result.id);
                    router.push("/");
                  }}
                >
                  Open this bond in the dashboard
                </Button>
                <Button
                  onClick={() => {
                    update(null);
                    setViews({});
                    setReloadForm((x) => x + 1);
                  }}
                >
                  Launch another bond
                </Button>
              </div>
            </div>
          </Card>
        )}

        <Card title="My deployments" subtitle="Bonds launched from this browser on this network. The header's Bond selector switches every view; the built-in bond stays the default.">
          {mine.length === 0 ? (
            <p className="text-sm text-neutral-700">None yet on chain {chainId}.</p>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {mine.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium text-neutral-900">{d.label}</div>
                    <div className="text-xs text-neutral-700">
                      trigger <Hex value={d.trigger} href={hashscan(net.net, "contract", d.trigger)} />, pool <Hex value={d.pool} href={hashscan(net.net, "contract", d.pool)} />
                      {d.topicId && <>, topic {d.topicId}</>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button onClick={() => selectBond(browserStore(), chainId, d.id)} disabled={net.deployment?.id === d.id}>
                      {net.deployment?.id === d.id ? "Shown" : "Show"}
                    </Button>
                    <Button variant="danger" onClick={() => removeDeployment(browserStore(), d.id)}>
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
