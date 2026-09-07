"use client";

import { memo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ExternalLink, Play, RotateCcw } from "lucide-react";
import { Spinner } from "@/components/ui/Spinner";
import { LocalTime } from "@/components/ui/LocalTime";
import { StatusBadge } from "@/components/ui/report-kit/StatusBadge";
import { deleteBacklogItem, escalateBacklogItemUpstream } from "@/lib/actions/backlog";
import { startBacklogBuild } from "@/lib/actions/backlog-build";
import { type BacklogItemWithRelations } from "@/lib/backlog";
import { resolveBacklogBuildActionState } from "@/lib/backlog-build-action-state";
import { AGENT_NAME_MAP } from "@/lib/agent-routing";
import { backlogItemOrigin, BACKLOG_ORIGIN_LABEL } from "@/lib/operate/backlog-origin";
import { backlogItemLifecycleLabel } from "@/lib/backlog-visibility";

type Props = {
  item: BacklogItemWithRelations;
  onEdit: (item: BacklogItemWithRelations) => void;
  focused?: boolean;
};

// Memoized: on /ops hundreds of rows can be mounted at once (expanded epics +
// the triage band). Without this, any OpsClient state change (filters, opening a
// panel, toggling the triage band) re-renders every mounted row. Props are
// primitives + a stable onEdit callback, so referential equality holds.
export const BacklogItemRow = memo(BacklogItemRowImpl);

function BacklogItemRowImpl({ item, onEdit, focused = false }: Props) {
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
  const lifecycleLabel = backlogItemLifecycleLabel(item);
  const deferralReviewDue = item.status === "deferred" && item.deferReviewAt
    ? new Date(item.deferReviewAt).getTime() <= Date.now()
    : false;
  const deferralComplete = Boolean(
    item.deferReason && item.deferTrigger && item.deferReviewAt
      && item.deferOwnerPrincipalId && item.deferredAt,
  );

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

      {/* Work-type badge */}
      <WorkTypeBadge workType={item.workType} />

      {/* Altitude signal (BI-9952EA9E) — effort size, so a trivial tweak doesn't
          read with the same weight as a platform-scale item. */}
      <EffortSizeBadge effortSize={item.effortSize} />
      <DeliveryShapeBadge workrooms={item.activeWorkrooms ?? []} />

      {/* Origin badge — which source this work came from (improvements,
          capability needs, issue reports, signals…), now that /ops is the one
          place every source is seen and worked. */}
      <OriginBadge item={item} />

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight truncate">{item.title}</p>
        <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
          {item.taxonomyNode?.nodeId ?? "—"}
          {item.source ? ` · via ${item.source}` : ""}
          {item.digitalProduct ? ` · ${item.digitalProduct.name}` : ""}
          {item.agentId ? ` · ${AGENT_NAME_MAP[item.agentId] ?? item.agentId}` : ""}
          {item.submittedBy ? ` · by ${item.submittedBy.email}` : ""}
          {" · "}<LocalTime value={item.createdAt} mode="date" />
          {item.completedAt ? (
            <> · {lifecycleLabel === "retired duplicate" ? "retired" : lifecycleLabel}{" "}
              <LocalTime value={item.completedAt} mode="date" />
            </>
          ) : null}
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
          title="Project issue"
        >
          GH #{item.upstreamIssueNumber}
        </a>
      )}

      {/* Status badge */}
      <span
        className="shrink-0"
        title={
          lifecycleLabel === "retired duplicate"
            ? "Retired because another backlog item is the canonical record."
            : item.status === "deferred"
              ? deferralComplete
                ? "Deferred with review policy."
                : "Needs deferral review."
              : undefined
        }
      >
        <StatusBadge
          domain="backlogItem"
          status={item.status}
          label={lifecycleLabel}
          uppercase={false}
        />
      </span>

      {item.status === "deferred" ? (
        <div className="w-full rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-2 text-dpf-caption text-[var(--dpf-muted)]">
          {deferralComplete ? (
            <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4">
              <span><strong className="text-[var(--dpf-text)]">Reason:</strong> {item.deferReason}</span>
              <span><strong className="text-[var(--dpf-text)]">Trigger:</strong> {item.deferTrigger}</span>
              <span><strong className="text-[var(--dpf-text)]">Owner:</strong> {item.deferOwnerPrincipal?.displayName ?? "Unknown principal"}</span>
              <span className={deferralReviewDue ? "text-[var(--dpf-error)]" : undefined}>
                <strong className="text-[var(--dpf-text)]">Review:</strong>{" "}
                <LocalTime value={item.deferReviewAt ?? null} />
                {deferralReviewDue ? " · overdue" : ""}
              </span>
            </div>
          ) : (
            <span className="text-[var(--dpf-error)]">Incomplete deferral · review needed</span>
          )}
        </div>
      ) : null}

      <ActiveWorkroomOwnership workrooms={item.activeWorkrooms ?? []} />

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
                aria-label="Report issue"
                title="Open project issue"
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

