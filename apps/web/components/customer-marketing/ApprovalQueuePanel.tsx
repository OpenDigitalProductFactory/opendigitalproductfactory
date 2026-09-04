import { resolveAgentRoleLabel } from "@dpf/db/agent-identity";
import type { InboundMessageRow, OutboundDraftRow } from "@/lib/marketing";
import { formatMarketingLabel } from "@/lib/marketing";
import { assessArchetypeFit } from "@/lib/marketing/archetype-fit";
import { ApprovalQueueReview } from "./ApprovalQueueReview";
import { ArchetypeFitBadge } from "./ArchetypeFitNotice";
import { PublishLinkedInButton } from "./PublishLinkedInButton";
import { PublishWordPressButton } from "./PublishWordPressButton";
import { PublishEmailButton } from "./PublishEmailButton";

type Props = {
  pendingDrafts: OutboundDraftRow[];
  approvedDrafts: OutboundDraftRow[];
  connectedChannels: string[];
  inboundMessages: InboundMessageRow[];
  /** Active storefront archetype category, for archetype-fit checks. */
  category: string | null;
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

function isLinkedInChannel(channelId: string): boolean {
  return channelId === "linkedin" || channelId === "linkedin-personal-social";
}

function isEmailChannel(channelId: string): boolean {
  return channelId === "email" || channelId === "email-postmark";
}

function isWordPressChannel(channelId: string): boolean {
  return channelId === "wordpress" || channelId === "wordpress-self-hosted";
}

function classificationLabel(value: InboundMessageRow["classification"]): string {
  if (!value) return "Unclassified";
  if (value === "qualified-inquiry") return "Qualified inquiry";
  return value[0]!.toUpperCase() + value.slice(1);
}

function relativeTime(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function DraftRow({
  draft,
  trailing,
  category,
}: {
  draft: OutboundDraftRow;
  trailing: React.ReactNode;
  category: string | null;
}) {
  const fit = assessArchetypeFit({ text: draft.body, category });
  return (
    <li
      data-draft-id={draft.draftId}
      data-fit-severity={fit.severity}
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
              AI-drafted by your {resolveAgentRoleLabel(draft.createdByAgentId)} · {timeAgo(draft.createdAt)}
            </span>
            <ArchetypeFitBadge assessment={fit} />
          </div>
          {draft.assetTaskTitle ? (
            <p className="mt-2 truncate text-sm font-medium text-[var(--dpf-text)]">
              {draft.assetTaskTitle}
            </p>
          ) : null}
          <p className="mt-1 line-clamp-3 text-sm text-[var(--dpf-text)]">{draft.body}</p>
        </div>
      </div>
      <div className="mt-3">{trailing}</div>
    </li>
  );
}

export function ApprovalQueuePanel({
  pendingDrafts,
  approvedDrafts,
  connectedChannels,
  inboundMessages,
  category,
}: Props) {
  const linkedInConnected =
    connectedChannels.includes("linkedin-personal-social") ||
    connectedChannels.includes("linkedin");
  const emailConnected = connectedChannels.includes("email-postmark");
  const wordpressConnected =
    connectedChannels.includes("wordpress-self-hosted") || connectedChannels.includes("wordpress");

  return (
    <div className="space-y-6">
      <section
        id="marketing-approval-queue"
        data-testid="marketing-approval-queue"
        className="scroll-mt-24 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Awaiting your review
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
              Drafts the Marketing Strategist produced from your saved asset tasks.
              Approve, edit, request changes, or reject — no external posting until you say so.
            </p>
          </div>
          <p className="text-sm font-medium text-[var(--dpf-accent)]">
            {pendingDrafts.length} {pendingDrafts.length === 1 ? "draft" : "drafts"}
          </p>
        </div>

        {pendingDrafts.length === 0 ? (
          <p className="mt-4 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-muted)]">
            No drafts awaiting your review. Ask the Marketing Strategist to draft an asset, or
            click <span className="font-medium text-[var(--dpf-text)]">Draft</span> next to an
            asset task above.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {pendingDrafts.map((draft) => (
              <DraftRow
                key={draft.draftId}
                draft={draft}
                category={category}
                trailing={
                  <ApprovalQueueReview
                    draftId={draft.draftId}
                    initialBody={draft.body}
                    assetTaskTitle={draft.assetTaskTitle}
                    channelId={draft.channelId}
                    assetType={draft.assetType}
                    category={category}
                  />
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section
        id="marketing-publish-queue"
        data-testid="marketing-publish-queue"
        className="scroll-mt-24 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">Ready to publish</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
              Approved drafts waiting for an explicit publish action. Each click writes one
              external post — DPF never publishes without it.
            </p>
          </div>
          <p className="text-sm font-medium text-[var(--dpf-accent)]">
            {approvedDrafts.length} {approvedDrafts.length === 1 ? "draft" : "drafts"}
          </p>
        </div>

        {approvedDrafts.length === 0 ? (
          <p className="mt-4 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-muted)]">
            No approved drafts queued. Approve a draft above and it will show up here with a
            Publish button.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {approvedDrafts.map((draft) => (
              <DraftRow
                key={draft.draftId}
                draft={draft}
                category={category}
                trailing={
                  isLinkedInChannel(draft.channelId) ? (
                    <PublishLinkedInButton
                      draftId={draft.draftId}
                      channelConnected={linkedInConnected}
                      channelId="linkedin-personal-social"
                      fitBlocked={assessArchetypeFit({ text: draft.body, category }).blocked}
                      artifactTitle={draft.assetTaskTitle}
                    />
                  ) : isWordPressChannel(draft.channelId) ? (
                    <PublishWordPressButton
                      draftId={draft.draftId}
                      channelConnected={wordpressConnected}
                      fitBlocked={assessArchetypeFit({ text: draft.body, category }).blocked}
                      artifactTitle={draft.assetTaskTitle}
                    />
                  ) : isEmailChannel(draft.channelId) ? (
                    <PublishEmailButton
                      draftId={draft.draftId}
                      channelConnected={emailConnected}
                      channelId="email-postmark"
                      fitBlocked={assessArchetypeFit({ text: draft.body, category }).blocked}
                      artifactTitle={draft.assetTaskTitle}
                    />
                  ) : (
                    <p className="text-xs text-[var(--dpf-muted)]">
                      Publishing for{" "}
                      <span className="text-[var(--dpf-text)]">{draft.channelId}</span> lands in
                      a later phase.
                    </p>
                  )
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section
        data-testid="marketing-inbound-queue"
        className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5"
      >
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-base font-semibold text-[var(--dpf-text)]">
              Inbound replies
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--dpf-muted)]">
              Recent inbound messages from connected channels. Qualified inquiries get a
              drafted holding reply queued above for your approval.
            </p>
          </div>
          <p className="text-sm font-medium text-[var(--dpf-accent)]">
            {inboundMessages.length} {inboundMessages.length === 1 ? "message" : "messages"}
          </p>
        </div>

        {inboundMessages.length === 0 ? (
          <p className="mt-4 rounded-lg bg-[var(--dpf-surface-2)] px-3 py-2 text-sm text-[var(--dpf-muted)]">
            No inbound replies yet. Configure your Postmark inbound webhook in{" "}
            <a className="underline" href="/platform/tools/integrations/email-postmark">
              /platform/tools/integrations/email-postmark
            </a>{" "}
            to start the loop.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {inboundMessages.map((msg) => (
              <li
                key={msg.inboundId}
                data-inbound-id={msg.inboundId}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4"
              >
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--dpf-muted)]">
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[var(--dpf-text)]">
                    {formatMarketingLabel(msg.channelId)}
                  </span>
                  <span className="rounded-full border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-0.5 text-[var(--dpf-text)]">
                    {classificationLabel(msg.classification)}
                  </span>
                  <span>{relativeTime(msg.receivedAt)}</span>
                  {msg.draftedReplyId ? (
                    <span className="text-[var(--dpf-accent)]">Reply drafted</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm font-medium text-[var(--dpf-text)]">
                  {msg.fromDisplayName ?? msg.fromAddress ?? "Unknown sender"}
                  {msg.subject ? <span className="text-[var(--dpf-muted)]"> · {msg.subject}</span> : null}
                </p>
                <p className="mt-1 line-clamp-3 text-sm text-[var(--dpf-text)]">{msg.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
