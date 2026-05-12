"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateOrganizationLicenseProfile,
  type UpdateOrganizationLicenseProfileInput,
} from "@/lib/actions/licensing-compliance";
import { AgentWorkLauncher } from "@/components/agent/AgentWorkLauncher";
import { CreateOrganizationLicenseRecordForm } from "@/components/compliance/licensing/CreateOrganizationLicenseRecordForm";
import { CreatePersonLicenseRecordForm } from "@/components/compliance/licensing/CreatePersonLicenseRecordForm";
import { buildLicensingCoworkerTopics } from "@/lib/licensing/licensing-coworker-topics";
import type { LicensingWorkspace } from "@/lib/licensing-workspace-types";

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

type Props = {
  workspace: LicensingWorkspace;
};

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "Not set";
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent: string;
}) {
  return (
    <div
      className="rounded-lg border p-4"
      style={{
        borderColor: `color-mix(in srgb, ${accent} 28%, var(--dpf-border))`,
        background: `color-mix(in srgb, ${accent} 8%, var(--dpf-surface-1))`,
      }}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-2 text-2xl font-semibold" style={{ color: accent }}>
        {value}
      </p>
    </div>
  );
}

export function LicensingWorkspacePanel({ workspace }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<UpdateOrganizationLicenseProfileInput>({
    setupStatus: workspace.profile.setupStatus,
    investigationMode: workspace.profile.investigationMode,
    homeCountryCode: workspace.profile.homeCountryCode ?? "",
    primaryRegionCode: workspace.profile.primaryRegionCode ?? "",
    operatingFootprintSummary: workspace.profile.operatingFootprintSummary ?? "",
    legalActivityConfidence: workspace.profile.legalActivityConfidence,
    researchCoverageStatus: workspace.profile.researchCoverageStatus,
    notes: workspace.profile.notes ?? "",
  });
  const coworkerTopics = buildLicensingCoworkerTopics(workspace);

  function updateField<K extends keyof UpdateOrganizationLicenseProfileInput>(
    key: K,
    value: UpdateOrganizationLicenseProfileInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(false);
    setError(null);

    startTransition(async () => {
      const result = await updateOrganizationLicenseProfile(form);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
              Licensing posture
            </p>
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">
              Record what is known about legality, licensing coverage, and investigation confidence without mixing coworker dialog into the operational page.
            </p>
          </div>
          <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
            {workspace.organization.slug}
          </span>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="text-xs text-[var(--dpf-muted)]">
            Setup status
            <select
              value={form.setupStatus}
              onChange={(event) => updateField("setupStatus", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="draft" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Draft</option>
              <option value="investigating" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Investigating</option>
              <option value="ready" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Ready</option>
              <option value="blocked" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Blocked</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Investigation mode
            <select
              value={form.investigationMode}
              onChange={(event) => updateField("investigationMode", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="unknown" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Unknown</option>
              <option value="existing" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Already operating</option>
              <option value="new_business" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">New business</option>
              <option value="expanding" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Expanding footprint</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Home country
            <input
              value={form.homeCountryCode ?? ""}
              onChange={(event) => updateField("homeCountryCode", event.target.value.toUpperCase())}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="US"
              maxLength={2}
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Primary region or state
            <input
              value={form.primaryRegionCode ?? ""}
              onChange={(event) => updateField("primaryRegionCode", event.target.value.toUpperCase())}
              className={`mt-1 w-full ${inputClasses}`}
              placeholder="NV"
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Legal activity confidence
            <select
              value={form.legalActivityConfidence}
              onChange={(event) => updateField("legalActivityConfidence", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="low" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Low</option>
              <option value="medium" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Medium</option>
              <option value="high" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">High</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)]">
            Research coverage
            <select
              value={form.researchCoverageStatus}
              onChange={(event) => updateField("researchCoverageStatus", event.target.value)}
              className={`mt-1 w-full ${inputClasses}`}
            >
              <option value="draft" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Draft</option>
              <option value="partial" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Partial</option>
              <option value="covered" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Covered</option>
              <option value="stale" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Stale</option>
            </select>
          </label>

          <label className="text-xs text-[var(--dpf-muted)] md:col-span-2">
            Operating footprint
            <textarea
              value={form.operatingFootprintSummary ?? ""}
              onChange={(event) => updateField("operatingFootprintSummary", event.target.value)}
              className={`mt-1 min-h-24 w-full ${inputClasses}`}
              placeholder="Where the business operates, where staff work, and where regulated services are delivered."
            />
          </label>

          <label className="text-xs text-[var(--dpf-muted)] md:col-span-2">
            Notes
            <textarea
              value={form.notes ?? ""}
              onChange={(event) => updateField("notes", event.target.value)}
              className={`mt-1 min-h-24 w-full ${inputClasses}`}
              placeholder="Known gaps, licensing counsel notes, or operator-owned follow-up."
            />
          </label>

          <div className="md:col-span-2 flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {isPending ? "Saving..." : "Save licensing posture"}
            </button>
            {saved && !isPending ? <span className="text-xs text-[var(--dpf-success)]">Saved.</span> : null}
            {error ? <span className="text-xs text-[var(--dpf-error)]">{error}</span> : null}
          </div>
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <MetricCard label="Company licenses" value={workspace.summary.organizationLicenseCount} accent="var(--dpf-accent)" />
        <MetricCard label="Staff credentials" value={workspace.summary.personCredentialCount} accent="var(--dpf-success)" />
        <MetricCard label="Unsatisfied display rules" value={workspace.summary.unsatisfiedDisplayCount} accent="var(--dpf-warning)" />
        <MetricCard label="Pending fees" value={workspace.summary.pendingFeeCount} accent="var(--dpf-warning)" />
        <MetricCard label="Open issues" value={workspace.summary.openIssueCount} accent="var(--dpf-error)" />
      </div>

      <AgentWorkLauncher
        agentName="Licensing Specialist"
        primaryActionLabel="Start licensing investigation"
        topics={coworkerTopics}
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Organization licenses</p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  Operating permissions, permits, registrations, and legality gates that the company itself must maintain.
                </p>
              </div>
              <CreateOrganizationLicenseRecordForm requirementOptions={workspace.requirementOptions} />
            </div>

            <div className="mt-4 space-y-3">
              {workspace.organizationLicenses.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
                  No company-held licenses or permits have been recorded yet.
                </div>
              ) : (
                workspace.organizationLicenses.map((record) => (
                  <div key={record.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--dpf-text)]">
                          {record.requirementReference?.authorityName ?? record.licenseKind}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          {record.licenseKind} · {record.status}
                          {record.licenseNumber ? ` · ${record.licenseNumber}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          Expires {formatDate(record.expiresAt)}
                        </p>
                      </div>
                      <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                        {record.displayRequirementStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                    {(record.displayObligations.length > 0 || record.feeSchedules.length > 0) && (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
                          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Display obligations</p>
                          {record.displayObligations.map((item) => (
                            <p key={item.id} className="mt-2 text-xs text-[var(--dpf-text)]">
                              {item.displayType}
                              {item.displayLocation ? ` · ${item.displayLocation}` : ""}
                            </p>
                          ))}
                        </div>
                        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2">
                          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Fee tracking</p>
                          {record.feeSchedules.map((item) => (
                            <p key={item.id} className="mt-2 text-xs text-[var(--dpf-text)]">
                              {item.feeType} · {String(item.amount)} {item.currency} · {item.paymentStatus}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Person-held credentials</p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  Professional or role-based credentials that belong to staff, owners, or responsible parties.
                </p>
              </div>
              <CreatePersonLicenseRecordForm
                requirementOptions={workspace.requirementOptions}
                holderOptions={workspace.holderOptions}
              />
            </div>

            <div className="mt-4 space-y-3">
              {workspace.personCredentials.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
                  No person-held credentials have been recorded yet.
                </div>
              ) : (
                workspace.personCredentials.map((record) => (
                  <div key={record.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--dpf-text)]">
                          {record.principalAlias.principal.displayName}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          {record.credentialType} · {record.status}
                          {record.credentialNumber ? ` · ${record.credentialNumber}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          Expires {formatDate(record.expiresAt)}
                        </p>
                      </div>
                      <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                        {record.supervisoryOrDisplayRole ?? "Role not set"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Display obligations</p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  Public posting and trust-signal requirements linked to licenses and credentials.
                </p>
              </div>
              <Link href="/compliance/evidence" className="text-xs text-[var(--dpf-accent)] hover:underline">
                Evidence
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.displayObligations.length === 0 ? (
                <p className="text-sm text-[var(--dpf-muted)]">No display obligations are tracked yet.</p>
              ) : (
                workspace.displayObligations.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[var(--dpf-text)]">{item.sourceLabel}</p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          {item.displayType}
                          {item.displayLocation ? ` · ${item.displayLocation}` : ""}
                          {item.holderLabel ? ` · ${item.holderLabel}` : ""}
                        </p>
                      </div>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px]"
                        style={{
                          borderColor: item.isSatisfied ? "var(--dpf-success)" : "var(--dpf-warning)",
                          color: item.isSatisfied ? "var(--dpf-success)" : "var(--dpf-warning)",
                        }}
                      >
                        {item.isSatisfied ? "Satisfied" : "Needs attention"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Fee readiness</p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  Licensing fees stay grounded in Compliance while handing payment review and execution into Finance when needed.
                </p>
              </div>
              <Link href="/finance" className="text-xs text-[var(--dpf-accent)] hover:underline">
                Finance
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.feeSchedules.length === 0 ? (
                <p className="text-sm text-[var(--dpf-muted)]">No licensing fees are tracked yet.</p>
              ) : (
                workspace.feeSchedules.map((item) => (
                  <div key={item.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[var(--dpf-text)]">{item.sourceLabel}</p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          {item.feeType} · {String(item.amount)} {item.currency} · due {formatDate(item.dueDate)}
                        </p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                          Holder: {item.holderLabel} · {item.financeHandoffMode.replaceAll("_", " ")}
                        </p>
                      </div>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px]"
                        style={{
                          borderColor: item.paymentStatus === "paid" ? "var(--dpf-success)" : "var(--dpf-warning)",
                          color: item.paymentStatus === "paid" ? "var(--dpf-success)" : "var(--dpf-warning)",
                        }}
                      >
                        {item.paymentStatus.replaceAll("_", " ")}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Open issues</p>
                <p className="mt-1 text-sm text-[var(--dpf-muted)]">
                  Gaps that still block readiness, including factual investigation issues the licensing coworker records from this route.
                </p>
              </div>
              <Link href="/employee" className="text-xs text-[var(--dpf-accent)] hover:underline">
                Staff
              </Link>
            </div>
            <div className="mt-4 space-y-3">
              {workspace.openIssues.length === 0 ? (
                <p className="text-sm text-[var(--dpf-muted)]">No licensing readiness issues are currently open.</p>
              ) : (
                workspace.openIssues.map((issue) => (
                  <div key={issue.id} className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-[var(--dpf-text)]">{issue.title}</p>
                        <p className="mt-1 text-xs text-[var(--dpf-muted)]">{issue.details ?? issue.issueType}</p>
                      </div>
                      <span
                        className="rounded-full border px-2.5 py-1 text-[11px]"
                        style={{
                          borderColor: issue.severity === "critical" || issue.severity === "high" ? "var(--dpf-error)" : "var(--dpf-warning)",
                          color: issue.severity === "critical" || issue.severity === "high" ? "var(--dpf-error)" : "var(--dpf-warning)",
                        }}
                      >
                        {issue.severity}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
