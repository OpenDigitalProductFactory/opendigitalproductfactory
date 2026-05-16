import { Bell, Building2, MessagesSquare } from "lucide-react";
import { listCommunicationChannelBindings } from "@/lib/communications/channel-binding-store";

const groups = [
  {
    title: "DPF-owned baseline",
    description: "In-app notifications, mobile push, and email fallback keep the work record inside DPF.",
    items: ["In-app", "Push", "Email"],
    icon: Bell,
    posture: "Default",
  },
  {
    title: "Enterprise real-time",
    description: "Teams and Slack carry fast approvals and nudges while DPF remains the system of record.",
    items: ["Microsoft Teams", "Slack"],
    icon: Building2,
    posture: "Adapter",
  },
  {
    title: "Field and local messaging",
    description: "WhatsApp Business and Telegram support field workers, local teams, and owner-operated businesses.",
    items: ["WhatsApp Business", "Telegram"],
    icon: MessagesSquare,
    posture: "Candidate",
  },
];

const principles = [
  { label: "Record", value: "DPF" },
  { label: "Consent", value: "Per employee" },
  { label: "Evidence", value: "Every attempt" },
];

export default async function CommunicationsPage() {
  const bindingDashboard = await listCommunicationChannelBindings({ take: 8 });

  return (
    <main className="space-y-6">
      <header className="space-y-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--dpf-muted)]">
            Platform Tools
          </span>
          <h1 className="mt-1 text-2xl font-bold text-[var(--dpf-text)]">Communications</h1>
        </div>
        <p className="max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
          Governed employee reachability, provider readiness, and delivery evidence. External tools are
          channel adapters; DPF owns identity, policy, work state, and audit history.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3" aria-label="Communication principles">
        {principles.map((principle) => (
          <div
            key={principle.label}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-4 py-3"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
              {principle.label}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{principle.value}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {groups.map((group) => {
          const Icon = group.icon;

          return (
            <article
              key={group.title}
              className="flex min-h-full flex-col rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-accent)]">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-[var(--dpf-text)]">{group.title}</h2>
                    <p className="mt-1 text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">
                      {group.posture}
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-sm leading-6 text-[var(--dpf-muted)]">{group.description}</p>

              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)]"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Channel bindings</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
              Employee reachability records that provider adapters can use for governed delivery.
            </p>
          </div>
          <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2.5 py-1 text-xs font-medium text-[var(--dpf-text)]">
            {bindingDashboard.summary.total} total
          </span>
        </header>

        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <BindingMetric label="Active" value={`${bindingDashboard.summary.active} active`} />
          <BindingMetric label="Verified" value={`${bindingDashboard.summary.verified} verified`} />
          <BindingMetric label="Pending" value={`${bindingDashboard.summary.pending} pending`} />
          <BindingMetric label="Failed" value={`${bindingDashboard.summary.failed} failed`} />
        </dl>

        {bindingDashboard.bindings.length === 0 ? (
          <p className="mt-4 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-muted)]">
            No employee channel bindings are configured yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--dpf-border)] border-y border-[var(--dpf-border)]">
            {bindingDashboard.bindings.map((binding) => (
              <li
                key={binding.bindingId}
                className="grid gap-3 py-3 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--dpf-text)]">
                    {binding.displayLabel}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--dpf-muted)]">
                    {binding.channelType} via {binding.providerKey}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--dpf-text)]">
                    {binding.employeeDisplayName ?? binding.principalDisplayName}
                  </p>
                  <p className="mt-1 truncate text-xs text-[var(--dpf-muted)]">
                    {binding.employeeDisplayName
                      ? `${binding.externalSubject} - ${binding.principalDisplayName}`
                      : binding.externalSubject}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-text)]">
                    {binding.verificationStatus}
                  </span>
                  <span className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
                    {binding.allowedUrgencies.join(", ")}
                  </span>
                  <span className="text-xs text-[var(--dpf-muted)]">
                    {binding.lastTestedAt ? `Tested ${formatBindingDate(binding.lastTestedAt)}` : "Not tested"}
                  </span>
                  {binding.lastError && (
                    <span className="basis-full text-xs text-[var(--dpf-muted)] lg:text-right">
                      {binding.lastError}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function BindingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-[var(--dpf-text)]">{value}</dd>
    </div>
  );
}

function formatBindingDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
