// Kernel-consult decision ledger — persists every `principle_decide` call to
// the DecisionInteraction audit table so WWMD/WWWD/WSID governance is
// observable, not just advisory.
//
// Before this module, `principle_decide` computed a recommendation and
// returned it with no durable record: the decision ledger stayed empty on
// installs where the kernel was consulted constantly, so an operator could
// not validate the HITL-equivalent gate was in play at all. The write is
// fail-open (a ledger outage must never block the decision itself), but the
// outcome is always observable in the tool response (`ledger.recorded`),
// per make-silent-failures-observable.

import type { DecisionResult } from "@/lib/decision/option-scoring";
import type { DecisionCallerContext } from "@/lib/decision/caller-context";
import {
  persistDecisionInteraction,
} from "@/lib/decision-perspective/persistence";
import type {
  DecisionOutcomeType,
  DecisionPerspectiveEvaluationResult,
  DecisionRiskTier,
} from "@/lib/decision-perspective/types";
import { sealDecision, type SealablePayload } from "@/lib/decision/decision-chain";
import type { AdmissibleCitation } from "@/lib/decision/evidence-grounding";

/** Grade → effective weight for the persisted source row. A most conclusive. */
const GRADE_WEIGHT: Record<string, number> = { A: 1, B: 0.75, C: 0.5, D: 0.25 };

type ProfileResolverDb = {
  decisionPerspectiveProfile: {
    findUnique(args: {
      where: { profileId: string };
      select: { profileId: true; kind: true };
    }): Promise<{ profileId: string; kind: string } | null>;
  };
  decisionPerspectiveProfileVersion: {
    findFirst(args: {
      where: { profileId: string };
      orderBy: { versionNumber: "desc" };
      select: { versionId: true };
    }): Promise<{ versionId: string } | null>;
  };
  /**
   * Optional chain-head lookup (BI-81CC5D8E). When present, used to find the
   * previous sealed entry so the new decision links to it. Optional so existing
   * callers/mocks that only provide `create` still work — a missing finder just
   * means prevHash=null (a fresh chain).
   */
  decisionInteraction?: {
    findFirst?(args: {
      where: { chainId: string; sealedAt: { not: null } };
      orderBy: { sealedAt: "desc" };
      select: { chainEntryHash: true };
    }): Promise<{ chainEntryHash: string | null } | null>;
  };
} & Parameters<typeof persistDecisionInteraction>[0]["db"];

/** Look up the current head hash of a chain, defensively (fail-open to null). */
async function resolveChainHead(db: ProfileResolverDb, chainId: string): Promise<string | null> {
  try {
    const finder = db.decisionInteraction?.findFirst;
    if (typeof finder !== "function") return null;
    const head = await finder({
      where: { chainId, sealedAt: { not: null } },
      orderBy: { sealedAt: "desc" },
      select: { chainEntryHash: true },
    });
    return head?.chainEntryHash ?? null;
  } catch {
    return null;
  }
}

export type KernelConsultLedgerOutcome = {
  recorded: boolean;
  interactionId?: string;
  profileId?: string;
  /** Why the write was skipped, when it was. */
  reason?: string;
};

/**
 * Map the pure decide() result onto the ledger's unresolved/resolved
 * semantics: a confident, conflict-free recommendation is `recommend`; a
 * commandment conflict or low-margin call is `escalate` (needs human review —
 * these feed the hub's open-review counts); no applicable principles is
 * `defer` (a coverage gap).
 */
export function mapConsultOutcome(result: DecisionResult): {
  outcomeType: DecisionOutcomeType;
  riskTier: DecisionRiskTier;
  confidenceScore: number;
} {
  if (!result.recommendation) {
    // BI-5CE7CF0B: insufficient signal is a real question the gate could not
    // weigh (options carried nothing scoreable) — that needs a human review,
    // not a coverage-gap shrug.
    if (result.flags.insufficientSignal) {
      return { outcomeType: "escalate", riskTier: "medium", confidenceScore: 0 };
    }
    return { outcomeType: "defer", riskTier: "medium", confidenceScore: 0 };
  }
  if (result.flags.commandmentConflict) {
    return { outcomeType: "escalate", riskTier: "high", confidenceScore: 0.3 };
  }
  if (result.recommendation.confidence === "low") {
    return { outcomeType: "escalate", riskTier: "medium", confidenceScore: 0.5 };
  }
  return { outcomeType: "recommend", riskTier: "low", confidenceScore: 0.9 };
}

