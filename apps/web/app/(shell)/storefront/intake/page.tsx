import { notFound } from "next/navigation";

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  resolvePrincipalIdForUser,
  syncUserPrincipal,
} from "@/lib/identity/principal-linking";
import { listCareIntakeReviewQueue } from "@/lib/healthcare/care-intake-review-repository";
import {
  EmptyState,
  Notice,
  StatCard,
  StatusBadge,
} from "@/components/ui/report-kit";

import {
  formatAppointmentTime,
  formatIntakeBlocker,
  formatSourceMode,
  summarizeIntakeQueue,
} from "./intake-queue-view";

export const dynamic = "force-dynamic";

function severityIntent(severity: string): "danger" | "warning" | "info" | "neutral" {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "medium") return "warning";
  if (severity === "low") return "info";
  return "neutral";
}

export default async function CareIntakeQueuePage() {
  const session = await auth();
  if (
    !session?.user
    || session.user.type !== "admin"
    || !can(
      { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
      "view_customer",
    )
  ) {
    notFound();
  }

  const [organization, config] = await Promise.all([
    prisma.organization.findFirst({ select: { id: true } }),
    prisma.storefrontConfig.findFirst({
      select: { archetype: { select: { category: true } } },
    }),
  ]);

  if (config?.archetype?.category !== "healthcare-wellness") {
    return (
      <Notice title="Healthcare intake is not active">
        This workspace is available when the storefront uses a healthcare or dental practice archetype.
      </Notice>
    );
  }

  if (!organization) {
    return (
      <Notice variant="error" title="Staff identity is not ready">
        The intake queue could not establish an organization-bound staff identity. Ask an administrator to finish workforce identity setup.
      </Notice>
    );
  }

  const actorPrincipalId = await resolvePrincipalIdForUser(session.user.id)
    ?? (await syncUserPrincipal(session.user.id).catch(() => null))?.principalId
    ?? null;

  if (!actorPrincipalId) {
    return (
      <Notice variant="error" title="Staff identity is not ready">
        The intake queue could not establish an organization-bound staff identity. Ask an administrator to finish workforce identity setup.
      </Notice>
    );
  }

  const { items } = await listCareIntakeReviewQueue({
    organizationId: organization.id,
    actorPrincipalId,
    limit: 50,
  });
  const summary = summarizeIntakeQueue(items);

  return (
    <main className="space-y-5" aria-labelledby="intake-heading">
      <header>
        <h2 id="intake-heading" className="text-base font-bold text-[var(--dpf-text)]">
          Patient intake
        </h2>
        <p className="mt-1 max-w-3xl text-xs text-[var(--dpf-muted)]">
          Check visit readiness and resolve front-desk exceptions. Clinical answers are not shown in this workspace.
        </p>
      </header>

      <section aria-label="Intake summary" className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Needs attention" value={summary.needsAttention} intent={summary.needsAttention ? "warning" : "neutral"} hint="Open exceptions" />
        <StatCard label="In progress" value={summary.inProgress} intent="info" hint="Waiting on intake steps" />
        <StatCard label="Ready" value={summary.ready} intent="success" hint="No readiness blockers" />
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="No active intake packets"
          description="Assigned, in-progress, and amended patient intake will appear here."
          icon="✓"
        />
      ) : (
        <section aria-label="Active patient intake" className="space-y-3">
          {items.map((item) => (
            <article
              key={item.packetId}
              className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold text-[var(--dpf-text)]">
                    Patient {item.patientReference}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                    {item.appointmentLinked ? "Linked to a scheduled visit" : "No visit linked"}
                  </p>
                </div>
                <StatusBadge
                  intent={item.ready ? "success" : item.openExceptions.length ? "warning" : "info"}
                  label={item.ready ? "Ready" : item.openExceptions.length ? "Needs attention" : "In progress"}
                />
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--dpf-muted)]">
                <span>{item.completionPercent}% complete</span>
                <span>{item.sourceModes.map(formatSourceMode).join(", ")}</span>
                {item.dueAt ? <span>Due {formatAppointmentTime(item.dueAt)}</span> : null}
              </div>

              {item.blockers.length > 0 ? (
                <ul className="mt-3 flex flex-wrap gap-2" aria-label="Readiness blockers">
                  {item.blockers.map((blocker) => (
                    <li key={blocker}>
                      <StatusBadge intent="warning" label={formatIntakeBlocker(blocker)} uppercase={false} />
                    </li>
                  ))}
                </ul>
              ) : null}

              {item.openExceptions.length > 0 ? (
                <div className="mt-3 space-y-2 border-t border-[var(--dpf-border)] pt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
                    Open exceptions
                  </h4>
                  {item.openExceptions.map((exception) => (
                    <div key={exception.exceptionId} className="flex flex-wrap items-center gap-2 text-sm text-[var(--dpf-text)]">
                      <StatusBadge intent={severityIntent(exception.severity)} label={exception.severity} />
                      <span>{exception.summary}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
