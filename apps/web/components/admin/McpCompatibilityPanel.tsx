"use client";

import {
  DataTable,
  EmptyState,
  Notice,
  StatCard,
  StatusBadge,
  type Column,
} from "@/components/ui/report-kit";
import type { McpCompatibilityReadModel } from "@/lib/mcp/compatibility-read-model";

type ClientRow = McpCompatibilityReadModel["clients"][number];

function formatObservedAt(value: string | null): string {
  if (!value) return "Not observed";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const CLIENT_COLUMNS: Column<ClientRow>[] = [
  {
    key: "client",
    header: "Client",
    cell: (row) => (
      <div>
        <p className="font-medium text-[var(--dpf-text)]">{row.clientKind}</p>
        <p className="text-xs text-[var(--dpf-muted)]">{row.currentVersion ?? "Version not reported"}</p>
      </div>
    ),
    sortAccessor: (row) => row.clientKind,
  },
  {
    key: "surface",
    header: "Surface / owner",
    cell: (row) => (
      <div>
        <p className="text-sm text-[var(--dpf-text)]">{row.surface}</p>
        <p className="text-xs text-[var(--dpf-muted)]">{row.owner}</p>
      </div>
    ),
    sortAccessor: (row) => row.surface,
  },
  {
    key: "protocol",
    header: "Conformance",
    cell: (row) => (
      <div className="space-y-1">
        <StatusBadge
          intent={row.conformanceStatus === "conforming"
            ? "success"
            : row.conformanceStatus === "legacy"
              ? "warning"
              : row.conformanceStatus === "gated" ? "info" : "neutral"}
          label={row.conformanceStatus}
          uppercase={false}
        />
        <p className="font-mono text-xs text-[var(--dpf-muted)]">{row.currentProtocolVersion}</p>
      </div>
    ),
    sortAccessor: (row) => row.conformanceStatus,
  },
  {
    key: "tasks",
    header: "Official Tasks",
    cell: (row) => (
      <StatusBadge
        intent={row.tasksExtensionObserved ? "success" : "neutral"}
        label={row.tasksExtensionObserved ? "Observed" : "Not observed"}
        uppercase={false}
      />
    ),
    sortAccessor: (row) => row.tasksExtensionObserved ? 1 : 0,
  },
  {
    key: "lastSeen",
    header: "Last seen",
    cell: (row) => (
      <div>
        <p className="text-sm text-[var(--dpf-text)]">{formatObservedAt(row.lastSeenAt)}</p>
        <p className="text-xs text-[var(--dpf-muted)]">
          {row.requestCount.toLocaleString()} requests · {row.compatibilityFailures.toLocaleString()} failures
        </p>
      </div>
    ),
    sortAccessor: (row) => row.lastSeenAt ? Date.parse(row.lastSeenAt) : 0,
  },
  {
    key: "blocker",
    header: "Blocker",
    cell: (row) => row.blocker ?? "None observed",
    sortAccessor: (row) => row.blocker ?? "",
  },
];

export function McpCompatibilityPanel({ model }: { model: McpCompatibilityReadModel }) {
  const hasObservations = model.summary.totalRequests > 0;

  return (
    <section
      aria-labelledby="mcp-compatibility-heading"
      className="mt-6 rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 id="mcp-compatibility-heading" className="text-base font-semibold text-[var(--dpf-text)]">
            MCP compatibility
          </h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Adoption and resource evidence for the stateless 2026-07-28 protocol and official Tasks.
          </p>
        </div>
        <StatusBadge
          intent={model.retirement.ready ? "success" : "warning"}
          label={model.retirement.ready ? "Legacy retirement ready" : "Legacy retirement blocked"}
          uppercase={false}
          size="md"
        />
      </div>

      <Notice
        className="mt-4"
        variant={model.retirement.ready ? "success" : "warn"}
        title={model.retirement.ready ? "All retirement gates are evidenced" : "Legacy support stays enabled"}
      >
        {model.retirement.ready
          ? "The observation window, client matrix, rollback drill, and explicit operator approval are complete."
          : `${model.retirement.blockers.length} retirement gate${model.retirement.blockers.length === 1 ? "" : "s"} remain open. No compatibility path is removed automatically.`}
      </Notice>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Modern requests"
          value={`${model.summary.modernSharePercent}%`}
          hint={`${model.summary.modernRequests.toLocaleString()} of ${model.summary.totalRequests.toLocaleString()} observed`}
          intent={model.summary.legacyRequests === 0 && hasObservations ? "success" : "warning"}
        />
        <StatCard
          label="Suspended tasks"
          value={model.resources.peakSuspendedTasks ?? "—"}
          hint="Peak durable work outside request memory"
          intent="info"
        />
        <StatCard
          label="Concurrent requests"
          value={model.resources.peakActiveRequests}
          hint="Peak MCP requests held at once"
          intent="neutral"
        />
        <StatCard
          label="Process RSS sample"
          value={model.resources.peakProcessRssMiB === null ? "—" : `${model.resources.peakProcessRssMiB} MiB`}
          hint="Whole-process peak; validate change after rollout"
          intent="neutral"
        />
      </div>

      <p className="mt-3 text-xs text-[var(--dpf-muted)]">
        Payloads, credentials, task IDs, GAIDs, and internal agent topology are excluded from this telemetry.
      </p>

      <details className="mt-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-text)]">
          Client compatibility matrix
        </summary>
        <div className="border-t border-[var(--dpf-border)] p-4">
          {model.clients.length === 0 ? (
            <EmptyState
              size="sm"
              title="No MCP compatibility observations yet"
              description="Retirement remains blocked until known clients have exercised this install."
            />
          ) : (
            <DataTable
              ariaLabel="MCP client compatibility observations"
              columns={CLIENT_COLUMNS}
              rows={model.clients}
              getRowKey={(row) => row.key}
              initialSort={{ key: "lastSeen", dir: "desc" }}
              dense
            />
          )}
        </div>
      </details>

      <details className="mt-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-text)]">
          Retirement gates ({model.retirement.criteria.filter((criterion) => criterion.satisfied).length}/{model.retirement.criteria.length})
        </summary>
        <ul className="space-y-3 border-t border-[var(--dpf-border)] p-4">
          {model.retirement.criteria.map((criterion) => (
            <li key={criterion.key} className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-[var(--dpf-text)]">{criterion.label}</p>
                <p className="mt-0.5 text-xs text-[var(--dpf-muted)]">{criterion.evidence}</p>
              </div>
              <StatusBadge
                intent={criterion.satisfied ? "success" : "warning"}
                label={criterion.satisfied ? "Satisfied" : "Blocked"}
                uppercase={false}
              />
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
