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

/**
 * Which rails the reader has asked to see. Mirrors the Simple/Full rail toggle
 * (lib/navigation/nav-mode.ts): `worker` is Simple — builder and platform tools
 * are hidden, so an owner button must never lead there. `operator` is Full —
 * "showing everything, including builder and platform tools" — so the real
 * builder-rail action IS the honest primary action rather than something to hide
 * behind a disclosure (BI-90B6D8C5).
 */
export type OwnerDecisionAudience = "worker" | "operator";

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
  /**
   * Plain-language "who owns this and where it lives", set ONLY when the item has
   * no action this reader can act on. Replaces the old dead fallback button
   * (BI-90B6D8C5): that button pointed at `/workspace/inbox?attentionId=…`, i.e.
   * the page it was rendered on, and nothing ever read the param — so clicking it
   * did nothing at all. An honest sentence beats a button that lies. When this is
   * set, `choices` is empty; the real record still hangs off
   * `technical.builderActions` below.
   */
  handoff?: string;
  tags: OwnerDecisionTag[];
  technical: {
    fields: OwnerTechnicalField[];
    builderActions: OwnerDecisionChoice[];
  };
};

export function translateAttentionToOwnerDecision(
  item: AttentionItem,
  nowMs: number,
  audience: OwnerDecisionAudience = "operator",
): OwnerDecisionCard {
  const choices = ownerChoices(item, audience);
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
    choices,
    ...(choices.length === 0 ? { handoff: handoffFor(item) } : {}),
    tags: tagsFor(item, nowMs),
    technical: {
      fields: technicalFields(item),
      builderActions: builderActions(item),
    },
  };
}

function ownerChoices(
  item: AttentionItem,
  audience: OwnerDecisionAudience,
): OwnerDecisionChoice[] {
  const linked = item.actions.filter(
    (action): action is OwnerDecisionChoice =>
      typeof action.href === "string" && isActionableHref(action.href, audience),
  );
  // No usable action → no button. The old fallback linked back to this very page
  // with an `?attentionId=` param nothing reads, so it could only ever no-op;
  // `handoff` explains the situation in words instead (BI-90B6D8C5).
  return linked.slice(0, 3).map(withPlainChoiceLabel);
}

/**
 * Can THIS reader act on this href?
 *
 * Any in-app route qualifies in Full/`operator` mode — the reader has explicitly
 * asked to see builder and platform tools, so routing them to the surface that
 * actually holds the record is the honest answer, not a hidden one. Simple/
 * `worker` mode keeps the builder rails out of owner buttons (EP-NAV-COHERENCE:
 * no cross-rail teleport for the non-technical persona).
 */
function isActionableHref(href: string, audience: OwnerDecisionAudience): boolean {
  if (!href.startsWith("/")) return false;
  // Never route the reader at the inbox itself. That is the defect this replaced:
  // a card rendered on /workspace/inbox whose button pointed back at
  // /workspace/inbox could not do anything, whatever query it carried. Enforced
  // here so no future source can reintroduce it (BI-90B6D8C5).
  if (/^\/workspace\/inbox(?:\/|\?|#|$)/i.test(href)) return false;
  if (audience === "operator") return true;
  return isOwnerSafeHref(href);
}

function isOwnerSafeHref(href: string): boolean {
  return href.startsWith("/") && !/^\/(?:ops|build|admin|platform)(?:\/|\?|#|$)/i.test(href);
}

/**
 * Plain-language explanation for a card with nothing this reader can click.
 *
 * Names the surface that owns the record without naming a route (the owner copy
 * contract bans raw technical strings above technical detail — owner-decision.test.ts).
 */
function handoffFor(item: AttentionItem): string {
  const blast = item.triage.blastRadius;
  if (blast && /\bFB-[A-Z0-9-]+\b/i.test(blast)) {
    return "Your digital team holds this one — the build record is under technical detail below.";
  }
  return "Your digital team holds this one — the original record is under technical detail below.";
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

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * How long the reader has, in the largest unit that is still honest.
 *
 * This used to round every remaining span up to whole days, so ANY future
 * deadline under 24h read "Due in 1 day" — and "Due today" could not fire at
 * all, because Math.ceil of a positive fraction is never 0. That was harmless
 * while every deadline-bearing source was day-scale (bills, filings), and
 * actively misleading the moment one was not: a coworker approval envelope
 * whose window closes in three minutes was labelled "Due in 1 day", directly
 * contradicting the exact expiry printed on the same card (BI-7CB2CCDE
 * follow-up, caught on the live install).
 *
 * Minutes and hours are therefore reported as minutes and hours. Day-scale
 * deadlines keep their existing wording and rounding.
 */
function dueLabel(deadlineIso: string | undefined, nowMs: number): string | null {
  if (!deadlineIso) return null;
  const deadline = new Date(deadlineIso).getTime();
  if (!Number.isFinite(deadline)) return null;
  const msLeft = deadline - nowMs;
  if (msLeft <= 0) return "Past due";
  if (msLeft < HOUR_MS) {
    // Never round a live window down to "0 minutes" — it still needs an answer.
    const minutes = Math.max(1, Math.round(msLeft / MINUTE_MS));
    return `Due in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  if (msLeft < DAY_MS) {
    const hours = Math.round(msLeft / HOUR_MS);
    return `Due in ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.ceil(msLeft / DAY_MS);
  return `Due in ${days} day${days === 1 ? "" : "s"}`;
}
