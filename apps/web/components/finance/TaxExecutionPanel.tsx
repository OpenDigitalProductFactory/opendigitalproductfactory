"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { prepareTaxRemittanceRun, updateTaxRemittanceRunStatus } from "@/lib/actions/tax-remittance";
import type {
  PrepareTaxRemittanceRunInput,
  UpdateTaxRemittanceRunStatusInput,
} from "@/lib/finance/tax-remittance-validation";

const inputClasses =
  "rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-sm text-[var(--dpf-text)] focus:border-[var(--dpf-accent)] focus:outline-none";

type RunRecord = {
  id: string;
  runId: string;
  status: string;
  executionMode: string;
  scheduledFor: Date | string | null;
  submittedAt?: Date | string | null;
  paidAt?: Date | string | null;
  confirmationRef?: string | null;
  failureCode?: string | null;
  failureDetails?: string | null;
};

type PeriodRecord = {
  id: string;
  periodId: string;
  status: string;
  dueDate: Date | string;
  registration: {
    jurisdictionReference: {
      authorityName: string;
    };
  };
  remittanceRuns?: RunRecord[];
};

type Props = {
  periods: PeriodRecord[];
  filingOwner: string;
  handoffMode: string;
};

function toDateTimeLocal(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(value: Date | string | null | undefined) {
  if (!value) return "Not scheduled";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function TaxExecutionPanel({ periods, filingOwner, handoffMode }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [activePeriodId, setActivePeriodId] = useState<string | null>(null);
  const createDefaults = useMemo(
    () =>
      Object.fromEntries(
        periods.map((period) => [
          period.id,
          {
            periodId: period.id,
            executionMode: (filingOwner === "dpf_coworker" ? "scheduled_coworker" : handoffMode === "external_filing" ? "external_handoff" : "manual") as PrepareTaxRemittanceRunInput["executionMode"],
            scheduleFor: "",
          },
        ]),
      ),
    [periods, filingOwner, handoffMode],
  );
  const [createForms, setCreateForms] = useState<Record<string, PrepareTaxRemittanceRunInput>>(createDefaults);
  const [statusForms, setStatusForms] = useState<Record<string, UpdateTaxRemittanceRunStatusInput>>({});

  useEffect(() => {
    setCreateForms(createDefaults);
    setStatusForms(
      Object.fromEntries(
        periods
          .map((period) => period.remittanceRuns?.[0])
          .filter((run): run is RunRecord => Boolean(run))
          .map((run) => [
            run.id,
            {
              runId: run.id,
              status: run.status as UpdateTaxRemittanceRunStatusInput["status"],
              confirmationRef: run.confirmationRef ?? "",
              failureCode: run.failureCode ?? "",
              failureDetails: run.failureDetails ?? "",
            },
          ]),
      ),
    );
  }, [createDefaults, periods]);

  function updateCreateField<K extends keyof PrepareTaxRemittanceRunInput>(
    periodId: string,
    key: K,
    value: PrepareTaxRemittanceRunInput[K],
  ) {
    setCreateForms((current) => ({
      ...current,
      [periodId]: {
        ...(current[periodId] ?? createDefaults[periodId]!),
        [key]: value,
      },
    }));
  }

  function updateStatusField<K extends keyof UpdateTaxRemittanceRunStatusInput>(
    runId: string,
    key: K,
    value: UpdateTaxRemittanceRunStatusInput[K],
  ) {
    setStatusForms((current) => ({
      ...current,
      [runId]: {
        ...(current[runId] ?? {
          runId,
          status: "draft",
          confirmationRef: "",
          failureCode: "",
          failureDetails: "",
        }),
        [key]: value,
      },
    }));
  }

  function runAction(action: () => Promise<void>, periodId: string) {
    setError(null);
    setSuccess(null);
    setActivePeriodId(periodId);

    startTransition(async () => {
      try {
        await action();
        router.refresh();
      } catch (submissionError) {
        setError(submissionError instanceof Error ? submissionError.message : "Unable to update tax execution.");
      } finally {
        setActivePeriodId(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">
            Execution Control
          </p>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Prepare execution runs, record filing outcomes, and keep payment or portal failures visible without moving the page into a conversational mode.
          </p>
        </div>
        <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
          {periods.flatMap((period) => period.remittanceRuns ?? []).length} tracked run{periods.flatMap((period) => period.remittanceRuns ?? []).length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Filing owner</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{filingOwner.replaceAll("_", " ")}</p>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Handoff mode</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">{handoffMode.replaceAll("_", " ")}</p>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Automation boundary</p>
          <p className="mt-1 text-sm text-[var(--dpf-text)]">
            Scheduled coworker runs only proceed when a ready period and an active authority credential both exist.
          </p>
        </div>
      </div>

      {(error || success) ? (
        <div className="mt-4 flex flex-col gap-2">
          {error ? <p className="text-xs text-[var(--dpf-danger)]">{error}</p> : null}
          {success ? <p className="text-xs text-[var(--dpf-muted)]">{success}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {periods.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
            No periods are available for execution yet.
          </div>
        ) : (
          periods.map((period) => {
            const latestRun = period.remittanceRuns?.[0] ?? null;
            const createForm = createForms[period.id] ?? createDefaults[period.id]!;
            const statusForm = latestRun
              ? (statusForms[latestRun.id] ?? {
                  runId: latestRun.id,
                  status: latestRun.status as UpdateTaxRemittanceRunStatusInput["status"],
                  confirmationRef: latestRun.confirmationRef ?? "",
                  failureCode: latestRun.failureCode ?? "",
                  failureDetails: latestRun.failureDetails ?? "",
                })
              : null;

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
                      {period.periodId} · due {new Date(period.dueDate).toLocaleDateString("en-GB")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                      period {period.status}
                    </span>
                    {latestRun ? (
                      <span className="rounded-full border border-[var(--dpf-border)] px-2.5 py-1 text-[11px] text-[var(--dpf-text)]">
                        run {latestRun.status}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Create or refresh run</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="text-xs text-[var(--dpf-muted)]">
                        Execution mode
                        <select
                          value={createForm.executionMode}
                          onChange={(event) => updateCreateField(period.id, "executionMode", event.target.value as PrepareTaxRemittanceRunInput["executionMode"])}
                          className={`mt-1 w-full ${inputClasses}`}
                        >
                          <option value="manual" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Manual</option>
                          <option value="scheduled_coworker" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">Scheduled coworker</option>
                          <option value="external_handoff" className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">External handoff</option>
                        </select>
                      </label>

                      <label className="text-xs text-[var(--dpf-muted)]">
                        Schedule for
                        <input
                          type="datetime-local"
                          value={createForm.scheduleFor ?? ""}
                          onChange={(event) => updateCreateField(period.id, "scheduleFor", event.target.value)}
                          className={`mt-1 w-full ${inputClasses}`}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        type="button"
                        className="rounded bg-[var(--dpf-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                        disabled={isPending}
                        onClick={() =>
                          runAction(async () => {
                            await prepareTaxRemittanceRun(createForm);
                            setSuccess("Execution run saved.");
                          }, period.id)
                        }
                      >
                        {isPending && activePeriodId === period.id ? "Saving..." : "Save execution run"}
                      </button>
                      {latestRun ? (
                        <span className="text-xs text-[var(--dpf-muted)]">
                          Latest run {latestRun.runId} · {formatDateTime(latestRun.scheduledFor)}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-3">
                    <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Latest outcome</p>
                    {latestRun && statusForm ? (
                      <div className="mt-3 space-y-3">
                        <p className="text-xs text-[var(--dpf-muted)]">
                          Scheduled {formatDateTime(latestRun.scheduledFor)}
                          {latestRun.failureDetails ? ` · ${latestRun.failureDetails}` : ""}
                        </p>

                        <label className="block text-xs text-[var(--dpf-muted)]">
                          Confirmation reference
                          <input
                            value={statusForm.confirmationRef ?? ""}
                            onChange={(event) => updateStatusField(latestRun.id, "confirmationRef", event.target.value)}
                            className={`mt-1 w-full ${inputClasses}`}
                            placeholder="Portal confirmation or payment ref"
                          />
                        </label>

                        <label className="block text-xs text-[var(--dpf-muted)]">
                          Failure details
                          <input
                            value={statusForm.failureDetails ?? ""}
                            onChange={(event) => updateStatusField(latestRun.id, "failureDetails", event.target.value)}
                            className={`mt-1 w-full ${inputClasses}`}
                            placeholder="Login failure, MFA challenge, insufficient funds..."
                          />
                        </label>

                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-bg)] disabled:opacity-60"
                            disabled={isPending}
                            onClick={() =>
                              runAction(async () => {
                                await updateTaxRemittanceRunStatus({
                                  ...statusForm,
                                  status: "submitted",
                                });
                                setSuccess("Run marked submitted.");
                              }, period.id)
                            }
                          >
                            Mark submitted
                          </button>
                          <button
                            type="button"
                            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-bg)] disabled:opacity-60"
                            disabled={isPending}
                            onClick={() =>
                              runAction(async () => {
                                await updateTaxRemittanceRunStatus({
                                  ...statusForm,
                                  status: "paid",
                                });
                                setSuccess("Run marked paid.");
                              }, period.id)
                            }
                          >
                            Mark paid
                          </button>
                          <button
                            type="button"
                            className="rounded border border-[var(--dpf-border)] px-3 py-2 text-sm text-[var(--dpf-text)] transition-colors hover:bg-[var(--dpf-bg)] disabled:opacity-60"
                            disabled={isPending}
                            onClick={() =>
                              runAction(async () => {
                                await updateTaxRemittanceRunStatus({
                                  ...statusForm,
                                  status: "failed",
                                  failureCode: statusForm.failureCode || "manual_failure",
                                });
                                setSuccess("Run marked failed.");
                              }, period.id)
                            }
                          >
                            Mark failed
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-bg)] px-4 py-5 text-sm text-[var(--dpf-muted)]">
                        No execution run has been recorded for this period yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
