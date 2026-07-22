import type { AttentionAction, AttentionItem, AttentionSource } from "./types";
import {
  consequenceFor,
  headlineFor,
  recommendationFor,
  situationFor,
  specialistFor,
  whyItMattersFor,
} from "./owner-decision-copy";
import { builderActions, technicalFields } from "./owner-technical-detail";
import { formatAttentionByline } from "./attribution";

export type OwnerDecisionTag = {
  label: string;
  kind: "money" | "public" | "reversible" | "deadline";
};

export type OwnerDecisionChoice = AttentionAction & { href: string };

export type OwnerTechnicalField = { label: string; value: string };

export type OwnerDecisionCard = {
  id: string;
  source: AttentionSource;
  headline: string;
  /** Plain "what the coworker was doing and why it stalled" for sources whose
   *  headline is not self-explanatory (blocked/paused/proposal). Sourced from the
   *  item's own context one-liner; absent for approvals that speak for
   *  themselves. Rendered as the card's primary rationale. */
  situation?: string;
  whyItMatters: string;
  ifYouDoNothing: string;
  recommendation: {
    /** Honest, AI-labeled lead (BI-AB12B3D3 / ratified BI-7D29937E): the platform
     *  recommends, presented as AI — NOT "your COO decided". A role is a thin
     *  presentation label (specialistByline), never the accountable actor. */
    lead: "AI recommendation";
    text: string;
    specialistByline: string;
  };
  /** Honest attribution byline for an AI-authored item — AI-labeled, role as a
   *  thin label over the accountable identity (BI-AB12B3D3). Absent when the item
   *  has no single AI author. */
  byline?: string;
  choices: OwnerDecisionChoice[];
  tags: OwnerDecisionTag[];
  technical: {
    fields: OwnerTechnicalField[];
    builderActions: OwnerDecisionChoice[];
  };
};

export function translateAttentionToOwnerDecision(
  item: AttentionItem,
  nowMs: number,
): OwnerDecisionCard {
  return {
    id: item.id,
    source: item.source,
    headline: headlineFor(item),
    situation: situationFor(item),
    whyItMatters: whyItMattersFor(item),
    ifYouDoNothing: consequenceFor(item),
    recommendation: {
      lead: "AI recommendation",
      text: recommendationFor(item),
      specialistByline: specialistFor(item.source),
    },
    ...(item.author ? { byline: formatAttentionByline(item.author) } : {}),
    choices: ownerChoices(item),
    tags: tagsFor(item, nowMs),
    technical: {
      fields: technicalFields(item),
      builderActions: builderActions(item),
    },
  };
}

function ownerChoices(item: AttentionItem): OwnerDecisionChoice[] {
  const linked = item.actions.filter(
    (action): action is OwnerDecisionChoice =>
      typeof action.href === "string" && isOwnerSafeHref(action.href),
  );
  if (linked.length > 0) return linked.slice(0, 3).map(withPlainChoiceLabel);
  return [
    {
      kind: "open-in-context",
      label: "Review this decision",
      href: `/workspace/inbox?attentionId=${encodeURIComponent(item.id)}`,
    },
  ];
}

function isOwnerSafeHref(href: string): boolean {
  return href.startsWith("/") && !/^\/(?:ops|build|admin|platform)(?:\/|\?|#|$)/i.test(href);
}

function withPlainChoiceLabel(action: OwnerDecisionChoice): OwnerDecisionChoice {
  const label = action.label
    .replace(/AI Workforce/gi, "your digital team")
    .replace(/System Health/gi, "technical health")
    .replace(/routing workbench/gi, "routing choice")
    .replace(/scheduled work/gi, "scheduled task");
  return { ...action, label };
}

function tagsFor(item: AttentionItem, nowMs: number): OwnerDecisionTag[] {
  const tags: OwnerDecisionTag[] = [];
  if (item.source === "approval-bill" || item.source === "approval-expense") {
    tags.push({ label: "Costs money", kind: "money" });
  }
  if (item.source === "approval-outbound" || item.source === "compliance-submission") {
    tags.push({ label: "Goes public", kind: "public" });
  }
  if (!item.triage.irreversible) tags.push({ label: "Reversible", kind: "reversible" });
  const due = dueLabel(item.triage.deadlineIso, nowMs);
  if (due) tags.push({ label: due, kind: "deadline" });
  return tags;
}

function dueLabel(deadlineIso: string | undefined, nowMs: number): string | null {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso).getTime();
  if (!Number.isFinite(deadline)) return null;
  const days = Math.ceil((deadline - nowMs) / 86_400_000);
  if (days < 0) return "Past due";
  if (days === 0) return "Due today";
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}
