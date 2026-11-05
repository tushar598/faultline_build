import { CheckCircle2, XCircle } from "lucide-react";
import { Tag } from "../ui/Tag";

/** D16: does the in-payload signature recover to trigger.oracle()? */
export function SignedCheck({ ok }: { ok: boolean | null }) {
  if (ok === null) return <Tag tone="neutral">Signature not checked</Tag>;
  return ok ? (
    <Tag tone="success" title="The in-payload signature recovers to trigger.oracle()">
      <CheckCircle2 aria-hidden className="size-3" /> Signed by oracle
    </Tag>
  ) : (
    <Tag tone="error" title="The in-payload signature does not recover to trigger.oracle()">
      <XCircle aria-hidden className="size-3" /> Not signed by the current oracle
    </Tag>
  );
}
