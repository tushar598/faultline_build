"use client";
import { Card } from "@/components/ui/Card";
import { Note } from "@/components/ui/Notes";
import type { IssuerMode, Parties } from "@/lib/issuer/wizard";
import { Field } from "./Field";

/** The form's view of the parties: investors as typed (one per line), the admin taken from the wallet. */
export type FormParties = Omit<Parties, "admin" | "investors"> & { investorsText: string };
export const investorsOf = (text: string) => text.split(/[\s,]+/).filter(Boolean);

/** Who is who in the new bond. The admin is always the connected wallet: it deploys and wires everything. */
export function PartiesSection({ parties, onChange, wallet, mode, locked, problems }: { parties: FormParties; onChange: (p: FormParties) => void; wallet: string | null; mode: IssuerMode; locked: boolean; problems: string[] }) {
  const set = (patch: Partial<FormParties>) => onChange({ ...parties, ...patch });
  return (
    <Card title="Parties and tokens" subtitle="Public addresses only. Investor KYC uses an opaque credential id; no personal data goes on chain.">
      <fieldset disabled={locked} className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field id="p-admin" label="Admin (the connected wallet)" value={wallet ?? "Sign in with your wallet"} onChange={() => undefined} disabled mono hint="Gets DEFAULT_ADMIN_ROLE on the pool and the trigger, signs every wallet step." />
          <Field id="p-sponsor" label="Sponsor" value={parties.sponsor} onChange={(v) => set({ sponsor: v.trim() })} mono hint="Funds the coupon reserve; receives collateral on a write-down." />
          <Field id="p-oracle" label="Oracle signer" value={parties.oracle} onChange={(v) => set({ oracle: v.trim() })} mono hint="Signs attestations (EIP-712); needs no HBAR (D16)." />
          <Field id="p-trustee" label="Trustee" value={parties.trustee} onChange={(v) => set({ trustee: v.trim() })} mono hint="Vetoes inside the window and pauses the trigger." />
          <Field id="p-backup" label="Backup trustee (optional)" value={parties.backupTrustee ?? ""} onChange={(v) => set({ backupTrustee: v.trim() })} mono hint="Granted TRUSTEE_ROLE by the trustee wallet after the trigger deploy (D17). Leave empty to skip." />
          <Field id="p-stable" label="Stablecoin (6 decimals)" value={parties.stablecoin} onChange={(v) => set({ stablecoin: v.trim() })} mono hint={mode === "testnet" ? "HTS token facade address (long-zero form)." : "The local MockUSD (read from the built-in local bond)."} />
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field id="p-name" label="Bond name" value={parties.bondName} onChange={(v) => set({ bondName: v })} />
            <Field id="p-symbol" label="Symbol" value={parties.bondSymbol} onChange={(v) => set({ bondSymbol: v.toUpperCase() })} />
          </div>
          {mode === "testnet" && (
            <>
              <Field id="p-payer" label="HCS topic payer (relayer)" value={parties.topicPayer} onChange={(v) => set({ topicPayer: v.trim() })} mono hint="Pays and auto-renews the topic (D16); used in the ops/ command." />
              <Field id="p-kyc" label="Stablecoin KYC key holder" value={parties.kycKeyHolder} onChange={(v) => set({ kycKeyHolder: v.trim() })} mono hint="The account whose key is the token's KYC key; used in the ops/ command." />
            </>
          )}
        </div>
        <div>
          <label htmlFor="p-investors" className="mb-1 block text-xs font-medium text-neutral-800">
            Investors to KYC (one address per line, optional)
          </label>
          <textarea
            id="p-investors"
            rows={3}
            spellCheck={false}
            value={parties.investorsText}
            onChange={(e) => set({ investorsText: e.target.value })}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 font-mono text-xs text-neutral-900 outline-none focus:border-accent-500 disabled:text-neutral-700"
          />
        </div>
        {!locked && problems.length > 0 && (
          <Note tone="warning" title="Before the launch can start">
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Note>
        )}
      </fieldset>
    </Card>
  );
}
