import { formatAmount, shortHex } from "@/lib/format";
import type { HolderRow } from "@/lib/chain";
import { AnimatedNumber } from "../motion/AnimatedNumber";
import { EmptyState } from "../ui/Notes";

const usd = (v: bigint) => formatAmount(v);

/** Every address that ever held units: the ATS balance (unchanged by a write-down) next to the effective value. */
export function HoldersTable({ rows, highlight, lossBps }: { rows: HolderRow[]; highlight?: string | null; lossBps: number }) {
  if (rows.length === 0) return <EmptyState>No holders yet. Units appear here after the first invest().</EmptyState>;
  const total = rows.reduce((t, r) => ({ ats: t.ats + r.bondBalance, p: t.p + r.principal, c: t.c + r.coupon }), { ats: 0n, p: 0n, c: 0n });
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" className="px-5 py-2 text-left font-medium">Holder</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">ATS balance (units)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Principal value (USD)</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Accrued coupon (USD)</th>
            <th scope="col" className="px-5 py-2 text-right font-medium">Effective value (USD)</th>
          </tr>
        </thead>
        <tbody className="num divide-y divide-neutral-100">
          {rows.map((r) => (
            <tr key={r.address} className={r.address === highlight ? "bg-accent-50" : "hover:bg-neutral-50"}>
              <td className="px-5 py-2 font-mono text-xs" title={r.address}>
                {shortHex(r.address)}
                {r.address === highlight && <span className="ml-2 font-sans text-xs font-medium text-accent-800">You</span>}
              </td>
              <td className="px-3 py-2 text-right">{formatAmount(r.bondBalance)}</td>
              <td className="px-3 py-2 text-right">
                <AnimatedNumber value={r.principal} format={usd} />
              </td>
              <td className="px-3 py-2 text-right">
                <AnimatedNumber value={r.coupon} format={usd} />
              </td>
              <td className="px-5 py-2 text-right font-semibold">
                <AnimatedNumber value={r.principal + r.coupon} format={usd} />
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="num border-t border-neutral-200 text-neutral-900">
          <tr>
            <th scope="row" className="px-5 py-2 text-left text-xs font-medium text-neutral-700">
              Total, at L = {lossBps.toLocaleString("en-US")} bps
            </th>
            <td className="px-3 py-2 text-right font-medium">{formatAmount(total.ats)}</td>
            <td className="px-3 py-2 text-right font-medium">{formatAmount(total.p)}</td>
            <td className="px-3 py-2 text-right font-medium">{formatAmount(total.c)}</td>
            <td className="px-5 py-2 text-right font-semibold">{formatAmount(total.p + total.c)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
