// Full owner attention queue on /workspace/inbox. The same owner projection and
// decision cards power the workspace preview, so counts and language cannot drift.

import type { OwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { AttentionSource } from "@/lib/attention/types";
import type { WeeklyDigestDisposition } from "@/lib/attention/weekly-digest-preferences";
import { OwnerDecisionCards } from "./OwnerDecisionCards";
import {
  DigitalTeamHandlingStrip,
  OwnerAllCaughtUp,
  OwnerAttentionCount,
} from "./OwnerAttentionStatus";
import { WeeklyDigestPanel } from "./WeeklyDigestPanel";
import Link from "next/link";

export function AttentionInbox({
  projection,
  failedSources,
  nowMs = Date.now(),
  digestDisposition = null,
  focusItemId,
  approvalQueue,
}: {
  projection: OwnerAttentionProjection;
  failedSources: AttentionSource[];
  nowMs?: number;
  digestDisposition?: WeeklyDigestDisposition | null;
  /** The card an approval deep link asked for (BI-0012E6CA). */
  focusItemId?: string;
  approvalQueue?: { total: number; shown: number; nextCursor: string | null; browsingOlder: boolean } | null;
}) {
  return (
    <div className="space-y-4">
      {failedSources.length > 0 ? (
        <p className="rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-4 py-3 text-xs text-[var(--dpf-muted)]">
          Some decision sources could not be checked. Everything available is shown.
        </p>
      ) : null}

      <div>
        <OwnerAttentionCount count={projection.count} displayed />
        {approvalQueue ? (
          <div className="mt-2 space-y-2 text-sm text-[var(--dpf-text)]">
            <p>{approvalQueue.total} pending {approvalQueue.total === 1 ? "approval" : "approvals"}; {approvalQueue.shown} shown.</p>
            <p className="text-xs text-[var(--dpf-muted)]">Older requests replace completed ones. Other notices: {projection.needsYouNow.filter(entry => !entry.item.envelope).length}.</p>
            <div className="flex gap-4 text-[var(--dpf-accent)]">
              {approvalQueue.browsingOlder ? <Link href="/workspace/inbox">Latest requests</Link> : null}
              {approvalQueue.nextCursor ? <Link href={`/workspace/inbox?approvalsBefore=${encodeURIComponent(approvalQueue.nextCursor)}`}>Older requests</Link> : null}
            </div>
          </div>
        ) : approvalQueue === null ? <p className="mt-2 text-sm text-[var(--dpf-warning)]">Approvals unavailable. <Link href="/workspace/inbox" className="underline">Latest requests</Link></p> : null}
        {projection.count === 0 && failedSources.length === 0 && !(approvalQueue && approvalQueue.total > 0) ? (
          <div className="mt-2">
            <OwnerAllCaughtUp
              handlingCount={projection.custodian.length}
              examples={projection.custodian.slice(0, 3).map((entry) => entry.card.headline)}
            />
          </div>
        ) : null}
      </div>

      {projection.count > 0 ? <OwnerDecisionCards entries={projection.needsYouNow} focusItemId={focusItemId} /> : null}

      <DigitalTeamHandlingStrip
        custodianCount={projection.count === 0 ? 0 : projection.custodian.length}
        digestCount={digestDisposition ? 0 : projection.weeklyDigest.length}
      />

      <WeeklyDigestPanel
        entries={projection.weeklyDigest}
        nowMs={nowMs}
        initialDisposition={digestDisposition}
      />
    </div>
  );
}
