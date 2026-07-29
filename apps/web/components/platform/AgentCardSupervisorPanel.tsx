import type { ReactNode } from "react";

import type { InternalAgentCard } from "@/lib/tak/agent-card-types";
import { oversightLabel } from "@/lib/workforce/oversight-copy";

type AgentCardSupervisorPanelProps = {
  cards: InternalAgentCard[];
};

const TOOL_PREVIEW_LIMIT = 6;
const PRIMARY_CARD_LIMIT = 6;

function validationClass(card: InternalAgentCard) {
  switch (card.extensions.gaid.validationState) {
    case "validated":
      return "border-[var(--dpf-success)] bg-[var(--dpf-success)]/10 text-[var(--dpf-success)]";
    case "pending-revalidation":
      return "border-[var(--dpf-info)] bg-[var(--dpf-info)]/10 text-[var(--dpf-info)]";
    case "stale":
      return "border-[var(--dpf-warning)] bg-[var(--dpf-warning)]/10 text-[var(--dpf-warning)]";
    default:
      return "border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)]";
  }
}

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string | number;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">{label}</p>
      <p className="mt-1 text-xl font-semibold text-[var(--dpf-text)]">{value}</p>
      {note ? <p className="mt-1 text-xs text-[var(--dpf-muted)]">{note}</p> : null}
    </div>
  );
}

