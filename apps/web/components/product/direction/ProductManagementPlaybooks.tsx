"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  rerunAgentTask,
  setAgentTaskActive,
} from "@/lib/actions/agent-task-scheduler";
import { scheduleProductManagementPlaybookAction } from "@/lib/actions/product-management-playbooks";
import {
  buildPlaybookPermissionDigest,
  getProductManagementPlaybook,
  listProductManagementPlaybooksForScope,
  productManagementPlaybookScopeKind,
  type ProductManagementBriefSnapshot,
  type ProductManagementPlaybookId,
} from "@/lib/product-management/product-management-playbook";
import type {
  ProductOperatingScope,
  ScheduledPlaybookContextItem,
} from "@/lib/product-management/product-operating-context";
import type { ProductManagementAdoptionMeasure } from "@/lib/product-management/product-management-adoption";
import { StatusBadge } from "@/components/ui/report-kit";
import type { Intent } from "@/components/ui/report-kit/statusColors";

const SECONDARY_BUTTON =
  "min-h-11 rounded-dpf-md border border-[var(--dpf-border)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] disabled:opacity-50";
const PRIMARY_BUTTON =
  "min-h-11 rounded-dpf-md bg-[var(--dpf-accent)] px-dpf-md py-dpf-sm text-dpf-body font-dpf-medium text-[var(--dpf-surface-1)] disabled:opacity-50";

