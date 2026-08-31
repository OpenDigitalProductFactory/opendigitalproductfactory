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

import type { RetryAttemptRecord } from "@/lib/decision/uncertain-retry";
import {
  readVerdict,
  VERDICT_RETRY_HINTS,
  verdictConfidence,
  type DecisionResult,
  type DecisionVerdictCause,
} from "@/lib/decision/option-scoring";
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
import { citationsToSources, type AdmissibleCitation } from "@/lib/decision/evidence-grounding";

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
 * Internal-only linkage consumed by the policy-authority projector. It is not
 * part of the public principle_decide schema; only a server-owned action gate
 * may attach it to a kernel consult.
 */
export type KernelConsultPolicyProjection = {
  policyAffirmativeOptionId: string;
  dualControlRequired: boolean;
  policyActionBinding: {
    actionKey: string;
    subject: {
      kind: "employee" | "account" | "contact" | "partner-account" | "principal" | "team" | "backlog-item" | "platform";
      id: string;
    };
    organizationId: string | null;
    professionId: string | null;
    routeContext: string | null;
    artifactFingerprint: string;
  };
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
  /** BI-2107B5D2: why the verdict is not `proceed`; null when it is, or when nothing was weighed. */
  verdictCause: DecisionVerdictCause | "insufficient-signal" | "no-applicable-principles" | null;
  /** BI-2107B5D2: what the caller must change before a retry is worth running. Null when retrying cannot help. */
  retryHint: string | null;
} {
  if (!result.recommendation) {
    // BI-5CE7CF0B: insufficient signal is a real question the gate could not
    // weigh (options carried nothing scoreable) — that needs a human review,
    // not a coverage-gap shrug.
    if (result.flags.insufficientSignal) {
      return {
        outcomeType: "escalate",
        riskTier: "medium",
        confidenceScore: 0,
        verdictCause: "insufficient-signal",
        // BI-2107B5D2: a corpus gap re-run against the same empty corpus
        // returns the same nothing. The input must change, or the retry is a
        // loop wearing the costume of diligence.
        retryHint: "Supply per-option `features` maps or embeddings — the options carry nothing scoreable, so re-running unchanged returns the same result.",
      };
    }
    return {
      outcomeType: "defer",
      riskTier: "medium",
      confidenceScore: 0,
      verdictCause: "no-applicable-principles",
      retryHint: "Cover this decision in the corpus — no principle applied to it.",
    };
  }

  // BI-2107B5D2: the verdict decides the outcome, and the confidence score is
  // COMPUTED from the real margin rather than stamped as a constant. The old
  // 0.9 / 0.5 / 0.3 / 0 constants meant every ledger row carried one of four
  // values, so the distribution the bands are tuned against did not exist.
  const { verdict, verdictCause } = readVerdict(result.recommendation, result.flags);
  const confidenceScore = verdictConfidence(result.recommendation);
  const retryHint = verdictCause ? VERDICT_RETRY_HINTS[verdictCause] : null;

  if (verdict === "decline") {
    // A decline is an ASSURANCE — the gate weighed it and the answer is no.
    // Risk stays high for a commandment conflict because a human should see
    // that the kernel's own commandments were the blocker.
    return {
      outcomeType: "decline",
      riskTier: verdictCause === "commandment-conflict" ? "high" : "medium",
      confidenceScore,
      verdictCause,
      retryHint,
    };
  }
  if (verdict === "uncertain") {
    return { outcomeType: "escalate", riskTier: "medium", confidenceScore, verdictCause, retryHint };
  }
  return { outcomeType: "recommend", riskTier: "low", confidenceScore, verdictCause: null, retryHint: null };
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
  /**
   * BI-60B3D270: attempts from a bounded retry out of the uncertain band, when
   * the caller ran one. Absent means the decision was reached first-pass.
   */
  retryAttempts?: RetryAttemptRecord[] | null;
  /** Exact action linkage supplied only by the server-owned authority path. */
  policyProjection?: KernelConsultPolicyProjection | null;
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

    const { outcomeType, riskTier, confidenceScore, verdictCause, retryHint } =
      mapConsultOutcome(input.result);
    // BI-2107B5D2: read through readVerdict so the edges recorded are the ones
    // actually applied — including for a legacy result that carried none.
    const recordedVerdict = input.result.recommendation
      ? readVerdict(input.result.recommendation, input.result.flags)
      : null;

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
    // row's `sources` column (was always empty on the kernel path). The row
    // carries the structured locator (BI-8192557E phase 2a) so the independent
    // re-verifier can re-resolve it against live source later; without it a
    // recorded citation is permanently unverifiable.
    const sources: DecisionPerspectiveEvaluationResult["sources"] = citationsToSources(
      input.citations ?? [],
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
        // BI-2107B5D2: the three-band verdict, its cause, the band edges in
        // force, and what to change before retrying. Persisting the EDGES
        // alongside the margin is what lets a later histogram tell a moved bar
        // from a changed result.
        verdict: recordedVerdict?.verdict ?? null,
        verdictCause,
        retryHint,
        bandUpper: recordedVerdict?.bands.upper ?? null,
        bandLower: recordedVerdict?.bands.lower ?? null,
        bandStakes: recordedVerdict?.bands.stakes ?? null,
        // BI-60B3D270: when the caller ran a bounded retry, record what it
        // changed on each attempt. A later histogram can then separate a
        // first-pass assurance from one that took two tries to reach.
        retryAttempts: input.retryAttempts ?? null,
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
        policyAffirmativeOptionId: input.policyProjection?.policyAffirmativeOptionId ?? null,
        dualControlRequired: input.policyProjection?.dualControlRequired ?? null,
        policyActionBinding: input.policyProjection?.policyActionBinding ?? null,
      },
    });

    return { recorded: true, interactionId, profileId: profile.profileId };
  } catch (err) {
    console.warn("[kernel-consult-ledger] write failed (fail-open):", err);
    return { recorded: false, reason: "write-failed" };
  }
}
