"use client";

import Link from "next/link";
import { useState } from "react";

import type { OwnerAttentionEntry } from "@/lib/attention/owner-projection";
import { ExpandableCard, StatusBadge } from "@/components/ui/report-kit";
import { CoworkerEnvelopeApproval } from "./CoworkerEnvelopeApproval";
import { CoworkerProposalActions } from "./CoworkerProposalActions";
import { ProactivityProposalActions } from "./ProactivityProposalActions";
import { ResearchProposalActions } from "./ResearchProposalActions";
import { LEAVE_DECISION_ROUTE } from "@/lib/workforce/leave/leave-decision-proposal-contract";

export function OwnerDecisionCards({
  entries,
  limit,
}: {
  entries: OwnerAttentionEntry[];
  limit?: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const shown = typeof limit === "number" ? entries.slice(0, limit) : entries;

  return (
    <div className="space-y-3">
      {shown.map((entry) => {
        const disclosureId = `owner-decision-${safeId(entry.item.id)}`;
        const open = openId === entry.item.id;
        return (
          <ExpandableCard
            key={entry.item.id}
            id={disclosureId}
            open={open}
            onOpenChange={(next) => setOpenId(next ? entry.item.id : null)}
            headingLevel={3}
            summary={<DecisionSummary entry={entry} />}
            actions={<DecisionActions entry={entry} />}
            panelClassName="bg-[var(--dpf-surface-2)]"
          >
            <TechnicalDetail entry={entry} />
          </ExpandableCard>
        );
      })}
    </div>
  );
}

function DecisionSummary({ entry }: { entry: OwnerAttentionEntry }) {
  const { card } = entry;
  // Prefer the concrete "what the coworker was doing and why it stalled" rationale;
  // fall back to the generic why-it-matters for self-explanatory approvals.
  const rationale = card.situation ?? card.whyItMatters;
  return (
    <span className="block">
      <span className="flex items-start justify-between gap-3">
        <span className="block text-base font-semibold leading-snug text-[var(--dpf-text)]">
          {card.headline}
        </span>
        {card.tags.length > 0 ? (
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {card.tags.map((tag) => (
              <StatusBadge
                key={`${tag.kind}:${tag.label}`}
                domain="ownerDecisionImpact"
                status={tag.kind}
                label={tag.label}
                variant="soft"
                uppercase={false}
                className="rounded-full"
              />
            ))}
          </span>
        ) : null}
      </span>

      <span className="mt-1.5 block text-sm leading-relaxed text-[var(--dpf-muted)]">
        {rationale}
      </span>

      <span className="mt-2 block space-y-1.5 border-t border-[var(--dpf-border)] pt-2">
        <span className="block leading-snug">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
            If you do nothing
          </span>
          <span className="ml-2 text-xs text-[var(--dpf-text)]">
            {stripConsequenceLead(card.ifYouDoNothing)}
          </span>
        </span>
        <span className="block leading-snug">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-accent)]">
            {card.recommendation.lead}
          </span>
          <span className="ml-1.5 text-[10px] text-[var(--dpf-muted)]">
            {card.recommendation.specialistByline}
          </span>
          <span className="ml-2 text-xs text-[var(--dpf-text)]">
            {capitalize(card.recommendation.text)}
          </span>
        </span>
        {card.byline ? (
          <span className="block text-[10px] text-[var(--dpf-muted)]" title="Who produced this — AI-labeled; a role is a presentation label, not an accountable person.">
            {card.byline}
          </span>
        ) : null}
      </span>

      <span className="mt-2 block text-[11px] font-medium text-[var(--dpf-muted)]">
        Technical detail — for builders and your digital team
      </span>
    </span>
  );
}

function DecisionActions({ entry }: { entry: OwnerAttentionEntry }) {
  // First, and by source — an envelope decision never falls through to the
  // AgentActionProposal branches below (BI-7CB2CCDE).
  if (entry.item.source === "coworker-envelope") {
    return entry.item.envelope ? (
      <CoworkerEnvelopeApproval approval={entry.item.envelope} />
    ) : null;
  }
  if (entry.item.source === "research-proposal") {
    return (
      <ResearchProposalActions
        proposalId={entry.item.id.replace(/^research-proposal:/, "")}
      />
    );
  }
  if (entry.item.source === "agent-proposal" && /proactiv/i.test(entry.item.title)) {
    return <ProactivityProposalActions proposalId={entry.item.id.replace(/^agent-proposal:/, "")} />;
  }
  if (entry.item.source === "agent-proposal" && entry.item.deepLink !== LEAVE_DECISION_ROUTE) {
    return (
      <CoworkerProposalActions
        proposalId={entry.item.id.replace(/^agent-proposal:/, "")}
      />
    );
  }
  // Nothing this reader can act on. Say so in words — the old fallback rendered a
  // button that linked back to this same page and could only no-op (BI-90B6D8C5).
  if (entry.card.choices.length === 0) {
    return entry.card.handoff ? (
      <p className="text-xs leading-relaxed text-[var(--dpf-muted)]">{entry.card.handoff}</p>
    ) : null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {entry.card.choices.map((choice, index) => (
        <Link
          key={`${choice.kind}:${choice.label}:${choice.href}`}
          href={choice.href}
          className={
            index === 0
              ? "inline-flex min-h-9 items-center rounded-md bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-[var(--dpf-on-accent,var(--dpf-surface-1))] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
              : "inline-flex min-h-9 items-center rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2 text-xs font-semibold text-[var(--dpf-text)] hover:border-[var(--dpf-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          }
        >
          {choice.label}
        </Link>
      ))}
    </div>
  );
}

function TechnicalDetail({ entry }: { entry: OwnerAttentionEntry }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-[var(--dpf-text)]">Technical detail</p>
        <p className="mt-1 text-xs leading-relaxed text-[var(--dpf-muted)]">
          The original record is preserved here for builders and your digital team. It is not part of
          the owner decision above.
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {entry.card.technical.fields.map((field) => (
          <div key={field.label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-[var(--dpf-muted)]">
              {field.label}
            </dt>
            <dd className="mt-0.5 break-words text-xs text-[var(--dpf-text)]">{field.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--dpf-border)] pt-3">
        {entry.card.technical.builderActions.map((action) => (
          <Link
            key={`${action.label}:${action.href}`}
            href={action.href}
            className="text-xs font-semibold text-[var(--dpf-accent)] hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
          >
            {action.label} →
          </Link>
        ))}
      </div>
    </div>
  );
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function stripConsequenceLead(value: string): string {
  return value.replace(/^If you do nothing,\s*/i, "");
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
