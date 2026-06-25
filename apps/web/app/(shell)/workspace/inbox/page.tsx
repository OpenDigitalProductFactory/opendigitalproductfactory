// /workspace/inbox — the "Needs you" attention queue (full view).
// EP-ATTENTION-SURFACE keystone (BI-D39484E7). A workspace-section sibling, so no
// cross-rail teleport (EP-NAV-COHERENCE). Spec §6.
import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { loadAttentionItems, filterAttentionForAudience } from "@/lib/attention/aggregate";
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

  const { items, failedSources } = await loadAttentionItems(prisma);
  // V1 operator-view; worker scoping (own approvals only) is BI-AS-4.
  const visible = filterAttentionForAudience(items, { operator: true });

  return (
    <main className="space-y-4 text-[var(--dpf-text)]">
      <div>
        <h1 className="text-lg font-semibold">Needs you</h1>
        <p className="mt-1 max-w-prose text-sm text-[var(--dpf-muted)]">
          Decisions routed to you after the governed scopes couldn&apos;t resolve them — escalations,
          approvals, paused coworkers — ordered by what&apos;s most pressing, each with why it needs
          you. The work backlog lives in Operations.
        </p>
      </div>
      <AttentionInbox items={visible} failedSources={failedSources} nowMs={Date.now()} />
    </main>
  );
}
