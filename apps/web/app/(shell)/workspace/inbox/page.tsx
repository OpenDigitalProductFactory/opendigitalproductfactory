// /workspace/inbox — the "Needs you" attention queue (full view).
// EP-ATTENTION-SURFACE keystone (BI-D39484E7). A workspace-section sibling, so no
// cross-rail teleport (EP-NAV-COHERENCE). Spec §6.
import { prisma } from "@dpf/db";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
import { buildOwnerAttentionProjection } from "@/lib/attention/owner-projection";
import { buildWeeklyDigest } from "@/lib/attention/weekly-digest";
import { loadWeeklyDigestDisposition } from "@/lib/attention/weekly-digest-preferences";
import { runEscalationHygiene } from "@/lib/quality/escalation-hygiene-runner";
import { AttentionInbox } from "@/components/attention/AttentionInbox";

export const dynamic = "force-dynamic";

export default async function WorkspaceInboxPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Best-effort auto-resolve so settled escalations clear when the inbox is viewed
  // (re-homed from /ops with the band; the 15-min cron still covers it). Idempotent,
  // zero-write once converged.
  await runEscalationHygiene().catch(() => {});

  const { items, failedSources } = await loadAttentionItems(prisma, {
    aiReadinessUserId: session.user.id,
    delegatingUserId: session.user.id,
  });
  // V1 operator-view; worker scoping (own approvals only) is BI-AS-4.
  const visible = filterAttentionForAudience(items, { operator: true });
  const nowMs = Date.now();
  // Simple/Full decides whether a card's real action can be its own button: in
  // Full the reader asked to see builder and platform tools, so a builder-rail
  // action IS the honest primary action (BI-90B6D8C5).
  const audience = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  const projection = buildOwnerAttentionProjection(visible, {
    fallbackLevel: "balanced",
    nowMs,
    audience: audience === "worker" ? "worker" : "operator",
  });
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
      <AttentionInbox
        projection={projection}
        failedSources={failedSources}
        nowMs={nowMs}
        digestDisposition={digestDisposition}
      />
    </main>
  );
}