function formatWhen(value: Date | string | null): string {
  if (!value) return "Not scheduled";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function taskStatus(task: ScheduledPlaybookContextItem): string {
  if (!task.isActive) return "Paused";
  if (task.permissionsCurrent === false) return "Preview required";
  if (task.lastStatus === "partial") {
    return "Partial — the prior successful result remains current";
  }
  if (task.lastStatus === "error") return "Failed";
  if (task.lastStatus === "unchanged") return "Checked — no source change";
  if (task.lastStatus === "ok") return "Current";
  return "Scheduled";
}

function taskIntent(task: ScheduledPlaybookContextItem): Intent {
  if (task.lastStatus === "error") return "danger";
  if (!task.isActive || task.lastStatus === "partial") return "warning";
  if (task.permissionsCurrent === false) return "warning";
  if (task.lastStatus === "ok" || task.lastStatus === "unchanged") {
    return "success";
  }
  return "info";
}

function downloadSnapshot(snapshot: ProductManagementBriefSnapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `product-brief-${snapshot.scope.kind}-${snapshot.generatedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProductManagementPlaybooks({
  scope,
  audience,
  scheduledPlaybooks,
  snapshot,
  adoptionEvidence,
}: {
  scope: ProductOperatingScope;
  audience: "guided" | "professional";
  scheduledPlaybooks: readonly ScheduledPlaybookContextItem[];
  snapshot: ProductManagementBriefSnapshot;
  adoptionEvidence: readonly ProductManagementAdoptionMeasure[];
}) {
  const recipes = useMemo(
    () =>
      listProductManagementPlaybooksForScope(
        productManagementPlaybookScopeKind(scope.kind),
      ),
    [scope.kind],
  );
  const [selectedId, setSelectedId] = useState<ProductManagementPlaybookId>(
    recipes[0]!.id,
  );
  const [previewDigest, setPreviewDigest] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const selected = getProductManagementPlaybook(selectedId);
  const digest = buildPlaybookPermissionDigest(selected);
  const previewed = previewDigest === digest;

  const selectRecipe = (recipeId: ProductManagementPlaybookId) => {
    setSelectedId(recipeId);
    setPreviewDigest(null);
    setMessage(null);
  };

  const scheduleSelected = () => {
    startTransition(async () => {
      const result = await scheduleProductManagementPlaybookAction({
        scope,
        recipeId: selected.id,
        approvedPermissionsDigest: digest,
        schedule: selected.recommendedSchedule.cron,
      });
      setMessage(result.ok ? result.message : result.error);
      if (result.ok) setPreviewDigest(null);
    });
  };

  const changeTask = (
    task: ScheduledPlaybookContextItem,
    action: "pause" | "resume" | "rerun",
  ) => {
    startTransition(async () => {
      const result =
        action === "rerun"
          ? await rerunAgentTask(task.taskId)
          : await setAgentTaskActive(task.taskId, action === "resume");
      setMessage(
        result.success
          ? `${task.title} ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "queued for rerun"}.`
          : result.error ?? "The task could not be changed.",
      );
    });
  };

  return (
    <section
      aria-labelledby="product-management-playbooks"
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
    >
      <div className="flex flex-col gap-dpf-md lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-dpf-caption font-dpf-semibold uppercase tracking-wide text-[var(--dpf-accent)]">
            Recurring product work
          </p>
          <h2
            id="product-management-playbooks"
            className="mt-dpf-xs text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
          >
            Coworker playbooks
          </h2>
          <p className="mt-dpf-xs max-w-prose text-dpf-body text-[var(--dpf-muted)]">
            {audience === "guided"
              ? "Choose a useful review, see exactly what it can read or propose, then decide whether to schedule it."
              : "Schedule typed, scope-bound workflows over canonical Product Operating Context. Derived outputs preserve provenance and approval boundaries."}
          </p>
        </div>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => downloadSnapshot(snapshot)}
        >
          Export owner brief
        </button>
      </div>

      <div className="mt-dpf-lg grid gap-dpf-lg xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <label
            htmlFor="product-management-playbook"
            className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]"
          >
            What should your coworker prepare?
          </label>
          <select
            id="product-management-playbook"
            value={selectedId}
            onChange={(event) =>
              selectRecipe(event.target.value as ProductManagementPlaybookId)
            }
            className="mt-dpf-xs min-h-11 w-full rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-dpf-md text-dpf-body text-[var(--dpf-text)]"
          >
            {recipes.map((recipe) => (
              <option
                key={recipe.id}
                value={recipe.id}
                className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]"
              >
                {audience === "guided" ? recipe.shortLabel : recipe.label}
              </option>
            ))}
          </select>
          <p className="mt-dpf-sm text-dpf-body text-[var(--dpf-muted)]">
            {audience === "guided"
              ? selected.guidance.ownerOperator
              : selected.guidance.productManager}
          </p>
          <dl className="mt-dpf-md grid gap-dpf-sm text-dpf-body sm:grid-cols-2">
            <div>
              <dt className="text-[var(--dpf-muted)]">Suggested cadence</dt>
              <dd className="font-dpf-medium text-[var(--dpf-text)]">
                {selected.recommendedSchedule.label}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--dpf-muted)]">Output</dt>
              <dd className="font-dpf-medium text-[var(--dpf-text)]">
                Derived {selected.output.type.replaceAll("-", " ")}
              </dd>
            </div>
          </dl>
          <button
            type="button"
            className={`${previewed ? SECONDARY_BUTTON : PRIMARY_BUTTON} mt-dpf-md`}
            onClick={() => {
              setPreviewDigest(digest);
              setMessage(null);
            }}
          >
            {previewed ? "Preview refreshed" : "Preview first run"}
          </button>
        </div>

        <div
          aria-live="polite"
          className="rounded-dpf-md bg-[var(--dpf-surface-2)] p-dpf-md"
        >
          {previewed ? (
            <>
              <h3 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
                Confirm this boundary
              </h3>
              <p className="mt-dpf-xs text-dpf-body text-[var(--dpf-muted)]">
                Scope: {scope.kind.replace("-", " ")} ·{" "}
                {audience === "guided"
                  ? "Current permission set verified"
                  : `Permission preview ${digest}`}
              </p>
              <details className="mt-dpf-md" open={audience === "professional"}>
                <summary className="cursor-pointer text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                  Evidence, tools, and proposed writes
                </summary>
                <div className="mt-dpf-sm grid gap-dpf-md md:grid-cols-3">
                  <div>
                    <h4 className="text-dpf-caption font-dpf-semibold text-[var(--dpf-text)]">
                      Reads
                    </h4>
                    <ul className="mt-dpf-xs list-disc space-y-dpf-xs pl-dpf-lg text-dpf-caption text-[var(--dpf-muted)]">
                      {selected.canonicalInputs.map((source) => (
                        <li key={source}>{source.replaceAll("-", " ")}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-dpf-caption font-dpf-semibold text-[var(--dpf-text)]">
                      Tools
                    </h4>
                    <ul className="mt-dpf-xs list-disc space-y-dpf-xs pl-dpf-lg text-dpf-caption text-[var(--dpf-muted)]">
                      {selected.allowedTools.map((tool) => (
                        <li key={tool}>{tool.replaceAll("_", " ")}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-dpf-caption font-dpf-semibold text-[var(--dpf-text)]">
                      Proposes
                    </h4>
                    <ul className="mt-dpf-xs list-disc space-y-dpf-xs pl-dpf-lg text-dpf-caption text-[var(--dpf-muted)]">
                      {selected.proposedWrites.map((write) => (
                        <li key={write.authority}>
                          {write.authority} after approval
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </details>
              <p className="mt-dpf-md text-dpf-caption text-[var(--dpf-muted)]">
                {selected.approvalBoundary} {selected.failureBehavior}
              </p>
              <button
                type="button"
                className={`${PRIMARY_BUTTON} mt-dpf-md`}
                disabled={isPending}
                onClick={scheduleSelected}
              >
                {isPending
                  ? "Scheduling…"
                  : `Confirm ${selected.recommendedSchedule.label.toLowerCase()} schedule`}
              </button>
            </>
          ) : (
            <>
              <h3 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
                Preview required
              </h3>
              <p className="mt-dpf-xs text-dpf-body text-[var(--dpf-muted)]">
                Scheduling remains unavailable until the current evidence,
                tool, write, and approval scope is shown here.
              </p>
            </>
          )}
        </div>
      </div>

      {message ? (
        <p
          role="status"
          className="mt-dpf-md rounded-dpf-md border border-[var(--dpf-border)] p-dpf-sm text-dpf-body text-[var(--dpf-text)]"
        >
          {message}
        </p>
      ) : null}

      <div className="mt-dpf-xl">
        <h3 className="text-dpf-heading font-dpf-semibold text-[var(--dpf-text)]">
          Scheduled for this scope
        </h3>
        {scheduledPlaybooks.length === 0 ? (
          <p className="mt-dpf-sm text-dpf-body text-[var(--dpf-muted)]">
            Nothing runs automatically. Preview and confirm a cadence when it
            would save useful work.
          </p>
        ) : (
          <ul className="mt-dpf-md grid gap-dpf-md lg:grid-cols-2">
            {scheduledPlaybooks.map((task) => (
              <li
                key={task.taskId}
                className="rounded-dpf-md border border-[var(--dpf-border)] p-dpf-md"
              >
                <div className="flex items-start justify-between gap-dpf-md">
                  <div>
                    <h4 className="font-dpf-semibold text-[var(--dpf-text)]">
                      {task.title}
                    </h4>
                    <StatusBadge
                      className="mt-dpf-xs"
                      intent={taskIntent(task)}
                      label={taskStatus(task)}
                      uppercase={false}
                    />
                  </div>
                  <StatusBadge
                    intent="neutral"
                    label={task.scope.replace("-", " ")}
                    uppercase={false}
                  />
                </div>
                <dl className="mt-dpf-md grid gap-dpf-sm text-dpf-caption sm:grid-cols-2">
                  <div>
                    <dt className="text-[var(--dpf-muted)]">Next run</dt>
                    <dd className="text-[var(--dpf-text)]">
                      {formatWhen(task.nextRunAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[var(--dpf-muted)]">Last checked</dt>
                    <dd className="text-[var(--dpf-text)]">
                      {formatWhen(task.lastRunAt)}
                    </dd>
                  </div>
                </dl>
                {task.lastError ? (
                  <p className="mt-dpf-sm text-dpf-caption font-dpf-medium text-[var(--dpf-text)]">
                    {task.lastError}
                  </p>
                ) : null}
                <div className="mt-dpf-md flex flex-wrap gap-dpf-sm">
                  {task.taskRunId ? (
                    <Link
                      className={SECONDARY_BUTTON}
                      href={`/platform/ai/history?taskRunId=${encodeURIComponent(task.taskRunId)}`}
                    >
                      Inspect last run
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    disabled={isPending}
                    onClick={() =>
                      changeTask(task, task.isActive ? "pause" : "resume")
                    }
                  >
                    {task.isActive ? "Pause" : "Resume"}
                  </button>
                  <button
                    type="button"
                    className={SECONDARY_BUTTON}
                    disabled={isPending || task.permissionsCurrent === false}
                    onClick={() => changeTask(task, "rerun")}
                  >
                    Rerun now
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="mt-dpf-xl rounded-dpf-md border border-[var(--dpf-border)] p-dpf-md">
        <summary className="cursor-pointer text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
          Adoption and learning evidence
        </summary>
        <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
          Measures appear only when canonical timestamps and resolution records
          support them.
        </p>
        <dl className="mt-dpf-md grid gap-dpf-md md:grid-cols-2 xl:grid-cols-3">
          {adoptionEvidence.map((measure) => (
            <div key={measure.id}>
              <dt className="text-dpf-caption text-[var(--dpf-muted)]">
                {measure.label}
              </dt>
              <dd className="mt-dpf-xs text-dpf-body font-dpf-semibold text-[var(--dpf-text)]">
                {measure.value == null
                  ? "Unavailable"
                  : `${Math.round(measure.value * 10) / 10}${measure.unit === "percent" ? "%" : measure.unit ? ` ${measure.unit}` : ""}`}
              </dd>
              {measure.reason ? (
                <dd className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
                  {measure.reason}
                </dd>
              ) : null}
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}
