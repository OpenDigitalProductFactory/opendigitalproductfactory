// The owner-facing attention preview on /workspace. Raw queue records stay in
// their source systems; this component renders the shared owner projection.

import Link from "next/link";
import { prisma } from "@dpf/db";

import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { buildOwnerAttentionProjection, type OwnerAttentionProjection } from "@/lib/attention/owner-projection";
import type { OwnerDecisionAudience } from "@/lib/attention/owner-decision";
import type { AttentionSource } from "@/lib/attention/types";
import { OwnerDecisionCards } from "@/components/attention/OwnerDecisionCards";
import {
  DigitalTeamHandlingStrip,
  OwnerAttentionCount,
} from "@/components/attention/OwnerAttentionStatus";

const PREVIEW_LIMIT = 3;

function CockpitShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-6 overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
      <header className="flex items-center gap-3 border-b border-[var(--dpf-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">What needs you now</h2>
        <Link
          href="/workspace/inbox"
          className="ml-auto text-xs font-medium text-[var(--dpf-accent)] hover:opacity-80"
        >
          Open full inbox →
        </Link>
      </header>
      {children}
    </section>
  );
}

export function OperatorCockpitView({
  projection,
  failedSources,
}: {
  projection: OwnerAttentionProjection;
  failedSources: AttentionSource[];
}) {
  const overflow = Math.max(0, projection.count - PREVIEW_LIMIT);
  return (
    <CockpitShell>
      <div className="space-y-4 p-4">
        <div>
          <OwnerAttentionCount count={projection.count} />
          {projection.count === 0 ? (
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">Nothing needs you right now.</p>
          ) : (
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--dpf-muted)]">
              These are business choices your digital team cannot make safely. Technical work stays
              with your specialists unless it creates a decision for you.
            </p>
          )}
        </div>

        {projection.count > 0 ? (
          <>
            <OwnerDecisionCards entries={projection.needsYouNow} limit={PREVIEW_LIMIT} />
            {overflow > 0 ? (
              <Link
                href="/workspace/inbox"
                className="inline-flex text-xs font-semibold text-[var(--dpf-accent)] hover:opacity-80"
              >
                Review {overflow} more {overflow === 1 ? "decision" : "decisions"} →
              </Link>
            ) : null}
          </>
        ) : null}

        <DigitalTeamHandlingStrip
          custodianCount={projection.custodian.length}
          digestCount={projection.weeklyDigest.length}
        />

        {failedSources.length > 0 ? (
          <p className="text-xs text-[var(--dpf-warning)]">
            Some decision sources could not be checked. Everything available is shown.
          </p>
        ) : null}
      </div>
    </CockpitShell>
  );
}

export async function OperatorCockpit({
  userId,
  audience = "operator",
}: {
  userId?: string;
  /** Simple/Full rail mode — see OwnerDecisionAudience (BI-90B6D8C5). */
  audience?: OwnerDecisionAudience;
}) {
  const { items, failedSources } = await loadAttentionItems(prisma, {
    aiReadinessUserId: userId,
    delegatingUserId: userId,
  });
  const visible = filterAttentionForAudience(items, { operator: true });
  const projection = buildOwnerAttentionProjection(visible, {
    fallbackLevel: "balanced",
    nowMs: Date.now(),
    audience,
  });
  return <OperatorCockpitView projection={projection} failedSources={failedSources} />;
}
