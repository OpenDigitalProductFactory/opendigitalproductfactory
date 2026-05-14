"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ExternalLink, LoaderCircle, Play } from "lucide-react";
import { deleteBacklogItem, escalateBacklogItemUpstream } from "@/lib/actions/backlog";
import { startBacklogBuild } from "@/lib/actions/backlog-build";
import { type BacklogItemWithRelations } from "@/lib/backlog";
import { resolveBacklogBuildActionState } from "@/lib/backlog-build-action-state";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";

type Props = {
  item: BacklogItemWithRelations;
  onEdit: (item: BacklogItemWithRelations) => void;
  focused?: boolean;
};

export function BacklogItemRow({ item, onEdit, focused = false }: Props) {
  const router = useRouter();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [escalateMessage, setEscalateMessage] = useState<string | null>(null);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);

  function handleDelete() {
    startTransition(async () => {
      await deleteBacklogItem(item.id);
      router.refresh();
    });
  }

  function handleEscalate() {
    setEscalateMessage(null);
    startTransition(async () => {
      const result = await escalateBacklogItemUpstream(item.id);
      if (result.status === "created") {
        setEscalateMessage(`reported as #${result.issueNumber}`);
        router.refresh();
      } else if (result.status === "skipped") {
        setEscalateMessage(`skipped: ${result.reason}`);
      } else {
        setEscalateMessage(`failed: ${result.error}`);
      }
    });
  }

  function handleStartBuild() {
    setBuildMessage(null);
    startTransition(async () => {
      const result = await startBacklogBuild(item.itemId);
      if (result.status === "created" || result.status === "existing") {
        setBuildMessage(result.status === "created" ? "build draft created" : "opening active build");
        router.push(result.href);
        router.refresh();
      } else if (result.status === "blocked") {
        setBuildMessage(`blocked: ${result.error}`);
      }
    });
  }

  const buildAction = resolveBacklogBuildActionState(item);

  return (
    <div
      id={`backlog-item-${item.itemId}`}
      aria-current={focused ? "true" : undefined}
      className={[
        "flex scroll-mt-24 flex-wrap items-start gap-3 rounded-lg border p-3",
        focused
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]",
      ].join(" ")}
    >
      {/* Priority badge */}
      <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]">
        {item.priority ?? "—"}
      </span>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">{item.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
          {item.agentId ? ` · ${AGENT_NAME_MAP[item.agentId] ?? item.agentId}` : ""}
          {item.submittedBy ? ` · by ${item.submittedBy.email}` : ""}
          {" · "}{new Date(item.createdAt).toLocaleDateString()}
          {item.completedAt ? ` · done ${new Date(item.completedAt).toLocaleDateString()}` : ""}
        </p>
      </div>

      {/* Product link */}
      {item.digitalProduct && (
        <Link
          href={`/portfolio/product/${item.digitalProduct.id}/backlog`}
          className="shrink-0 text-[9px] text-[var(--dpf-accent)] hover:underline px-1"
          title={`View in ${item.digitalProduct.name}`}
        >
          product
        </Link>
      )}

      {/* Upstream-issue link — only when this item has been escalated */}
      {item.upstreamIssueNumber != null && item.upstreamIssueUrl && (
        <a
          href={item.upstreamIssueUrl}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[9px] text-[var(--dpf-accent)] hover:underline px-1"
          title="Filed with the project team"
        >
          GH #{item.upstreamIssueNumber}
        </a>
      )}

      {/* Status badge */}
      <span
        className={[
          "shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold",
          statusBadgeClassName(item.status),
        ].join(" ")}
      >
        {item.status}
      </span>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1">
        {confirmDelete ? (
          <>
            <button
              onClick={handleDelete}
              disabled={isPending}
              className="text-[10px] text-[var(--dpf-error)] hover:opacity-80 px-1"
            >
              {isPending ? "…" : "confirm"}
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1"
            >
              cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => onEdit(item)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] px-1"
              aria-label="Edit"
            >
              edit
            </button>
            <BacklogBuildActionButton
              action={buildAction}
              isPending={isPending}
              onStart={handleStartBuild}
            />
            {item.upstreamIssueNumber == null && (
              <button
                onClick={handleEscalate}
                disabled={isPending}
                className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-accent)] px-1"
                aria-label="Report to project team"
                title="Open a GitHub issue with the project team"
              >
                {isPending ? "…" : "report"}
              </button>
            )}
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[10px] text-[var(--dpf-muted)] hover:text-[var(--dpf-error)] px-1"
              aria-label="Delete"
            >
              del
            </button>
          </>
        )}
      </div>
      {escalateMessage && (
        <p className="w-full text-[10px] text-[var(--dpf-muted)] mt-1">{escalateMessage}</p>
      )}
      {buildMessage && (
        <p className="w-full text-[10px] text-[var(--dpf-muted)] mt-1">{buildMessage}</p>
      )}
    </div>
  );
}

function BacklogBuildActionButton({
  action,
  isPending,
  onStart,
}: {
  action: ReturnType<typeof resolveBacklogBuildActionState>;
  isPending: boolean;
  onStart: () => void;
}) {
  if (action.kind === "start") {
    return (
      <button
        onClick={onStart}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-accent)] transition-colors hover:bg-[var(--dpf-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Start Build Studio draft"
      >
        {isPending ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        <span>{isPending ? "Starting" : action.label}</span>
      </button>
    );
  }

  if (action.kind === "resume" || action.kind === "open") {
    return (
      <Link
        href={action.href}
        className="inline-flex items-center gap-1 rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)] transition-colors hover:border-[var(--dpf-accent)] hover:text-[var(--dpf-accent)]"
        aria-label={`${action.label} in Build Studio`}
      >
        <ExternalLink className="h-3 w-3" />
        <span>{action.label}</span>
      </Link>
    );
  }

  return (
    <span
      className="inline-flex cursor-help items-center gap-1 rounded border border-[var(--dpf-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]"
      title={action.reason}
      aria-label={`${action.label}: ${action.reason}`}
    >
      <AlertTriangle className="h-3 w-3" />
      <span>{action.label}</span>
    </span>
  );
}

function statusBadgeClassName(status: string): string {
  const classes: Record<string, string> = {
    triaging: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
    open: "border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] text-[var(--dpf-text)]",
    "in-progress": "border-[var(--dpf-warning)]/30 bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]",
    done: "border-[var(--dpf-success)]/30 bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]",
    deferred: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  };

  return classes[status] ?? classes.deferred;
}
