import { CheckCircle2, XCircle } from "lucide-react";
import { formatAmount, formatUnits } from "@/lib/format";
import type { BondSnapshot } from "@/lib/types";
import { AnimatedNumber } from "../motion/AnimatedNumber";
import { Stat } from "../ui/Stat";

const usd = (v: bigint) => formatAmount(v);

/** The pool's books (FaultlinePool views). collateralLeft and couponReserveLeft are bookkeeping views (§3.3). */
export function PoolTotals({ s }: { s: BondSnapshot }) {
  const b = s.books;
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
      <Stat label="Collateral left" value={<AnimatedNumber value={b.collateralLeft} format={usd} />} unit="USD" hint="Units issued minus sponsor credit minus principal paid" />
      <Stat label="Coupon reserve left" value={<AnimatedNumber value={b.couponReserveLeft} format={usd} />} unit="USD" hint={`Funded ${formatAmount(b.couponReserve)} USD, paid ${formatAmount(b.couponPaid)} USD`} />
      <Stat label="Claimable (all accounts)" value={<AnimatedNumber value={b.totalClaimable} format={usd} />} unit="USD" hint="Credited, waiting for claim()" />
      <Stat
        label="Solvency"
        value={
          b.isSolvent ? (
            <span className="inline-flex items-center gap-1.5 text-success-800">
              <CheckCircle2 aria-hidden className="size-4" /> Solvent
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-error-700">
              <XCircle aria-hidden className="size-4" /> Not solvent
            </span>
          )
        }
        hint="isSolvent(): balance covers everything owed"
      />
      <Stat label="Units issued" value={formatUnits(b.unitsIssued)} hint={`Cap ${formatUnits(s.terms.cap)}`} />
      <Stat label="Sponsor credited" value={<AnimatedNumber value={b.sponsorCredited} format={usd} />} unit="USD" hint="floor(units issued x L / 10,000)" />
      <Stat label="Pool stablecoin balance" value={<AnimatedNumber value={b.poolBalance} format={usd} />} unit="USD" hint={`Stablecoin: ${s.symbols.stablecoin || "symbol not reported"}, 6 decimals, 1 unit = 1 USD`} />
      <Stat label="Bond supply (ATS)" value={formatUnits(b.bondSupply)} hint={`Redeemed ${formatUnits(b.unitsRedeemed)}`} />
    </div>
  );
}
