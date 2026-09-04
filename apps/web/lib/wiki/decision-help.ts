// BI-404E9BEA — plain-language "what do I do about this?" guidance for the
// decision ledger, aimed at the non-technical operator staring at an
// ESCALATE/DEFER row.
//
// Pure and deterministic by design: the local model runtime must never be a
// dependency of the help that explains the ledger, so every sentence here is
// derived from recorded fields (outcome, tier, risk, flags), not inference.
// The pages do the Prisma I/O and pass shaped inputs in, mirroring
// decision-audit.ts.

import type { DecisionAuditTierOrOther, DecisionTierStats } from "./decision-audit";

export type DecisionHelpStep = {
  label: string;
  /** Internal route the step points at; null for a step that is just advice. */
  href: string | null;
};

export type DecisionHelp = {
  /** What this outcome is, in one or two plain sentences. */
  meaning: string;
  /** Whether anything is actually waiting on the reader. */
  urgency: string;
  /** Ordered concrete next actions; empty when nothing is needed. */
  steps: DecisionHelpStep[];
};

export type DecisionHelpInput = {
  outcomeType: string;
  tier: DecisionAuditTierOrOther;
  riskTier: string | null;
  principleConflict: boolean;
  /** True when no option carried scoreable features (every contribution zero). */
  insufficientSignal: boolean;
  /** True when the consult came from a Build Studio gate (row.buildId set). */
  hasBuild: boolean;
  /** True once a human answered (capture row or humanOutcome present). */
  resolved: boolean;
  /** True when the producer omitted the question needed to resolve this safely. */
  contextMissing: boolean;
  /**
   * True when the hygiene sweep retired the row because the build it gated is
   * gone (BI-FE034C1E). Distinct from `resolved`: the question stopped being
   * asked, so telling the reader "a human already answered this" would be false.
   */
  withdrawn?: boolean;
  /**
   * Identity of the row this help is for. When present, every link back to
   * Review & adjust carries it, so following the advice lands ON the finding
   * with the question already in hand instead of on an empty form
   * (BI-6700AF66).
   */
  origin?: { interactionId?: string; domainClass?: string };
};

/** Review & adjust, focused on this row's finding when the row is identified. */
export function reviewHref(origin?: DecisionHelpInput["origin"]): string {
  const params = new URLSearchParams();
  if (origin?.domainClass) params.set("focus", origin.domainClass);
  if (origin?.interactionId) params.set("from", origin.interactionId);
  const query = params.toString();
  if (!query) return "/coworker-decisions/review";
  // The fragment lands the reader ON the finding; the query is what pre-opens
  // its answer box with the question already stated.
  const fragment = origin?.domainClass
    ? `#finding-${encodeURIComponent(origin.domainClass)}`
    : "";
  return `/coworker-decisions/review?${query}${fragment}`;
}

/** The tier's playbook, named the way the rest of the surface names it. */
function tierPlaybook(tier: DecisionAuditTierOrOther): string {
  switch (tier) {
    case "wwmd":
      return "platform doctrine (how the platform itself should be built)";
    case "wwwd":
      return "your business playbook";
    case "wsid":
      return "this role's craft playbook";
    default:
      return "the governing playbook";
  }
}

function escalateMeaning(input: DecisionHelpInput): string {
  const base = "Your AI stopped short of making this call alone and put it in front of a human.";
  if (input.insufficientSignal) {
    return `${base} The consult arrived without scoreable options, so nothing could actually be weighed — only a person (or a re-run with scoreable options) can settle it.`;
  }
  if (input.principleConflict) {
    return `${base} Two of your recorded principles pull in opposite directions on it, and de-conflicting principles is a human call.`;
  }
  if (input.riskTier === "high" || input.riskTier === "critical") {
    return `${base} It is marked ${input.riskTier}-risk, and your governance always routes ${input.riskTier}-risk calls to a human regardless of confidence.`;
  }
  return `${base} Its confidence in what ${tierPlaybook(input.tier)} says about this was too low to decide unattended.`;
}

function deferMeaning(input: DecisionHelpInput): string {
  return `Your AI looked for guidance and found nothing recorded that answers this, so it declined to guess. ${
    input.tier === "wwwd"
      ? "Your business hasn't weighed in on this kind of question yet."
      : `There is a gap in ${tierPlaybook(input.tier)} here.`
  }`;
}

