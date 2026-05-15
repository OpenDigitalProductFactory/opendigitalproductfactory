import { Bell, Building2, MessagesSquare } from "lucide-react";

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
    </main>
  );
}
