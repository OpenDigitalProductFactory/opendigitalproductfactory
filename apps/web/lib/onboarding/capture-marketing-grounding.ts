// Onboarding marketing grounding (BI-74E9BD73, EP-5CC9C184).
//
// WHY THIS EXISTS, ALONGSIDE capture-market-context RATHER THAN INSIDE IT.
// capture-market-context asks the BROAD business questions — competitive
// landscape, market size, differentiators, positioning — and lands them in the
// org WWWD corpus as narrative. That is the right home for judgment about how
// the business sees its market.
//
// It does not, and should not, fill the STRUCTURED fields the marketing drafter
// actually reads: MarketingStrategy.targetSegments, .idealCustomerProfiles and
// .proofAssets. Those were bootstrap-only and unreachable (BI-06BB96F0 opened
// the write path); nothing has ever asked for them.
//
// Measured consequence on the reference install: the marketing self-task fired
// on 2026-08-31 and again on 2026-09-07 and produced nothing either time. Its
// prompt says "do not invent customers or numbers", it had no segments, no ICPs
// and no proof, so it correctly refused and stalled. The coworker behaved
// properly. Nobody had ever been asked, and it had no way to go and find out.
//
// THE SHAPE IS NOT A QUESTIONNAIRE. Founder direction: the operator will not
// know most of this and should not be asked to supply it. They do not know the
// specialist third-party channels their sector uses; a marketing lead might,
// and a small nonprofit may have no marketing lead at all.
//
//   "A few directional questions of the owner, or existing employees
//    responsible for marketing, should suffice to get started, and allow the AI
//    coworker to do further research and begin marketing in the shape that
//    makes most sense."
//
// So this captures the few facts only the operator holds, records what is still
// unknown, and hands the coworker a researchable starting point. The division:
// the operator supplies what cannot be derived (who they actually serve, what
// they have genuinely achieved, what they refuse to do); the coworker finds what
// is knowable by looking. Asking the operator for what research can find is the
// failure this corrects.

import type {
  MarketingConstraintSummary,
  MarketingNamedItem,
  MarketingProofAsset,
} from "@/lib/marketing";

/**
 * The few directional answers worth asking for. Every field optional: partial
 * is the expected case, not a validation failure. The founder's note that this
 * arrives "at onboarding time, or shortly afterwards" is the normal path.
 */
export type MarketingGroundingAnswers = {
  /** Who the organization actually serves, in its own words. */
  servedGroups?: string | null;
  /** Where those people find it today — the honest current answer, not a plan. */
  currentReach?: string | null;
  /** What it can genuinely point to. Never inferred; fabricated proof is the failure mode. */
  provenResults?: string | null;
  /** What marketing must not say or do here. */
  localConstraints?: string | null;
};

/** A question the coworker should research rather than ask the operator again. */
export type MarketingResearchPrompt = {
  /** Stable key so a later pass can tell what has been answered. */
  key: "channels" | "channel-rules" | "segments" | "proof";
  /** What the coworker is being asked to find out. */
  question: string;
  /** Why the operator was not asked instead. */
  because: string;
};

export type MarketingGroundingCapture = {
  /** Structured grounding to persist, empty-safe. */
  grounding: {
    targetSegments?: MarketingNamedItem[];
    proofAssets?: MarketingProofAsset[];
    constraints?: MarketingConstraintSummary | null;
  };
  /** What the operator answered, for the record. */
  answered: string[];
  /** What the coworker must research before a brief can be grounded. */
  research: MarketingResearchPrompt[];
  /** True when nothing usable was supplied. */
  empty: boolean;
};

const SPLIT = /[,;\n]|\band\b/i;

/** Split a free-text answer into named items without inventing structure. */
function toNamedItems(value: string | null | undefined): MarketingNamedItem[] {
  return (value ?? "")
    .split(SPLIT)
    .map((part) => part.trim().replace(/^[-•*]\s*/, ""))
    .filter((part) => part.length > 1)
    .map((name) => ({ name }));
}

/**
 * Turn a few directional answers into structured grounding plus an explicit
 * research list.
 *
 * Deliberately does NOT derive proof assets from prose. A proof asset is a claim
 * about what the organization achieved; splitting a sentence into bullets and
 * filing them as evidence would manufacture exactly the outcome claims the
 * platform refuses elsewhere — the marketing placeholder brief was removed for
 * the same reason ("the fabricated brief is strictly worse than the truth").
 * Proven results are captured as ONE operator-attributed note, and anything
 * further is asked for, not inferred.
 */
export function buildMarketingGrounding(
  answers: MarketingGroundingAnswers,
): MarketingGroundingCapture {
  const answered: string[] = [];
  const research: MarketingResearchPrompt[] = [];

  const segments = toNamedItems(answers.servedGroups);
  if (segments.length > 0) answered.push("Who you serve");
  else {
    research.push({
      key: "segments",
      question:
        "Which groups does this organization serve, and how do they differ in what they need?",
      because: "The operator did not answer, so the archetype's stakeholder shape is the only guide.",
    });
  }

  const proofAssets: MarketingProofAsset[] = [];
  const proven = (answers.provenResults ?? "").trim();
  if (proven.length > 0) {
    answered.push("What you can point to");
    proofAssets.push({
      type: "outcome",
      label: proven.slice(0, 180),
    });
  } else {
    research.push({
      key: "proof",
      question:
        "What can this organization genuinely evidence — counts, durations, partnerships — from its own records?",
      because:
        "Proof must come from the operator or from this organization's own data. It is never inferred, and never assumed to exist.",
    });
  }

  const constraintText = (answers.localConstraints ?? "").trim();
  const constraints: MarketingConstraintSummary | null =
    constraintText.length > 0 ? { compliance: constraintText } : null;
  if (constraints) answered.push("What you will not do");

  // Channels are always researched, even when currentReach is answered: the
  // operator's answer says where people find them TODAY, which is a starting
  // point rather than the set of channels their sector supports.
  const reach = (answers.currentReach ?? "").trim();
  if (reach.length > 0) answered.push("Where people find you today");
  research.push({
    key: "channels",
    question: reach.length > 0
      ? `Beyond ${reach}, which channels does this sector use in this organization's area?`
      : "Which channels does this sector use in this organization's area?",
    because:
      "Specialist channels are sector and region specific. The operator is not expected to know them; this is findable by looking.",
  });
  research.push({
    key: "channel-rules",
    question: "What does each candidate channel require or prohibit for this kind of organization?",
    because:
      "Platform terms change and are rarely known in advance. A constraint found here is proposed for the archetype seed so the next organization inherits it.",
  });

  return {
    grounding: {
      ...(segments.length > 0 ? { targetSegments: segments } : {}),
      ...(proofAssets.length > 0 ? { proofAssets } : {}),
      ...(constraints ? { constraints } : {}),
    },
    answered,
    research,
    empty: answered.length === 0,
  };
}
