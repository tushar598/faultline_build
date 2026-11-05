"use client";
import { Activity, FileCheck2, FilePlus2, LayoutDashboard, ShieldCheck, Wallet, Landmark } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NetworkSwitch } from "./NetworkSwitch";

const NAV = [
  { href: "/", label: "Overview", Icon: LayoutDashboard },
  { href: "/investor", label: "Investor", Icon: Wallet },
  { href: "/sponsor", label: "Sponsor", Icon: Landmark },
  { href: "/trustee", label: "Trustee", Icon: ShieldCheck },
  { href: "/replay", label: "Quake replay", Icon: Activity },
  { href: "/evidence", label: "Evidence", Icon: FileCheck2 },
  { href: "/issuer", label: "Issuer", Icon: FilePlus2 },
] as const;

/** Left navigation in the ATS layout: light neutral rail, active item in semibold on a darker tint. */
export function Sidebar() {
  const path = usePathname();
  return (
    <aside className="flex w-full flex-col border-b border-neutral-200 bg-neutral-50 md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
      <div className="flex h-16 items-center gap-2.5 border-b border-neutral-200 px-5">
        <svg aria-hidden viewBox="0 0 24 24" className="size-6 text-accent-600" fill="none" stroke="currentColor" strokeWidth="1.75">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 14h5l2-4 3 7 2-3h6" />
        </svg>
        <div>
          <div className="text-sm font-semibold text-neutral-900">Faultline</div>
          <div className="text-[11px] text-neutral-700">Parametric quake bond</div>
        </div>
      </div>
      <nav aria-label="Views" className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible md:p-3">
        {NAV.map(({ href, label, Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm ${active ? "bg-neutral-200 font-semibold text-neutral-900" : "text-neutral-800 hover:bg-neutral-100"}`}
            >
              <Icon aria-hidden className="size-4" strokeWidth={1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden border-t border-neutral-200 p-3 md:block">
        <NetworkSwitch />
      </div>
    </aside>
  );
}
