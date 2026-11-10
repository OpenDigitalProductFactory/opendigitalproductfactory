import type { ReactNode } from "react";
import { LocalTime } from "@/components/ui/LocalTime";
import type {
  IntegrationReadinessDescriptor,
  IntegrationReadinessState,
} from "@/lib/integrations/readiness";
import type { IntegrationImportStagingDescriptor } from "@/lib/integrations/import-staging";
import type { IntegrationImportReviewPosture } from "@/lib/integrations/import-review";
import type { ResolvedNextStep } from "@/lib/backlog/next-step-pointer";

interface IntegrationReadinessPanelProps {
  descriptor: IntegrationReadinessDescriptor;
  /**
   * The import-review next step after the page checked it against the backlog.
   * Omitted where nothing is filed, which is why the pill below is conditional:
   * a compact metric slot names a live item or it is not shown (BI-5BF97BAA).
   */
  importReviewNextStep?: ResolvedNextStep;
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

export function IntegrationReadinessPanel({
  descriptor,
  importReviewNextStep,
}: IntegrationReadinessPanelProps) {
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
        <ContextItem
          label="Last verified"
          value={
            <LocalTime
              value={descriptor.health.lastSuccessfulProbeAt}
              options={{ year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }}
              fallback="Not available"
            />
          }
        />
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
                  {capability.apiCoverageNote && (
                    <div className="mt-1 text-xs text-[var(--dpf-muted)]">
                      API coverage: {capability.apiCoverageNote}
                    </div>
                  )}
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

      {descriptor.importStaging && (
        <ImportStagingPosture descriptor={descriptor.importStaging} />
      )}

      {descriptor.importReview && (
        <ImportReviewPosture posture={descriptor.importReview} nextStep={importReviewNextStep} />
      )}

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

function ImportReviewPosture({
  posture,
  nextStep,
}: {
  posture: IntegrationImportReviewPosture;
  nextStep?: ResolvedNextStep;
}) {
  return (
    <section className="mt-5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Import review queue</h3>
          <p className="max-w-3xl text-xs leading-5 text-[var(--dpf-muted)]">
            {posture.guardrail}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <MetricPill label="State" value={reviewStatusLabel(posture.status)} />
          {nextStep?.kind === "filed" && <MetricPill label="Backlog" value={nextStep.label} />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {posture.families.map((family) => (
          <span
            key={family}
            className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2.5 py-1 text-xs text-[var(--dpf-text)]"
          >
            {family}
          </span>
        ))}
      </div>
    </section>
  );
}

function ImportStagingPosture({ descriptor }: { descriptor: IntegrationImportStagingDescriptor }) {
  return (
    <section className="mt-5 rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-[var(--dpf-text)]">Import staging posture</h3>
          <p className="max-w-3xl text-xs leading-5 text-[var(--dpf-muted)]">
            {descriptor.approvalGate}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <MetricPill label="Mode" value={descriptor.readOnly ? "Non-editable" : "Editable"} />
          <MetricPill label="Provider" value={descriptor.sourceProvider} />
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded border border-[var(--dpf-border)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--dpf-surface-1)] text-xs uppercase text-[var(--dpf-muted)]">
            <tr>
              <th className="px-3 py-2 font-semibold">Entity family</th>
              <th className="px-3 py-2 font-semibold">Owner side</th>
              <th className="px-3 py-2 font-semibold">Proposed link</th>
              <th className="px-3 py-2 font-semibold">Review fields</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--dpf-border)]">
            {descriptor.families.map((family) => (
              <tr key={family.key} className="bg-[var(--dpf-surface-2)]">
                <td className="px-3 py-3 align-top">
                  <div className="font-medium text-[var(--dpf-text)]">{family.label}</div>
                  <div className="text-xs text-[var(--dpf-muted)]">{family.key}</div>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className="inline-flex rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1 text-xs font-medium text-[var(--dpf-text)]">
                    {ownerSideLabel(family.ownerSide)}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-[var(--dpf-text)]">
                  {family.proposedLocalEntity}
                </td>
                <td className="px-3 py-3 align-top text-xs text-[var(--dpf-muted)]">
                  {family.reviewFields.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-5 text-[var(--dpf-muted)]">
        {descriptor.rollbackExpectation}
      </p>
    </section>
  );
}

function ContextItem({ label, value }: { label: string; value: ReactNode }) {
  const display = value == null || value === "" ? "Not available" : value;
  return (
    <div className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
      <dt className="text-xs uppercase text-[var(--dpf-muted)]">{label}</dt>
      <dd className="mt-1 font-medium text-[var(--dpf-text)]">{display}</dd>
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

function ownerSideLabel(ownerSide: string): string {
  if (ownerSide === "external") {
    return "External-owned";
  }

  return "DPF-owned";
}

function reviewStatusLabel(status: IntegrationImportReviewPosture["status"]): string {
  if (status === "ready-to-review") {
    return "Ready for review";
  }

  if (status === "blocked") {
    return "Blocked";
  }

  return "Not started";
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
