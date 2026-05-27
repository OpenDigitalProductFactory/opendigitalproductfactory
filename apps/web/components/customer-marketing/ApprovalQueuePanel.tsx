import type { OutboundDraftRow } from "@/lib/marketing";
import { formatMarketingLabel } from "@/lib/marketing";
import { ApprovalQueueReview } from "./ApprovalQueueReview";

type Props = {
  drafts: OutboundDraftRow[];
};

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function statusLabel(status: OutboundDraftRow["status"]): string {
  if (status === "needs-changes") return "Needs changes";
  if (status === "pending-review") return "Pending review";
  return status[0]!.toUpperCase() + status.slice(1);
}

export function ApprovalQueuePanel({ drafts }: Props) {
  return (
    <section
      data-testid="marketing-approval-queue"
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Awaiting your review
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
            Drafts the Marketing Strategist produced from your saved asset tasks. Approve, edit, request changes, or reject — no external posting until you say so.
          </p>
        </div>
        <p className="text-sm font-medium text-[var(--dpf-accent)]">
          {drafts.length} {drafts.length === 1 ? "draft" : "drafts"}
        </p>
      </div>

      {drafts.length === 0 ? (
        <p className="mt-4 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-muted)]">
          No drafts awaiting your review. Ask the Marketing Strategist to draft an asset, or click <span className="font-medium text-[var(--dpf-text)]">Draft</span> next to an asset task above.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {drafts.map((draft) => (
            <li
              key={draft.draftId}
              data-draft-id={draft.draftId}
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--dpf-muted)]">
                    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[var(--dpf-text)]">
                      {formatMarketingLabel(draft.channelId)}
                    </span>
                    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[var(--dpf-text)]">
                      {draft.assetType}
                    </span>
                    <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[var(--dpf-text)]">
                      {statusLabel(draft.status)}
                    </span>
                    <span>
                      Drafted by {draft.createdByAgentId ?? "unknown"} · {timeAgo(draft.createdAt)}
                    </span>
                  </div>
                  {draft.assetTaskTitle ? (
                    <p className="mt-2 truncate text-sm font-medium text-[var(--dpf-text)]">
                      {draft.assetTaskTitle}
                    </p>
                  ) : null}
                  <p className="mt-1 line-clamp-3 text-sm text-[var(--dpf-text)]">
                    {draft.body}
                  </p>
                </div>
              </div>
              <div className="mt-3">
                <ApprovalQueueReview
                  draftId={draft.draftId}
                  initialBody={draft.body}
                  assetTaskTitle={draft.assetTaskTitle}
                  channelId={draft.channelId}
                  assetType={draft.assetType}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
