import { normalizeInitiativeGate as normalizeGate } from "./receipt-validation";

/**
 * BI-4592CF69: which design a design-bound gate judges.
 *
 * Design reviews are routed to the Workroom head (BI-D3E1F6D9): a reviewer
 * reads the design that is there, and the receipt writer refuses a locator the
 * head does not carry. Readiness used to judge every receipt against the
 * baseline digest instead. So once the spec changed after approval, even with
 * an identical OBJ/AC manifest, every receipt the routes produced read stale,
 * and the routes kept asking for the same reviews again (BI-D4BB5AE3).
 *
 * The rule here is the single answer both sides follow:
 *
 * - With no newer design receipt, the gates judge the baselined design.
 * - When the newest design-bound receipt recorded after the baseline names a
 *   different design, the design was amended. The gates judge that amended
 *   design, which is the head the routes named. The baseline stays where it
 *   is, and the amendment owes spec approval again (BI-7531B73C). That approval
 *   is the only door that re-binds the baseline: the supersession writer still
 *   demands a disposition for every changed OBJ/AC statement. So no gate is
 *   weakened. A changed manifest is still owed its review, and an unchanged one
 *   still owes the reviewer's approval of the new bytes.
 * - When the newest receipt names the baselined design again (its bytes were
 *   restored at the head), the amendment is over.
 *
 * Plan reviews bind the plan, so they never count.
 */
export type JudgedDesign = {
  baselineDigest: string | null;
  judgedDigest: string | null;
  amended: boolean;
};

type ActivityLike = {
  id: string;
  kind: string;
  gateKey: string | null;
  recordedAt: Date;
  payload: unknown;
};

function receiptDigest(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const digest = (payload as Record<string, unknown>).artifactDigest;
  return typeof digest === "string" ? digest : null;
}

export function judgedDesignDigest(args: {
  baseline: { artifactDigest: string; recordedAt: Date } | null;
  activities: readonly ActivityLike[];
  planDigest: string | null;
}): JudgedDesign {
  const baseline = args.baseline;
  if (!baseline) return { baselineDigest: null, judgedDigest: null, amended: false };
  const newest = args.activities
    .filter((activity) => activity.kind === "initiative_gate_receipt"
      && activity.recordedAt > baseline.recordedAt
      && normalizeGate(activity.gateKey) !== "plan-review")
    .map((activity) => ({ activity, digest: receiptDigest(activity.payload) }))
    .filter((entry): entry is { activity: ActivityLike; digest: string } =>
      entry.digest !== null && entry.digest !== args.planDigest)
    .sort((left, right) => right.activity.recordedAt.getTime() - left.activity.recordedAt.getTime()
      || right.activity.id.localeCompare(left.activity.id))[0];
  const amended = Boolean(newest) && newest!.digest !== baseline.artifactDigest;
  return {
    baselineDigest: baseline.artifactDigest,
    judgedDigest: amended ? newest!.digest : baseline.artifactDigest,
    amended,
  };
}
