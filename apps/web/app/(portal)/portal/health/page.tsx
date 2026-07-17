import Link from "next/link";
import { redirect } from "next/navigation";

import { EmptyState, Notice, StatusBadge } from "@/components/ui/report-kit";
import { auth } from "@/lib/auth";
import { resolveCarePortalIdentity } from "@/lib/healthcare/care-portal-session";
import { listPatientCareTasks, type PatientCareTask } from "@/lib/healthcare/care-intake-portal-repository";

function taskIntent(status: string): "info" | "warning" | "neutral" {
  if (status === "assigned") return "info";
  if (status === "amended") return "warning";
  return "neutral";
}

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "No due date";
  return `Due ${new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(dueAt))}`;
}

function IntakeTaskCard({ task }: { task: PatientCareTask }) {
  return (
    <article className="rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Before your visit
          </p>
          <h2 className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">
            Complete your forms
          </h2>
        </div>
        <StatusBadge intent={taskIntent(task.status)} label={task.status.replaceAll("-", " ")} variant="soft" />
      </div>
      <div className="mt-4" aria-label={`${task.completionPercent}% complete`}>
        <div className="mb-1 flex justify-between text-xs text-[var(--dpf-muted)]">
          <span>{task.completionPercent}% complete</span>
          <span>{dueLabel(task.dueAt)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--dpf-surface-2)]">
          <div
            className="h-full rounded-full bg-[var(--dpf-accent)]"
            style={{ width: `${Math.max(0, Math.min(100, task.completionPercent))}%` }}
          />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--dpf-muted)]">
          Your answers are shared only with the care team handling this visit.
        </p>
        <Link
          href={`/portal/health/intake/${encodeURIComponent(task.packetId)}`}
          className="rounded-md bg-[var(--dpf-accent)] px-4 py-2 text-sm font-semibold text-[var(--dpf-bg)] no-underline"
        >
          {task.completionPercent > 0 ? "Continue forms" : "Start forms"}
        </Link>
      </div>
    </article>
  );
}

export default async function PatientCarePage() {
  const session = await auth();
  if (!session?.user || session.user.type !== "customer") redirect("/portal/sign-in");

  const identity = await resolveCarePortalIdentity(session.user);
  if (!identity) {
    return (
      <Notice variant="warn" title="We could not connect your care profile">
        Contact the office to confirm the email address on your patient record.
      </Notice>
    );
  }
  const result = await listPatientCareTasks(identity);

  return (
    <div className="space-y-6 text-[var(--dpf-text)]">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--dpf-muted)]">Patient portal</p>
        <h1 className="mt-1 text-2xl font-semibold">My care</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--dpf-muted)]">
          See what you need to do before your next visit. Appointments, results, and care messages will join this page as they become available.
        </p>
      </header>

      {!result.linked ? (
        <Notice variant="warn" title="Your care profile is not connected">
          Contact the office to confirm the email address on your patient record. Staff can also help you complete forms in person.
        </Notice>
      ) : result.tasks.length === 0 ? (
        <EmptyState
          title="You're all caught up"
          description="You do not have any forms waiting right now."
          bordered
        />
      ) : (
        <section className="grid gap-4" aria-label="Forms to complete">
          {result.tasks.map((task) => <IntakeTaskCard key={task.packetId} task={task} />)}
        </section>
      )}
    </div>
  );
}
