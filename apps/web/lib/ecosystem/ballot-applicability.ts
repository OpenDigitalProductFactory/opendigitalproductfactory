/**
 * Ballot applicability (BI-4D924DB4) — is an ecosystem submission relevant to
 * THIS install, and may this install see it at all?
 *
 * Two gates, deliberately not one:
 *
 *   1. CONSENT  — may it be shown here? (audience + forwarding, source-owned)
 *   2. RELEVANCE — is it applicable here? (archetype scope from the envelope)
 *
 * Collapsing them into a single "relevance filter" would leak: a submission
 * whose owner never consented to wider circulation must not become visible
 * merely because it is relevant.
 *
 * The relevance verdict deliberately mirrors `regulationApplies` rather than
 * inventing a scoring function: that evaluator already separates "known out of
 * scope" from "not enough signal to say", and always carries a human-readable
 * reason. A ballot exists to earn a considered vote, and a score that cannot
 * explain itself cannot do that.
 */

import { parseArchetypeRefs } from "@/lib/federation/demand-projection";

/** Tri-state, matching the compliance evaluator's vocabulary. */
export type BallotApplicabilityScope = "applies" | "review" | "reference";

export interface BallotApplicability {
  scope: BallotApplicabilityScope;
  /** Why — shown beside the item so a voter can judge the classification. */
  reason: string;
}

/** What this install is, for relevance purposes. */
export interface InstallRelevanceProfile {
  archetypeCategories: string[];
  archetypeIds: string[];
}

export interface BallotItemScope {
  /** Namespaced applicability refs from the demand envelope, when present. */
  archetypeRefs?: string[] | null;
}

function nonEmpty(values: string[] | undefined | null): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

/**
 * Classify one submission against this install's archetype.
 *
 * Gate semantics follow the compliance evaluator exactly: a DECLARED mismatch on
 * both sides is definitive (`reference`); a signal undeclared on either side is
 * reviewable (`review`), never silently treated as out of scope. Hiding an item
 * because the *receiver* forgot to declare its archetype would silence a
 * submission for the wrong reason.
 */
export function classifyBallotItem(
  item: BallotItemScope,
  profile: InstallRelevanceProfile,
): BallotApplicability {
  const scope = parseArchetypeRefs(item.archetypeRefs);

  // Platform-scoped work applies to every install by definition — every install
  // runs the platform, whatever business it operates.
  if (scope.scopeKind === "platform") {
    return { scope: "applies", reason: "platform-wide — affects every installation" };
  }

  const itemCategories = nonEmpty(scope.archetypeCategories);
  const itemArchetypes = nonEmpty(scope.archetypeIds);
  if (itemCategories.length === 0 && itemArchetypes.length === 0) {
    return {
      scope: "review",
      reason: "the submission declares no archetype scope, so its relevance here cannot be determined",
    };
  }

  const ownCategories = nonEmpty(profile.archetypeCategories);
  const ownArchetypes = nonEmpty(profile.archetypeIds);
  if (ownCategories.length === 0 && ownArchetypes.length === 0) {
    return {
      scope: "review",
      reason: "this installation has not declared an archetype, so relevance cannot be determined",
    };
  }

  const matchedArchetype = itemArchetypes.find((id) => ownArchetypes.includes(id));
  if (matchedArchetype) {
    return { scope: "applies", reason: `matches this installation's archetype ${matchedArchetype}` };
  }

  const matchedCategory = itemCategories.find((category) => ownCategories.includes(category));
  if (matchedCategory) {
    return { scope: "applies", reason: `matches this installation's ${matchedCategory} category` };
  }

  // Both sides declared, and they do not overlap: definitively out of scope.
  const declared = [...itemCategories, ...itemArchetypes].join(", ");
  return { scope: "reference", reason: `scoped to ${declared}, which this installation is not` };
}

export interface BallotConsentEnvelope {
  audience: string;
  /** Source-owned consent for re-projection. ABSENCE MEANS FORBIDDEN. */
  forwarding?: { permitted: boolean; audiences: string[]; expiresAt?: string } | null;
}

export interface BallotConsentDecision {
  permitted: boolean;
  reason: string;
}

/**
 * May this submission be shown to an install other than its author?
 *
 * Fail-closed, and already the contract's own rule: "Absence means forwarding is
 * forbidden." Putting an item on someone else's ballot IS a re-projection, so it
 * is governed by the same consent the transport uses — not by a looser
 * ballot-specific rule.
 */
export function mayAppearOnBallot(
  envelope: BallotConsentEnvelope,
  target: { audience: string; now?: Date },
): BallotConsentDecision {
  const forwarding = envelope.forwarding;
  if (!forwarding || forwarding.permitted !== true) {
    return { permitted: false, reason: "the submitter granted no forwarding consent" };
  }
  if (!forwarding.audiences.includes(target.audience)) {
    return {
      permitted: false,
      reason: `forwarding consent does not cover the ${target.audience} audience`,
    };
  }
  if (forwarding.expiresAt) {
    const expiry = new Date(forwarding.expiresAt);
    const now = target.now ?? new Date();
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime()) {
      return { permitted: false, reason: "forwarding consent has expired" };
    }
  }
  return { permitted: true, reason: `forwarding permitted to the ${target.audience} audience` };
}
