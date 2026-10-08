// /workspace/inbox — the "Needs you" attention queue (full view).
// EP-ATTENTION-SURFACE keystone (BI-D39484E7). A workspace-section sibling, so no
// cross-rail teleport (EP-NAV-COHERENCE). Spec §6.
import { prisma } from "@dpf/db";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { buildOwnerAttentionProjection, pinOwnerAttentionEntry } from "@/lib/attention/owner-projection";
import { buildWeeklyDigest } from "@/lib/attention/weekly-digest";
import { loadWeeklyDigestDisposition } from "@/lib/attention/weekly-digest-preferences";
import { runEscalationHygiene } from "@/lib/quality/escalation-hygiene-runner";
import { AttentionInbox } from "@/components/attention/AttentionInbox";
import { ApprovalOutcomeHistory } from "@/components/attention/ApprovalOutcomeHistory";
import { loadApprovalOutcomes } from "@/lib/coworker/approval-outcome-store";
import { loadCoworkerEnvelopeItems } from "@/lib/attention/sources/coworker-envelope";
import { envelopeAttentionItemId } from "@/lib/coworker/envelope-routes";
import { getT } from "@/lib/i18n/t.server";

export const dynamic = "force-dynamic";

export default async function WorkspaceInboxPage({ searchParams }: { searchParams: Promise<{ approval?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const requested = (await searchParams).approval;
  const approvalId = typeof requested === "string" && requested.length <= 128 ? requested : undefined;
  const t = await getT("approvals");
  const outcomes = (await loadApprovalOutcomes(session.user.id, approvalId)).map((outcome) => ({
    ...outcome, label: t(`states.${outcome.state}.label`), nextAction: t(outcome.nextActionKey),
  }));
  const outcomeCopy = { result: t("result"), recent: t("recent"), unavailable: t("unavailable"), details: t("details"), open: t("open") };

  // Best-effort auto-resolve so settled escalations clear when the inbox is viewed
  // (re-homed from /ops with the band; the 15-min cron still covers it). Idempotent,
  // zero-write once converged.
  await runEscalationHygiene().catch(() => {});

  const { items, failedSources } = await loadAttentionItems(prisma, {
    aiReadinessUserId: session.user.id,
    delegatingUserId: session.user.id,
    readerIsSuperuser: session.user.isSuperuser === true,
  });
  // An exact approval link remains usable even outside the most recent 25.
  const focusItemId = approvalId ? envelopeAttentionItemId(approvalId) : undefined;
  if (approvalId && !items.some((item) => item.id === focusItemId)) {
    items.push(...await loadCoworkerEnvelopeItems(prisma, session.user.id, Date.now(), approvalId));
  }
  // V1 operator-view; worker scoping (own approvals only) is BI-AS-4.
  const visible = filterAttentionForAudience(items, { operator: true });
  const nowMs = Date.now();
  // Simple/Full decides whether a card's real action can be its own button: in
  // Full the reader asked to see builder and platform tools, so a builder-rail
  // action IS the honest primary action (BI-90B6D8C5).
  const audience = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  // A deep link names one card; pin it into the visible lane even when routing
  // would have batched it (an expired request waits in the weekly review).
  const projection = pinOwnerAttentionEntry(buildOwnerAttentionProjection(visible, {
    fallbackLevel: "balanced",
    nowMs,
    audience: audience === "worker" ? "worker" : "operator",
  }), focusItemId);
  const digest = buildWeeklyDigest(projection.weeklyDigest, nowMs);
  const digestDisposition =
    digest.status === "ready"
      ? await loadWeeklyDigestDisposition(prisma, session.user.id, digest.reviewOnIso)
      : null;

  return (
    <main className="space-y-4 text-[var(--dpf-text)]">
      <div>
        <h1 className="text-lg font-semibold">What needs you now</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--dpf-muted)]">
          Business choices only, written in plain language. Your digital team keeps technical recovery
          and low-urgency review out of today&apos;s count. The work backlog stays in Operations.
        </p>
      </div>
      {approvalId ? <ApprovalOutcomeHistory outcomes={outcomes} copy={outcomeCopy} exact /> : null}
      <AttentionInbox
        projection={projection}
        failedSources={failedSources}
        nowMs={nowMs}
        digestDisposition={digestDisposition}
        focusItemId={focusItemId}
      />
      {!approvalId ? <ApprovalOutcomeHistory outcomes={outcomes} copy={outcomeCopy} /> : null}
    </main>
  );
}