function executorLabel(value: string | null): string {
  if (!value) return "Unassigned";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ActiveWorkroomOwnership({
  workrooms,
}: {
  workrooms: NonNullable<BacklogItemWithRelations["activeWorkrooms"]>;
}) {
  if (workrooms.length === 0) return null;
  return (
    <div
      className="w-full rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent-soft)] p-2"
      aria-label="Active Workroom ownership"
    >
      <p className="text-dpf-caption font-dpf-semibold text-[var(--dpf-text)]">
        {workrooms.length === 1 ? "Workroom active" : `${workrooms.length} Workrooms active`}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-dpf-caption text-[var(--dpf-muted)]">
        {workrooms.map((room) => (
          <div key={room.capsuleId} className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              href={`/workspace/cases/${room.capsuleId}`}
              className="font-dpf-medium text-[var(--dpf-accent)] hover:underline"
            >
              {room.title}
            </Link>
            <StatusBadge domain="workroom" status={room.status} label={room.status.replaceAll("-", " ")} uppercase={false} />
            <span>{executorLabel(room.executorKind)}</span>
            {room.headBranch ? <span className="font-mono">{room.headBranch}</span> : null}
            <span>{room.liveness.replaceAll("-", " ")}</span>
          </div>
        ))}
      </div>
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
  if (action.kind === "start" || action.kind === "rebuild") {
    // "rebuild" fires the same server action as "start"; startBacklogBuild
    // (BI-08AE51DC) detaches the abandoned draft and promotes a fresh one, so the
    // operator gets a real terminal action instead of a Resume link that
    // re-strands the dead draft (BI-99D896CF).
    const isRebuild = action.kind === "rebuild";
    return (
      <button
        onClick={onStart}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded border border-[var(--dpf-accent)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-accent)] transition-colors hover:bg-[var(--dpf-accent-soft)] disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={isRebuild ? "Rebuild — start a fresh Build Studio draft" : "Start Build Studio draft"}
        title={isRebuild ? "The previous draft was abandoned. Start a fresh build." : undefined}
      >
        {isPending ? (
          <Spinner size="xs" tone="current" presentational />
        ) : isRebuild ? (
          <RotateCcw className="h-3 w-3" />
        ) : (
          <Play className="h-3 w-3" />
        )}
        <span>{isPending ? (isRebuild ? "Rebuilding" : "Starting") : action.label}</span>
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

const WORK_TYPE_BADGE_CLASS: Record<string, string> = {
  bug: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]",
  feature: "border-[var(--dpf-accent)]/40 bg-[var(--dpf-accent-soft)] text-[var(--dpf-accent)]",
  chore: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
  doc: "border-[var(--dpf-info)]/40 bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]",
  tool: "border-[var(--dpf-info)]/40 bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]",
  skill: "border-[var(--dpf-info)]/40 bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]",
  refactor: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]",
};

function OriginBadge({ item }: { item: BacklogItemWithRelations }) {
  const origin = backlogItemOrigin(item);
  if (origin === "unknown") return null;
  return (
    <span
      className="shrink-0 rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--dpf-muted)]"
      title={`origin: ${BACKLOG_ORIGIN_LABEL[origin]} — every source is seen and worked here in Operations`}
    >
      {BACKLOG_ORIGIN_LABEL[origin]}
    </span>
  );
}

const EFFORT_SIZE_BADGE: Record<string, { label: string; cls: string }> = {
  small: { label: "S", cls: "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]" },
  medium: { label: "M", cls: "border-[var(--dpf-info)]/40 bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]" },
  large: { label: "L", cls: "border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]" },
  xlarge: { label: "XL", cls: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]" },
};

/**
 * The delivery shape the item is being worked in (BI-D03BE728, design §3.3):
 * the newest live Workroom's `workShape` claim. Distinct from effort size —
 * the shape is what the work OWES before it is done, and a break-fix or a
 * sensitivity-raised small item does not read from the size alone. Shown only
 * when a live room carries one; an unshaped item shows nothing extra.
 */
const DELIVERY_SHAPE_BADGE: Record<string, { label: string; title: string; cls: string }> = {
  "delivery-break-fix": { label: "BF", title: "break-fix shape", cls: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]" },
  "delivery-small": { label: "small", title: "small shape", cls: "border-[var(--dpf-success)]/40 bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]" },
  "delivery-medium": { label: "medium", title: "medium shape", cls: "border-[var(--dpf-info)]/40 bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]" },
  "delivery-large": { label: "large", title: "large shape", cls: "border-[var(--dpf-warning)]/40 bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]" },
  "delivery-xlarge": { label: "xlarge", title: "xlarge shape", cls: "border-[var(--dpf-error)]/40 bg-[var(--dpf-error)]/10 text-[var(--dpf-error)]" },
};

export function deliveryShapeOf(workrooms: ReadonlyArray<{ isLive: boolean; workShape?: string | null }>): string | null {
  const live = workrooms.find((room) => room.isLive && room.workShape?.startsWith("delivery-"));
  return live?.workShape?.split("@")[0] ?? null;
}

function DeliveryShapeBadge({ workrooms }: { workrooms: ReadonlyArray<{ isLive: boolean; workShape?: string | null }> }) {
  const key = deliveryShapeOf(workrooms);
  const meta = key ? DELIVERY_SHAPE_BADGE[key] : undefined;
  if (!meta) return null;
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-dpf-caption font-semibold ${meta.cls}`}
      title={meta.title}
      aria-label={meta.title}
    >
      {meta.label}
    </span>
  );
}

function EffortSizeBadge({ effortSize }: { effortSize: string | null }) {
  const meta = effortSize ? EFFORT_SIZE_BADGE[effortSize] : undefined;
  if (!meta) {
    return (
      <span
        className="shrink-0 rounded border border-dashed border-[var(--dpf-border)] px-1.5 py-0.5 text-dpf-caption font-semibold text-[var(--dpf-muted)]"
        title="effort size not set — a light altitude signal is missing"
        aria-label="effort size unsized"
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-dpf-caption font-semibold tabular-nums ${meta.cls}`}
      title={`effort size: ${effortSize}`}
      aria-label={`effort size ${effortSize}`}
    >
      {meta.label}
    </span>
  );
}

function WorkTypeBadge({ workType }: { workType: string | null }) {
  const label = workType ?? "unclassified";
  const cls =
    workType && WORK_TYPE_BADGE_CLASS[workType]
      ? WORK_TYPE_BADGE_CLASS[workType]
      : "border-dashed border-[var(--dpf-border)] bg-transparent text-[var(--dpf-muted)]";
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-dpf-caption font-semibold uppercase tracking-wide ${cls}`}
      title={workType ? `work type: ${workType}` : "work type not classified — open and reclassify"}
      aria-label={`work type ${label}`}
    >
      {label}
    </span>
  );
}
