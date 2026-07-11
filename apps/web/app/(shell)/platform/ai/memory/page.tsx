import { StatCard } from "@/components/ui/report-kit";
import { can } from "@/lib/govern/permissions";
import { auth } from "@/lib/auth";
import { loadMyMemoryAudit, loadOrgMemoryAudit, loadMySpendLine } from "@/lib/actions/memory-audit";
import { MyMemoryAuditClient } from "./MyMemoryAuditClient";

// Coworker memory transparency (BI-DC8B03AB, EP-8C706944 P4). Self-serve view of
// what a coworker remembers about you, with a per-item Forget; admins also see
// org-shared facts + coworker working notes. Kernel UX-fit: self-serve settings
// panel + admin section (DI-94083410B6F1) — progressive disclosure, plain groups,
// sensitive items badged, no raw token/config inputs.

export default async function CoworkerMemoryPage() {
  const session = await auth();
  const isAdmin = can(
    { platformRole: session?.user?.platformRole ?? null, isSuperuser: session?.user?.isSuperuser ?? false },
    "manage_agents",
  );

  const mine = await loadMyMemoryAudit();
  const spendLine = await loadMySpendLine();
  const org = isAdmin ? await loadOrgMemoryAudit() : null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">What your coworker remembers</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Everything a coworker has learned about you across conversations. Forget anything you don&apos;t want kept.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatCard label="Things remembered" value={mine.summary.total} intent="neutral" />
        <StatCard
          label="Shared with your team"
          value={mine.summary.orgShared}
          intent={mine.summary.orgShared > 0 ? "info" : "neutral"}
          hint="Business facts your teammates' coworkers can use"
        />
        <StatCard
          label="Sensitive"
          value={mine.summary.sensitive}
          intent={mine.summary.sensitive > 0 ? "warning" : "neutral"}
          hint="Kept private to you"
        />
      </div>

      <div className="mb-6 text-sm text-[var(--dpf-muted)]">
        Your AI usage across all conversations: <span className="text-[var(--dpf-text)]">{spendLine}</span>
      </div>

      {mine.groups.length === 0 ? (
        <p className="text-sm text-[var(--dpf-muted)]">
          Your coworker hasn&apos;t remembered anything about you yet.
        </p>
      ) : (
        mine.groups.map((group) => (
          <section key={group.category} className="mb-6">
            <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">{group.label}</h2>
            <MyMemoryAuditClient rows={group.rows} />
          </section>
        ))
      )}

      {org ? (
        <section className="mt-10 pt-6 border-t border-[var(--dpf-border)]">
          <h2 className="text-lg font-bold text-[var(--dpf-text)]">Organization memory (admin)</h2>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5 mb-4">
            Org-shared business facts across the workforce and each coworker&apos;s working notes. Read-only.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Org-shared facts" value={org.summary.total} intent="info" />
            <StatCard label="Coworker notes" value={org.notes.length} intent="neutral" />
            <StatCard label="Sensitive (excluded)" value={0} intent="neutral" hint="Sensitive facts never leave their user" />
          </div>
          {org.facts.map((group) => (
            <section key={`org-${group.category}`} className="mb-6">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)] mb-2">{group.label}</h3>
              <MyMemoryAuditClient rows={group.rows} />
            </section>
          ))}
        </section>
      ) : null}
    </div>
  );
}