function unresolvedSteps(input: DecisionHelpInput): DecisionHelpStep[] {
  const steps: DecisionHelpStep[] = [];
  if (input.hasBuild) {
    steps.push({
      label: "Open Build Studio — this build is paused at its decision gate until the question is answered there.",
      href: "/build",
    });
  }
  if (input.tier === "wwwd") {
    steps.push({
      label:
        "Answer it once on Review & adjust — your answer is captured as draft business doctrine your AI reuses, and the whole cluster of similar questions clears.",
      href: reviewHref(input.origin),
    });
    return steps;
  }
  steps.push({
    label:
      "Check Review & adjust — it rolls rows like this into a short list of themes instead of making you work the log line by line.",
    href: reviewHref(input.origin),
  });
  steps.push(
    input.tier === "wsid"
      ? {
        label:
          "If the same question keeps coming back, add craft guidance for the role so it can settle these itself next time.",
        href: "/coworker-decisions/craft",
      }
      : {
        label:
          "If the same question keeps coming back, add a stance that answers it so it stops needing you.",
        href: "/coworker-decisions/stance",
      },
  );
  return steps;
}

/**
 * Plain-language guidance for one ledger row. Always returns something to say:
 * resolved rows and recommend/arbitrate rows get a "nothing needed" read, so
 * the panel never leaves the reader guessing whether silence means action.
 */
export function buildDecisionHelp(input: DecisionHelpInput): DecisionHelp {
  const unresolvedAsk = input.outcomeType === "escalate" || input.outcomeType === "defer";

  if (input.contextMissing) {
    return {
      meaning:
        "This historical audit record does not contain enough context to resolve safely. The question that produced it was never captured.",
      urgency:
        "Nothing is waiting on you. This record is retained for audit history and excluded from action queues.",
      steps: [],
    };
  }

  if (input.outcomeType === "recommend") {
    return {
      meaning:
        "Your AI weighed the options and recommends one. The recommendation went back to whoever asked; this row is the audit record of it.",
      urgency: "Nothing is needed from you.",
      steps: [],
    };
  }
  if (input.outcomeType === "arbitrate") {
    return {
      meaning:
        "Your AI was confident enough — and allowed by your autonomy settings — to settle this itself and keep working. It is recorded here so you can audit the call.",
      urgency: "Nothing is needed from you unless you disagree with the call.",
      steps: [],
    };
  }

  const meaning =
    input.outcomeType === "defer" ? deferMeaning(input) : escalateMeaning(input);

  if (!unresolvedAsk) {
    return {
      meaning: "This outcome type has no recorded guidance.",
      urgency: "Nothing is known to be waiting on you.",
      steps: [],
    };
  }

  // Checked BEFORE `resolved`: a withdrawal writes humanOutcome without anyone
  // answering, so the resolved copy would credit a human who never acted.
  if (input.withdrawn) {
    return {
      meaning,
      urgency:
        "Closed on its own — the work this question guarded is finished or dropped, so nobody needs to answer it. Kept for the record.",
      steps: [],
    };
  }

  if (input.resolved) {
    return {
      meaning,
      urgency: "Resolved — a human already answered this. Nothing left to do here.",
      steps: [],
    };
  }

  return {
    meaning,
    urgency: input.hasBuild
      ? "A build is waiting: the Build Studio build that asked is paused at this gate until someone answers."
      : "Nothing is stuck. The coworker that asked handled the moment — typically by taking the safest option or asking in its own session — and moved on. Answering teaches your AI, so this question stops piling up here.",
    steps: unresolvedSteps(input),
  };
}

// ── Log-page digest ─────────────────────────────────────────────────────────

export type AwaitingDigest = {
  total: number;
  /** e.g. "74 decisions are waiting on a human" */
  headline: string;
  /** Per-tier fragments, e.g. "29 platform doctrine". Only non-zero tiers. */
  fragments: string[];
};

/**
 * Deterministic roll-up of the "awaiting review" load for the log header.
 * Returns null when nothing is waiting so the panel disappears entirely.
 */
export function buildAwaitingDigest(stats: DecisionTierStats[]): AwaitingDigest | null {
  const waiting = stats.filter((s) => s.unresolved > 0);
  const total = waiting.reduce((sum, s) => sum + s.unresolved, 0);
  if (total === 0) return null;
  return {
    total,
    headline:
      total === 1
        ? "1 decision is waiting on a human"
        : `${total} decisions are waiting on a human`,
    fragments: waiting.map((s) => `${s.unresolved} ${s.expansion.toLowerCase()} (${s.code})`),
  };
}
