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

export function AttentionInbox({
  projection,
  failedSources,
  nowMs = Date.now(),
  digestDisposition = null,
}: {
  projection: OwnerAttentionProjection;
  failedSources: AttentionSource[];
  nowMs?: number;
  digestDisposition?: WeeklyDigestDisposition | null;
}) {
  return (
    <div className="space-y-4">
      {failedSources.length > 0 ? (
        <p className="rounded-md border border-[var(--dpf-warning)] bg-[var(--dpf-surface-2)] px-4 py-3 text-xs text-[var(--dpf-muted)]">
          Some decision sources could not be checked. Everything available is shown.
        </p>
      ) : null}

      <div>
        <OwnerAttentionCount count={projection.count} />
        {projection.count === 0 ? (
          <div className="mt-2">
            <OwnerAllCaughtUp
              handlingCount={projection.custodian.length}
              examples={projection.custodian.slice(0, 3).map((entry) => entry.card.headline)}
            />
          </div>
        ) : (
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--dpf-muted)]">
            Review the business choices below. Open technical detail only when a builder or your
            digital team needs the original record.
          </p>
        )}
      </div>

      {projection.count > 0 ? <OwnerDecisionCards entries={projection.needsYouNow} /> : null}

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
