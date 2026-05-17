import type {
  IntegrationReadinessDescriptor,
  IntegrationReadinessState,
} from "@/lib/integrate/readiness";

interface IntegrationReadinessPanelProps {
  descriptor: IntegrationReadinessDescriptor;
}

const STATE_LABELS: Record<IntegrationReadinessState, string> = {
  "not-connected": "No credentials",
  "credential-expired": "Credential expired",
  "not-mapped": "Not mapped",
  read: "Read only",
  "import-ready": "Import ready",
  "dual-run-ready": "Dual run",
  "dpf-primary-ready": "Ready to promote",
  "dpf-primary": "DPF primary",
  "partner-led": "Partner led",
};

export function IntegrationReadinessPanel({ descriptor }: IntegrationReadinessPanelProps) {
  return (
    <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-[var(--dpf-text)]">
            {descriptor.displayName} readiness
          </h2>
          <p className="max-w-3xl text-sm text-[var(--dpf-muted)]">{descriptor.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <MetricPill label="Credential" value={credentialLabel(descriptor.health.credentialStatus)} />
          {descriptor.environment && <MetricPill label="Environment" value={descriptor.environment} />}
        </div>
      </header>

      <dl className="mt-4 grid gap-3 text-sm md:grid-cols-3">
        <ContextItem label="Company" value={descriptor.entityContext.companyName} />
        <ContextItem label="Realm" value={descriptor.entityContext.realmId} />
        <ContextItem label="Last verified" value={formatDateTime(descriptor.health.lastSuccessfulProbeAt)} />
      </dl>

      {descriptor.health.lastProbeErrorCategory && (
        <div
          role="alert"
          className="mt-4 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-sm text-[var(--dpf-text)]"
        >
          Last probe error: {descriptor.health.lastProbeErrorCategory}
        </div>
      )}

      <div className="mt-5 overflow-hidden rounded border border-[var(--dpf-border)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--dpf-surface-2)] text-xs uppercase text-[var(--dpf-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Capability</th>
              <th className="px-3 py-2 font-semibold">State</th>
              <th className="px-3 py-2 font-semibold">Mode</th>
              <th className="px-3 py-2 font-semibold">Next action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dpf-border)]">
            {descriptor.capabilities.map((capability) => (
              <tr key={capability.key} className="bg-[var(--dpf-surface-1)]">
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-[var(--dpf-text)]">{capability.label}</div>
                  <div className="text-xs text-[var(--dpf-muted)]">{capability.description}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  <StateChip state={capability.state} />
                </td>
                <td className="px-3 py-3 align-top text-[var(--dpf-muted)]">
                  {formatMode(capability.operatingMode)}
                </td>
                <td className="px-3 py-3 align-top text-[var(--dpf-muted)]">
                  {capability.nextAction}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Next safe actions</h3>
        <ul className="mt-2 flex flex-wrap gap-2">
          {descriptor.nextSafeActions.map((action) => (
            <li
              key={action}
              className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-xs text-[var(--dpf-muted)]"
            >
              {action}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ContextItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <dt className="text-xs uppercase text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 font-medium text-[var(--dpf-text)]">{value || "Not available"}</dd>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-1 text-[var(--dpf-muted)]">
      {label}: <span className="font-medium text-[var(--dpf-text)]">{value}</span>
    </span>
  );
}

function StateChip({ state }: { state: IntegrationReadinessState }) {
  const isActive =
    state === "read" ||
    state === "import-ready" ||
    state === "dual-run-ready" ||
    state === "dpf-primary-ready" ||
    state === "dpf-primary";

  return (
    <span
      className={
        isActive
          ? "inline-flex rounded-full border border-[var(--dpf-accent)] bg-[color-mix(in_srgb,var(--dpf-accent)_14%,transparent)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]"
          : "inline-flex rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-xs font-medium text-[var(--dpf-muted)]"
      }
    >
      {STATE_LABELS[state]}
    </span>
  );
}

function credentialLabel(status: IntegrationReadinessDescriptor["health"]["credentialStatus"]): string {
  if (status === "not-connected") return "Not connected";
  if (status === "credential-expired") return "Credential expired";
  if (status === "error") return "Error";
  return "Connected";
}

function formatMode(mode: string): string {
  return mode
    .split("-")
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) {
    return null;
  }

  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
