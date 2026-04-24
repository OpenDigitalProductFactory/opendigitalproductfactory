"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addTaxFilingArtifact,
  ensureTaxDeadlineMonitoringTask,
  generateTaxObligationPeriods,
  prepareTaxFilingPacket,
  reviewTaxDeadlineNotifications,
} from "@/lib/actions/tax-remittance";
import type { AddTaxFilingArtifactInput } from "@/lib/finance/tax-remittance-validation";

type ArtifactRecord = {
  id: string;
  artifactType: string;
  storageKey: string | null;
  externalRef: string | null;
  sourceUrl: string | null;
  notes: string | null;
  createdAt: Date | string;
};

type PeriodRecord = {
  id: string;
  periodId: string;
  status: string;
  exportStatus: string;
  dueDate: Date | string;
  periodStart: Date | string;
  periodEnd: Date | string;
  salesTaxAmount: unknown;
  inputTaxAmount: unknown;
  netTaxAmount: unknown;
  registration: {
    taxType: string;
    jurisdictionReference: {
      authorityName: string;
      countryCode: string;
      stateProvinceCode: string | null;
    };
  };
  artifacts?: ArtifactRecord[];
};

type Props = {
  periods: PeriodRecord[];
  monitoring: {
    dueSoonCount: number;
    overdueCount: number;
    monitoringTask: {
      taskId: string;
      title: string;
      schedule: string;
      isActive: boolean;
      nextRunAt: Date | string | null;
      lastRunAt: Date | string | null;
      lastStatus: string | null;
    } | null;
  };
};

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

function formatDate(value: Date | string) {
  return new Date(value).toLocaleDateString("en-GB");
}

