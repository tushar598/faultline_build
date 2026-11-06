import { hashscan, type NetworkConfig } from "@/config/networks";
import { describeLog } from "@/lib/describe";
import type { LogEntry } from "@/lib/types";
import { Hex } from "../ui/Hex";
import { EmptyState } from "../ui/Notes";
import { Timestamp } from "../ui/Timestamp";

/** Newest first; every row is one on-chain log. */
export function ActivityTable({ logs, net, names, limit = 12, filter }: { logs: LogEntry[]; net: NetworkConfig; names: Map<string, string>; limit?: number; filter?: (l: LogEntry) => boolean }) {
  const rows = logs.filter((l) => (filter ? filter(l) : l.contract !== "bond")).slice(-limit).reverse();
  if (rows.length === 0) return <EmptyState>No on-chain activity for this bond yet.</EmptyState>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-neutral-200 text-xs text-neutral-700">
          <tr>
            <th scope="col" className="px-5 py-2 font-medium">Time (IST)</th>
            <th scope="col" className="px-3 py-2 font-medium">Event</th>
            <th scope="col" className="px-3 py-2 font-medium">Details</th>
            <th scope="col" className="px-5 py-2 font-medium">Transaction</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((l) => (
            <tr key={`${l.txHash}-${l.logIndex}`} className="hover:bg-neutral-50">
              <td className="px-5 py-2 align-top whitespace-nowrap text-xs text-neutral-800">{l.timestamp !== null ? <Timestamp unix={l.timestamp} /> : `block ${l.blockNumber}`}</td>
              <td className="px-3 py-2 align-top font-medium whitespace-nowrap text-neutral-900">{l.name}</td>
              <td className="num px-3 py-2 align-top text-neutral-800">{describeLog(l, names)}</td>
              <td className="px-5 py-2 align-top whitespace-nowrap">
                <Hex value={l.txHash} href={hashscan(net, "transaction", l.txHash)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