function Chip({
  children,
  emphasis = "neutral",
}: {
  children: ReactNode;
  emphasis?: "neutral" | "accent";
}) {
  return (
    <span
      className={[
        "rounded-md border px-2 py-1 text-[11px]",
        emphasis === "accent"
          ? "border-[var(--dpf-accent)] bg-[var(--dpf-accent)]/10 text-[var(--dpf-accent)]"
          : "border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

function ToolPreview({ card }: { card: InternalAgentCard }) {
  const visibleTools = card.exposedTools.slice(0, TOOL_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, card.exposedTools.length - visibleTools.length);

  if (visibleTools.length === 0) {
    return <p className="text-sm text-[var(--dpf-muted)]">No exposed tools from the current grants.</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visibleTools.map((tool) => (
        <Chip key={`${card.agentId}-${tool}`}>{tool}</Chip>
      ))}
      {hiddenCount > 0 ? <Chip>+{hiddenCount} more</Chip> : null}
    </div>
  );
}

function sortCardsForSupervisor(cards: InternalAgentCard[]) {
  return [...cards].sort((a, b) => {
    const aNeedsAttention =
      Number(a.extensions.gaid.validationState === "unlinked") +
      Number(a.extensions.tak.authority.requiresApprovalForSideEffects);
    const bNeedsAttention =
      Number(b.extensions.gaid.validationState === "unlinked") +
      Number(b.extensions.tak.authority.requiresApprovalForSideEffects);

    if (aNeedsAttention !== bNeedsAttention) {
      return bNeedsAttention - aNeedsAttention;
    }

    return a.name.localeCompare(b.name);
  });
}

function AgentCardArticle({ card }: { card: InternalAgentCard }) {
  const authority = card.extensions.tak.authority;
  const decisionState = authority.supervisorDecisionState;
  const approvalPosture = authority.requiresApprovalForSideEffects
    ? "proposal/review"
    : "direct";

  return (
    <article
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            {card.agentId}
          </p>
          <h3 className="mt-1 text-base font-semibold text-[var(--dpf-text)]">{card.name}</h3>
          {card.description ? (
            <p className="mt-1 text-sm text-[var(--dpf-muted)]">{card.description}</p>
          ) : null}
        </div>
        <span
          className={[
            "rounded-md border px-2 py-1 text-[11px] font-medium",
            validationClass(card),
          ].join(" ")}
        >
          {card.extensions.gaid.validationState}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">GAID</p>
          <p className="mt-2 break-all font-mono text-xs text-[var(--dpf-text)]">
            {card.extensions.gaid.gaid ?? "No GAID projection"}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">Oversight</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip emphasis="accent">{oversightLabel(authority.hitlTier, { short: true })}</Chip>
            <Chip>{approvalPosture}</Chip>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Tool surface
          </p>
          <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">
            {authority.exposedToolCount} exposed tools
          </p>
          <p className="mt-1 text-xs text-[var(--dpf-muted)]">
            {authority.toolGrantCount} local grants
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 border-y border-[var(--dpf-border)] py-3 lg:grid-cols-2">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              Pending proposals
            </p>
            <p className="mt-2 text-sm font-semibold text-[var(--dpf-text)]">
              {decisionState.pendingProposalCount}
            </p>
            {decisionState.latestPendingProposal ? (
              <>
                <p className="mt-1 break-all text-xs text-[var(--dpf-muted)]">
                  {decisionState.latestPendingProposal.proposalId} /{" "}
                  {decisionState.latestPendingProposal.actionLabel}
                </p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {decisionState.latestPendingProposal.actionSummary}
                </p>
                {decisionState.latestPendingProposal.actionDetails.length > 0 ? (
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-xs">
                    {decisionState.latestPendingProposal.actionDetails.map((detail) => (
                      <div
                        key={`${decisionState.latestPendingProposal?.proposalId}:${detail.label}`}
                        className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-2 py-1"
                      >
                        <dt className="text-[9px] uppercase tracking-[0.12em] text-[var(--dpf-muted)]">
                          {detail.label}
                        </dt>
                        <dd className="mt-0.5 break-all text-[var(--dpf-text)]">{detail.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                <p className="mt-1 break-all text-xs text-[var(--dpf-muted)]">
                  Thread {decisionState.latestPendingProposal.threadId} / Message{" "}
                  {decisionState.latestPendingProposal.messageId}
                </p>
                <p className="mt-2 break-all text-xs text-[var(--dpf-muted)]">
                  <span className="font-semibold text-[var(--dpf-text)]">Approval workflow</span>{" "}
                  <code className="font-mono text-[var(--dpf-muted)]">
                    {decisionState.latestPendingProposal.decisionEndpoint}
                  </code>
                </p>
              </>
            ) : (
              <p className="mt-1 text-xs text-[var(--dpf-muted)]">No pending proposal cards.</p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
              Latest receipt
            </p>
            {decisionState.latestReceipt ? (
              <>
                <p className="mt-2 break-all text-sm font-semibold text-[var(--dpf-text)]">
                  {decisionState.latestReceipt.toolName}
                </p>
                <p className="mt-1 text-xs text-[var(--dpf-muted)]">
                  {decisionState.latestReceipt.receiptKind} /{" "}
                  {decisionState.latestReceipt.executionStatus} /{" "}
                  {decisionState.latestReceipt.receiptStatus}
                </p>
                <p className="mt-2 text-xs">
                  <a
                    href={decisionState.latestReceipt.journalHref}
                    className="text-[var(--dpf-accent)] underline-offset-2 hover:underline"
                  >
                    Open receipt in Capability Journal
                  </a>
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">No receipt-backed executions yet.</p>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Protocol interfaces
          </p>
          <div className="flex flex-wrap gap-2">
            {card.interfaces.map((interfaceName) => (
              <Chip key={`${card.agentId}-${interfaceName}`}>{interfaceName}</Chip>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Exposed tools
          </p>
          <ToolPreview card={card} />
        </div>

        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--dpf-muted)]">
            Supervisor limits
          </p>
          {authority.limitations.length > 0 ? (
            <ul className="space-y-1 text-sm text-[var(--dpf-muted)]">
              {authority.limitations.map((limitation) => (
                <li key={`${card.agentId}-${limitation}`}>{limitation}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--dpf-muted)]">No limitations projected.</p>
          )}
        </div>
      </div>
    </article>
  );
}

export function AgentCardSupervisorPanel({ cards }: AgentCardSupervisorPanelProps) {
  const linkedCount = cards.filter((card) => card.extensions.gaid.gaid !== null).length;
  const approvalCount = cards.filter(
    (card) => card.extensions.tak.authority.requiresApprovalForSideEffects,
  ).length;
  const exposedToolCount = cards.reduce(
    (total, card) => total + card.extensions.tak.authority.exposedToolCount,
    0,
  );
  const pendingProposalCount = cards.reduce(
    (total, card) => total + card.extensions.tak.authority.supervisorDecisionState.pendingProposalCount,
    0,
  );
  const recentReceiptCount = cards.reduce(
    (total, card) => total + card.extensions.tak.authority.supervisorDecisionState.recentReceiptCount,
    0,
  );
  const sortedCards = sortCardsForSupervisor(cards);
  const primaryCards = sortedCards.slice(0, PRIMARY_CARD_LIMIT);
  const additionalCards = sortedCards.slice(PRIMARY_CARD_LIMIT);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">Supervisor Agent Cards</h2>
          <p className="mt-1 max-w-4xl text-sm text-[var(--dpf-muted)]">
            TAK authority, GAID identity, protocol interfaces, and exposed runtime tools projected into one
            supervisor-readable view.
          </p>
        </div>
        <span className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-2 py-1 text-[11px] text-[var(--dpf-muted)]">
          dpf.agent-card.v1
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Projected cards" value={cards.length} note={`${linkedCount} GAID linked`} />
        <Metric label="Approval posture" value={approvalCount} note="proposal/review constrained" />
        <Metric label="Exposed tools" value={exposedToolCount} note="from AIDoc or grant mapping" />
        <Metric label="Pending proposals" value={pendingProposalCount} note="awaiting employee decision" />
        <Metric label="Recent receipts" value={recentReceiptCount} note="receipt-backed executions" />
      </div>

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-4 text-sm text-[var(--dpf-muted)]">
          No internal Agent Cards are projected yet.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
            {primaryCards.map((card) => (
              <AgentCardArticle key={card.agentId} card={card} />
            ))}
          </div>

          {additionalCards.length > 0 ? (
            <details className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
              <summary className="cursor-pointer text-sm font-semibold text-[var(--dpf-text)]">
                Additional projected cards - {additionalCards.length} more cards
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3 2xl:grid-cols-2">
                {additionalCards.map((card) => (
                  <AgentCardArticle key={card.agentId} card={card} />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </section>
  );
}