function formatMoney(value: unknown) {
  let amount = 0;
  if (typeof value === "number") {
    amount = value;
  } else if (typeof value === "string") {
    amount = Number(value);
  } else if (
    value &&
    typeof value === "object" &&
    "toString" in value &&
    typeof value.toString === "function"
  ) {
    amount = Number(value.toString());
  }

  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function defaultArtifactForm(periodId: string): AddTaxFilingArtifactInput {
  return {
    periodId,
    artifactType: "supporting_note",
    storageKey: "",
    externalRef: "",
    sourceUrl: "",
    notes: "",
  };
}

export function TaxObligationPeriodsTable({ periods, monitoring }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [artifactForms, setArtifactForms] = useState<Record<string, AddTaxFilingArtifactInput>>(() =>
    Object.fromEntries(periods.map((period) => [period.id, defaultArtifactForm(period.id)])),
  );

  function updateArtifactField<K extends keyof AddTaxFilingArtifactInput>(
    periodId: string,
    key: K,
    value: AddTaxFilingArtifactInput[K],
  ) {
    setArtifactForms((current) => ({
      ...current,
      [periodId]: {
        ...(current[periodId] ?? defaultArtifactForm(periodId)),
        [key]: value,
      },
    }));
  }

  function runAction(action: () => Promise<void>) {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (submissionError) {
        setError(
          submissionError instanceof Error
            ? submissionError.message
            : "Unable to update obligation periods.",
        );
      } finally {
        setActivePeriodId(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Obligation Periods
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Generate filing periods, prepare packet-ready workpapers, and attach factual audit evidence for each remittance cycle.
          </p>
          <p className="mt-2 text-xs text-[var(--dpf-muted)]">
            Period totals use platform-wide invoice and bill tax capture only when one verified active registration exists. Multi-jurisdiction allocation stays manual until tax is linked per transaction.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
            {monitoring.overdueCount} overdue
          </span>
          <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
            {monitoring.dueSoonCount} due soon
          </span>
          <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
            {periods.length} tracked
          </span>
          <button
            type="button"
            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-1)] disabled:opacity-60"
            disabled={isPending}
            onClick={() =>
              runAction(async () => {
                const result = await reviewTaxDeadlineNotifications();
                setSuccess(`${result.notificationsCreated} tax reminder${result.notificationsCreated === 1 ? "" : "s"} created.`);
              })
            }
          >
            {isPending && activePeriodId === null ? "Reviewing..." : "Review reminders"}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-1)] disabled:opacity-60"
            disabled={isPending || Boolean(monitoring.monitoringTask?.isActive)}
            onClick={() =>
              runAction(async () => {
                const result = await ensureTaxDeadlineMonitoringTask();
                setSuccess(result.created ? "Finance coworker monitoring enabled." : "Finance coworker monitoring already exists.");
              })
            }
          >
            {monitoring.monitoringTask?.isActive ? "Monitoring enabled" : "Enable monitoring"}
          </button>
          <button
            type="button"
            className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
            disabled={isPending}
            onClick={() =>
              runAction(async () => {
                await generateTaxObligationPeriods();
                setSuccess("Obligation periods refreshed.");
              })
            }
          >
            {isPending && activePeriodId === null ? "Generating..." : "Generate periods"}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Reminder Review
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            Deduped in-app reminders are created for due-soon and overdue periods without moving coworker dialog into this page.
          </p>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Coworker Monitor
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            {monitoring.monitoringTask?.isActive
              ? `Active. Next run ${monitoring.monitoringTask.nextRunAt ? formatDate(monitoring.monitoringTask.nextRunAt) : "pending"}${monitoring.monitoringTask.lastStatus ? ` · Last status ${monitoring.monitoringTask.lastStatus}` : ""}`
              : "No recurring finance monitor is enabled yet."}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Monitoring Focus
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            Upcoming due dates, overdue periods, missing evidence, and incomplete filing handoff details.
          </p>
        </div>
      </div>

      {(error || success) && (
        <div className="mt-4 flex flex-col gap-2">
          {error && <p className="text-xs text-[var(--dpf-danger)]">{error}</p>}
          {success && <p className="text-xs text-[var(--dpf-muted)]">{success}</p>}
        </div>
      )}

      {periods.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
          No obligation periods have been generated yet.
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {periods.map((period) => {
            const form = artifactForms[period.id] ?? defaultArtifactForm(period.id);

            return (
              <div
                key={period.id}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[var(--dpf-text)]">
                      {period.registration.jurisdictionReference.authorityName}
                    </p>
                    <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                      {period.registration.taxType} · {formatDate(period.periodStart)} -{" "}
                      {formatDate(period.periodEnd)} · Due {formatDate(period.dueDate)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      {period.status}
                    </span>
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      export {period.exportStatus}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      Output Tax
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                      {formatMoney(period.salesTaxAmount)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      Input Tax
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                      {formatMoney(period.inputTaxAmount)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      Net Due
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
                      {formatMoney(period.netTaxAmount)}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-surface-1)] disabled:opacity-60"
                    disabled={isPending}
                    onClick={() => {
                      setActivePeriodId(period.id);
                      runAction(async () => {
                        await prepareTaxFilingPacket({ periodId: period.id });
                        setSuccess("Filing packet prepared.");
                      });
                    }}
                  >
                    {isPending && activePeriodId === period.id ? "Preparing..." : "Prepare filing packet"}
                  </button>
                  <span className="text-xs text-[var(--dpf-muted)]">
                    {period.artifacts?.length ?? 0} evidence item{(period.artifacts?.length ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>

                <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      Audit Evidence
                    </p>
                    {period.artifacts && period.artifacts.length > 0 ? (
                      <div className="mt-3 space-y-3">
                        {period.artifacts.map((artifact) => (
                          <div
                            key={artifact.id}
                            className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-xs font-semibold text-[var(--dpf-text)]">
                                {artifact.artifactType}
                              </p>
                              <p className="text-[11px] text-[var(--dpf-muted)]">
                                {formatDate(artifact.createdAt)}
                              </p>
                            </div>
                            {artifact.notes && (
                              <p className="mt-2 text-xs text-[var(--dpf-muted)]">{artifact.notes}</p>
                            )}
                            {(artifact.sourceUrl || artifact.externalRef) && (
                              <p className="mt-2 text-[11px] text-[var(--dpf-muted)]">
                                {artifact.sourceUrl ?? "No source URL"}
                                {artifact.externalRef ? ` · Ref ${artifact.externalRef}` : ""}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-3 rounded border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-3 py-4 text-xs text-[var(--dpf-muted)]">
                        No evidence or filing artifacts attached yet.
                      </div>
                    )}
                  </div>

                  <form
                    className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      setActivePeriodId(period.id);
                      runAction(async () => {
                        await addTaxFilingArtifact(form);
                        setArtifactForms((current) => ({
                          ...current,
                          [period.id]: defaultArtifactForm(period.id),
                        }));
                        setSuccess("Evidence added.");
                      });
                    }}
                  >
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
                      Add Evidence
                    </p>
                    <div className="mt-3 space-y-3">
                      <label className="block text-xs text-[var(--dpf-muted)]">
                        Artifact type
                        <select
                          value={form.artifactType}
                          onChange={(event) =>
                            updateArtifactField(
                              period.id,
                              "artifactType",
                              event.target.value as AddTaxFilingArtifactInput["artifactType"],
                            )
                          }
                          className={`mt-1 w-full ${inputClasses}`}
                        >
                          <option value="supporting_note" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                            Supporting note
                          </option>
                          <option value="export" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                            Export
                          </option>
                          <option value="confirmation" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                            Confirmation
                          </option>
                          <option value="workpaper" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                            Workpaper
                          </option>
                        </select>
                      </label>

                      <label className="block text-xs text-[var(--dpf-muted)]">
                        Source URL
                        <input
                          value={form.sourceUrl ?? ""}
                          onChange={(event) => updateArtifactField(period.id, "sourceUrl", event.target.value)}
                          className={`mt-1 w-full ${inputClasses}`}
                          placeholder="https://..."
                        />
                      </label>

                      <label className="block text-xs text-[var(--dpf-muted)]">
                        External reference
                        <input
                          value={form.externalRef ?? ""}
                          onChange={(event) => updateArtifactField(period.id, "externalRef", event.target.value)}
                          className={`mt-1 w-full ${inputClasses}`}
                          placeholder="Confirmation or accountant reference"
                        />
                      </label>

                      <label className="block text-xs text-[var(--dpf-muted)]">
                        Notes
                        <textarea
                          value={form.notes ?? ""}
                          onChange={(event) => updateArtifactField(period.id, "notes", event.target.value)}
                          className={`mt-1 min-h-24 w-full ${inputClasses}`}
                          placeholder="What this evidence proves or where it came from."
                        />
                      </label>

                      <button
                        type="submit"
                        className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-bg)] disabled:opacity-60"
                        disabled={isPending}
                      >
                        {isPending && activePeriodId === period.id ? "Saving..." : "Save evidence"}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
