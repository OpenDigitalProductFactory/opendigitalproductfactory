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
  approvalCopy,
}: {
  projection: OwnerAttentionProjection;
  failedSources: AttentionSource[];
  nowMs?: number;
  digestDisposition?: WeeklyDigestDisposition | null;
  /** The card an approval deep link asked for (BI-0012E6CA). */
  focusItemId?: string;
  approvalQueue?: { total: number; shown: number; nextCursor: string | null; browsingOlder: boolean } | null;
  approvalCopy?: { displayedCount: string; summary: string; explanation: string; latest: string; older: string; unavailable: string };
}) {
  return (
    <div className="space-y-4">
      {failedSources.length > 0 ? (
        <p className="rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-4 py-3 text-xs text-[var(--dpf-muted)]">
          Some decision sources could not be checked. Everything available is shown.
        </p>
      ) : null}

      <div>
        <OwnerAttentionCount count={projection.count} label={approvalCopy?.displayedCount} />
        {approvalQueue && approvalCopy ? (
          <div className="mt-2 space-y-2 text-sm text-[var(--dpf-text)]">
            <p>{approvalCopy.summary}</p>
            <p className="text-xs text-[var(--dpf-muted)]">{approvalCopy.explanation}</p>
            <div className="flex gap-4 text-[var(--dpf-accent)]">
              {approvalQueue.browsingOlder ? <Link href="/workspace/inbox">{approvalCopy.latest}</Link> : null}
              {approvalQueue.nextCursor ? <Link href={`/workspace/inbox?approvalsBefore=${encodeURIComponent(approvalQueue.nextCursor)}`}>{approvalCopy.older}</Link> : null}
            </div>
          </div>
        ) : approvalQueue === null && approvalCopy ? <p className="mt-2 text-sm text-[var(--dpf-warning)]">{approvalCopy.unavailable} <Link href="/workspace/inbox" className="underline">{approvalCopy.latest}</Link></p> : null}
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