export async function recordKernelConsultInteraction(input: {
  db: ProfileResolverDb;
  result: DecisionResult;
  callerContext: DecisionCallerContext;
  /** The decision context/question text supplied by the caller. */
  question: string;
  /** Option ids as supplied to decide(). */
  optionIds: string[];
  /** Full option descriptions, kept in the payload for the audit drill-in. */
  optionDescriptions: Record<string, string>;
  appliedPrincipleCount: number;
  callingSurface?: string | null;
  routeContext?: string | null;
  taskRunId?: string | null;
  triggeredByUserId?: string | null;
  /**
   * Caller attribution (BI-0EEBA669): who consulted the kernel — the client
   * product token (from the MCP route's User-Agent derivation), the resolved
   * auth identity, and the coworker agent/thread when in-portal. Persisted in
   * outcomePayload.caller so the audit surface can match a decision back to
   * the activity that produced it.
   */
  caller?: {
    client?: string | null;
    apiTokenId?: string | null;
    authSource?: string | null;
    agentId?: string | null;
    threadId?: string | null;
  } | null;
  /**
   * Caller-side view of how scoreable this consult actually was (BI-E0151DB2).
   * Optional so existing callers keep compiling; when absent the fields persist
   * as null rather than as a misleading zero.
   */
  signalQuality?: {
    usable: boolean;
    optionsWithFeatures: number;
    optionCount: number;
    /** BI-1D23EC26 */
    autonomyEligible?: boolean;
    featureCoverageWeak?: boolean;
    sensitivityUnstable?: boolean;
  } | null;
  /**
   * Trust-envelope evidence grounding (BI-EA97E5CD). Admissible per-(option,
   * dimension) citations that back the scored features. Persisted into
   * DecisionInteraction.sources (previously always empty on the kernel path).
   */
  citations?: AdmissibleCitation[] | null;
  /** Scored criteria per option (optionId -> dimension -> magnitude) for the seal. */
  scoredCriteria?: Record<string, Record<string, number>> | null;
  /** Per-(option,dimension) evidence digest for the immutable chain payload. */
  evidenceDigests?: Record<string, Record<string, string>> | null;
  /**
   * Whether to seal this decision into the append-only hash chain (BI-81CC5D8E).
   * Defaults to true; the seal is fail-open (a failure never blocks the record).
   * `now` is injected for determinism in tests.
   */
  seal?: boolean;
  now?: Date;
}): Promise<KernelConsultLedgerOutcome> {
  try {
    const profileId = input.callerContext.governingProfileId;
    const [profile, version] = await Promise.all([
      input.db.decisionPerspectiveProfile.findUnique({
        where: { profileId },
        select: { profileId: true, kind: true },
      }),
      input.db.decisionPerspectiveProfileVersion.findFirst({
        where: { profileId },
        orderBy: { versionNumber: "desc" },
        select: { versionId: true },
      }),
    ]);
    if (!profile || !version) {
      // Observable skip — e.g. the WWWD fallback constant has no DB row on
      // installs that predate the org-profile seed (BI-44526F3E).
      console.warn(
        `[kernel-consult-ledger] skipped: governing profile "${profileId}" is not provisioned (profile=${Boolean(profile)}, version=${Boolean(version)})`,
      );
      return { recorded: false, profileId, reason: "profile-not-provisioned" };
    }

    const { outcomeType, riskTier, confidenceScore } = mapConsultOutcome(input.result);

    // Top contributions for the recommended option — the "why" the audit
    // drill-in shows without replaying the scoring math.
    const winner = input.result.recommendation
      ? input.result.scores.find((s) => s.optionId === input.result.recommendation?.optionId)
      : null;
    const topContributors = winner
      ? [...winner.contributions]
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 5)
        .map((c) => ({
          principleId: c.principleId,
          principleName: c.principleName,
          tier: c.tier,
          contribution: Number(c.contribution.toFixed(4)),
        }))
      : [];

    // Trust-envelope evidence grounding: bind each cited source onto the ledger
    // row's `sources` column (was always empty on the kernel path).
    const sources: DecisionPerspectiveEvaluationResult["sources"] = (input.citations ?? []).map(
      (c) => ({
        materialId: `${c.optionId}:${c.dimensionKey}`,
        sourceType: c.locator.sourceType,
        summary: c.excerpt ?? `${c.dimensionKey} cited from ${c.locator.sourceType}`,
        effectiveWeight: GRADE_WEIGHT[c.grade] ?? 0.5,
      }),
    );

    const evaluation: DecisionPerspectiveEvaluationResult = {
      outcomeType,
      selectedProfileId: profile.profileId,
      fallbackProfileId: null,
      profileVersionId: version.versionId,
      confidenceBefore: confidenceScore,
      confidenceAfter: confidenceScore,
      confidenceScore,
      coverageGap: !input.result.recommendation,
      principleConflict: input.result.flags.commandmentConflict,
      domainClass: "kernel-consult",
      resolvedProfileChain: [profile.profileId],
      materialCount: input.appliedPrincipleCount,
      freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
      riskTier,
      question: input.question,
      options: input.optionIds,
      rationale: input.result.reasoning,
      materialScores: [],
      sources,
    };

    // Trust-envelope immutability: seal the decision as the next entry in the
    // per-profile append-only hash chain. Fail-open — if anything goes wrong the
    // decision still records, just unsealed (chain columns NULL).
    let chain: Parameters<typeof persistDecisionInteraction>[0]["chain"] = null;
    if (input.seal !== false) {
      try {
        const chainId = `kernel-consult:${profile.profileId}`;
        const prevHash = await resolveChainHead(input.db, chainId);
        const payload: SealablePayload = {
          question: input.question,
          optionIds: input.optionIds,
          criteria: input.scoredCriteria ?? {},
          evidenceDigests: input.evidenceDigests ?? {},
          recommendedOptionId: input.result.recommendation?.optionId ?? null,
          composite: input.result.recommendation?.composite ?? null,
        };
        chain = sealDecision({ chainId, prevHash, payload, now: input.now ?? new Date() });
      } catch (sealErr) {
        console.warn("[kernel-consult-ledger] seal failed (fail-open, unsealed):", sealErr);
        chain = null;
      }
    }

    const { interactionId } = await persistDecisionInteraction({
      db: input.db,
      build: null,
      evaluation,
      taskRunId: input.taskRunId ?? null,
      triggeredByUserId: input.triggeredByUserId ?? null,
      routeContext: input.routeContext ?? input.callingSurface ?? "mcp:principle_decide",
      // BI-FD7CBA06: name the door so WWMD audit can filter external MCP consults
      // separately from build-studio / backlog-triage (was always null before).
      gateKey: "kernel-consult",
      phaseFrom: null,
      phaseTo: null,
      chain,
      outcomePayloadExtra: {
        tool: "principle_decide",
        callingPopulation: input.callerContext.callingPopulation,
        callingSurface: input.callingSurface ?? null,
        caller: input.caller ?? null,
        recommendedOptionId: input.result.recommendation?.optionId ?? null,
        composite: input.result.recommendation?.composite ?? null,
        margin: input.result.recommendation?.margin ?? null,
        recommendationConfidence: input.result.recommendation?.confidence ?? null,
        insufficientSignal: input.result.flags.insufficientSignal === true,
        commandmentConflictPrinciples: input.result.flags.commandmentConflictPrinciples,
        structuredCoverage: input.result.flags.structuredCoverage,
        // BI-E0151DB2. Signal quality must be QUERYABLE, not just inferable.
        // Before this, answering "how often does the kernel abstain, and why?"
        // meant inferring it from outcomeType='escalate' — which conflates
        // insufficient signal (an agent supplied no scoreable features) with a
        // commandment conflict (genuine doctrine collision needing a human).
        // Those need opposite responses, so the ledger names them apart.
        commandmentConflict: input.result.flags.commandmentConflict === true,
        semanticFallbackRatio: input.result.flags.semanticFallbackRatio ?? null,
        optionsWithFeatures: input.signalQuality?.optionsWithFeatures ?? null,
        optionCount: input.signalQuality?.optionCount ?? null,
        signalUsable: input.signalQuality?.usable ?? null,
        // BI-1D23EC26 MCDA quality gates (queryable autonomy evidence)
        autonomyEligible: input.signalQuality?.autonomyEligible ?? null,
        featureCoverageWeak: input.signalQuality?.featureCoverageWeak ?? null,
        sensitivityUnstable: input.signalQuality?.sensitivityUnstable ?? null,
        featureCoverage: input.result.flags.featureCoverage ?? null,
        sensitivity: input.result.flags.sensitivity ?? null,
        autonomyBlockers: input.result.flags.autonomyBlockers ?? null,
        optionDescriptions: input.optionDescriptions,
        topContributors,
      },
    });

    return { recorded: true, interactionId, profileId: profile.profileId };
  } catch (err) {
    console.warn("[kernel-consult-ledger] write failed (fail-open):", err);
    return { recorded: false, reason: "write-failed" };
  }
}
