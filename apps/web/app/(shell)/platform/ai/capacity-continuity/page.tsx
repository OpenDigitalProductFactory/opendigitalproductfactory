import Link from "next/link";

const CONTINUITY_STATES = [
  {
    state: "normal",
    description: "Employees are available; agents assist, prepare decisions, and accelerate active work.",
  },
  {
    state: "low-attention",
    description: "Employees are busy; agents continue safe work and batch non-urgent interruptions.",
  },
  {
    state: "away",
    description: "Planned absence; agents pull from approved queues and escalate only meaningful blockers.",
  },
  {
    state: "holiday",
    description: "Reduced business availability; agents favor quiet maintenance, monitoring, and review prep.",
  },
  {
    state: "event",
    description: "Trade show, launch, audit, or migration; agents shift toward event support and evidence capture.",
  },
  {
    state: "paused",
    description: "Operator stop; no new autonomous capacity work starts.",
  },
];

const SAFE_WORK = [
  "stale spec and plan review",
  "failing CI or build-gate repair",
  "approved backlog slices with bounded scope",
  "UX and QA evidence collection",
  "coworker self-assessment and capability needs",
  "proceduralization candidate analysis",
];

export default function CapacityContinuityPage() {
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--dpf-muted)]">
            AI Operations
          </p>
          <h1 className="mt-1 text-xl font-bold text-[var(--dpf-text)]">
            Capacity Continuity
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
            Operating policy for using paid AI capacity while employee attention is available,
            reduced, away, or redirected to business events.
          </p>
        </div>
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs text-[var(--dpf-muted)]">
          Design slice active
        </div>
      </header>

      <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <div className="max-w-3xl">
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Responsible AI capacity utilization
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--dpf-muted)]">
            DPF treats AI capacity as an operating asset. If valuable, authorized,
            evidence-producing work exists, agents should keep making governed progress.
            If no safe work exists, the platform should record the blocker instead of
            spending tokens to appear busy.
          </p>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        <StatusCard label="Current implementation" value="Doctrine and UX home" />
        <StatusCard label="Canonical route" value="/platform/ai/capacity-continuity" />
        <StatusCard label="Next slice" value="Standing Orders" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Continuity states
          </h2>
          <div className="mt-4 grid gap-3">
            {CONTINUITY_STATES.map((item) => (
              <div
                key={item.state}
                className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3"
              >
                <div className="font-mono text-xs font-semibold text-[var(--dpf-text)]">
                  {item.state}
                </div>
                <p className="mt-1 text-sm leading-5 text-[var(--dpf-muted)]">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Safe work queues
            </h2>
            <ul className="mt-3 space-y-2 text-sm text-[var(--dpf-muted)]">
              {SAFE_WORK.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--dpf-accent)]" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Related surfaces
            </h2>
            <div className="mt-3 flex flex-col gap-2 text-sm">
              <Link href="/platform/ai/operations-map" className="text-[var(--dpf-accent)] hover:underline">
                Operations Map
              </Link>
              <Link href="/ops?origin=capability-need" className="text-[var(--dpf-accent)] hover:underline">
                Capability Needs
              </Link>
              <Link href="/workspace" className="text-[var(--dpf-accent)] hover:underline">
                My Workspace
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="text-xs font-medium uppercase text-[var(--dpf-muted)]">{label}</div>
      <div className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">{value}</div>
    </div>
  );
}
