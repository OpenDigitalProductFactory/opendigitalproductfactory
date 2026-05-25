// apps/web/lib/build/propose-decomposition.ts
//
// Phase 4b of the design-time decomposition rollout.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md (§3.2)
// BI: BI-2E6CC391.
//
// Orchestrates the LLM call that produces 2-4 candidate decompositions of a
// passed-design xlarge FeatureBuild. Pure orchestration: the prompt
// construction is in this module, the model call is dependency-injected so
// tests run without an LLM, and the candidate parsing/validation are reused
// from Phase 4a (`decomposition-candidates.ts`).
//
// Eligibility:
//   - build.phase === "ideate"
//   - build.designDoc is non-null
//   - build.designReview is non-null and .decision === "pass"
//   - build.designReview.sizeAssessment is present and decision !== "ok"
//   - build.parentEpicId is null (assertNoRecursiveDecomposition)
//
// Success path:
//   - Build the prompt from designDoc + sizeAssessment + optional operator
//     hint (used by "Reject all + regenerate" UX).
//   - Call the agent. Parse + validate. Drop any candidate that fails
//     validateCandidate; loud-warn but don't reject the whole pass — a
//     partial set of valid candidates is more useful to the operator than
//     a hard failure.
//   - Persist surviving candidates to designReview.decompositionCandidates,
//     preserving any prior candidates' history under `priorRounds`.
//   - Return the validated candidates.

import { prisma } from "@dpf/db";
import type { BuildDesignDoc, ReviewResult, SizeAssessmentSnapshot } from "@/lib/explore/feature-build-types";

import {
  parseCandidatesResponse,
  validateCandidate,
  type DecompositionCandidate,
} from "./decomposition-candidates";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProposeDecompositionInput = {
  buildId: string;
  userId: string;
  agentId?: string | null;
  /** Operator hint for "regenerate" — typically a one-liner like
   *  "make the read-first build smaller" or "ship the ledger separately".
   *  Empty/missing on the first generation pass. */
  operatorHint?: string;
  /** Test seam — LLM call. Receives the prompt and returns the raw model
   *  output as a string (typically JSON, possibly fenced). */
  callAgent?: (prompt: string) => Promise<string>;
  /** Test seam — replace prisma. */
  db?: ProposeDecompositionDb;
  /** Test seam — override Date.now() for assessedAt-style timestamps. */
  now?: () => Date;
};

export type ProposeDecompositionResult =
  | {
      ok: true;
      candidates: DecompositionCandidate[];
      /** Candidates the model returned but that failed validateCandidate.
       *  Surfaced for observability — when this list is non-empty the
       *  operator UI may want to render "the agent proposed N more options
       *  but they didn't partition cleanly; regenerating may help." */
      rejected: Array<{ candidate: DecompositionCandidate; reasons: string[] }>;
    }
  | {
      ok: false;
      code: ProposeDecompositionErrorCode;
      error: string;
    };

export type ProposeDecompositionErrorCode =
  | "build-not-found"
  | "build-not-in-ideate"
  | "build-missing-design-doc"
  | "build-design-review-not-passed"
  | "build-no-size-assessment"
  | "build-size-already-ok"
  | "build-already-decomposed"
  | "agent-call-failed"
  | "no-valid-candidates";

export type ProposeDecompositionDb = {
  featureBuild: {
    findUnique: typeof prisma.featureBuild.findUnique;
    update: typeof prisma.featureBuild.update;
  };
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function proposeDecomposition(
  args: ProposeDecompositionInput,
): Promise<ProposeDecompositionResult> {
  const db: ProposeDecompositionDb = args.db ?? {
    featureBuild: {
      findUnique: prisma.featureBuild.findUnique.bind(prisma.featureBuild),
      update: prisma.featureBuild.update.bind(prisma.featureBuild),
    },
  };
  const now = args.now ?? (() => new Date());
  const callAgent = args.callAgent ?? defaultCallAgent;

  // 1. Fetch the build.
  const build = await db.featureBuild.findUnique({
    where: { buildId: args.buildId },
    select: {
      buildId: true,
      title: true,
      phase: true,
      designDoc: true,
      designReview: true,
      parentEpicId: true,
    },
  });
  if (!build) {
    return { ok: false, code: "build-not-found", error: `FeatureBuild ${args.buildId} not found.` };
  }

  // 2. Eligibility checks.
  if (build.phase !== "ideate") {
    return {
      ok: false,
      code: "build-not-in-ideate",
      error: `Build is in phase "${build.phase}". Decomposition proposals are only valid during ideate.`,
    };
  }
  const designDoc = build.designDoc as BuildDesignDoc | null;
  if (!designDoc) {
    return { ok: false, code: "build-missing-design-doc", error: "Build has no designDoc to propose against." };
  }
  const review = (build.designReview ?? null) as ReviewResult | null;
  if (!review || review.decision !== "pass") {
    return {
      ok: false,
      code: "build-design-review-not-passed",
      error: "Build's designReview is not passed. Run reviewDesignDoc first.",
    };
  }
  const assessment = review.sizeAssessment ?? null;
  if (!assessment) {
    return {
      ok: false,
      code: "build-no-size-assessment",
      error: "No size assessment recorded on this build's review. Re-run reviewDesignDoc to populate sizeAssessment.",
    };
  }
  if (assessment.decision === "ok") {
    return {
      ok: false,
      code: "build-size-already-ok",
      error: "Size assessment is `ok` — no decomposition needed. Build can proceed to Plan as-is.",
    };
  }
  if (build.parentEpicId != null) {
    return {
      ok: false,
      code: "build-already-decomposed",
      error: `Build already has parentEpicId=${build.parentEpicId}. Recursive decomposition is forbidden (spec §12 Q4).`,
    };
  }

  // 3. Build the prompt + call the agent.
  const prompt = buildDecompositionPrompt(designDoc, assessment, args.operatorHint);
  let rawResponse: string;
  try {
    rawResponse = await callAgent(prompt);
  } catch (err) {
    return {
      ok: false,
      code: "agent-call-failed",
      error: `Agent call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. Parse + validate.
  const parsed = parseCandidatesResponse(rawResponse);
  const accepted: DecompositionCandidate[] = [];
  const rejected: Array<{ candidate: DecompositionCandidate; reasons: string[] }> = [];
  for (const c of parsed) {
    const v = validateCandidate(c, designDoc);
    if (v.ok) {
      accepted.push(c);
    } else {
      rejected.push({
        candidate: c,
        reasons: v.failures.map((f) => `[${f.code}] ${f.message}`),
      });
    }
  }

  if (accepted.length === 0) {
    return {
      ok: false,
      code: "no-valid-candidates",
      error:
        rejected.length === 0
          ? "Agent returned no parseable candidates."
          : `Agent returned ${rejected.length} candidate(s) but none passed validation. First failure: ${rejected[0]!.reasons.join("; ")}`,
    };
  }

  // 5. Persist. Append to priorRounds for audit if there's already a
  //    candidate list on the review.
  const priorCandidates = (review as { decompositionCandidates?: unknown })
    .decompositionCandidates;
  const updatedReview = {
    ...review,
    decompositionCandidates: {
      latest: accepted,
      latestGeneratedAt: now().toISOString(),
      latestOperatorHint: args.operatorHint ?? null,
      latestRejectedCount: rejected.length,
      priorRounds:
        priorCandidates && typeof priorCandidates === "object"
          ? appendPriorRound(priorCandidates, now())
          : [],
    },
  };
  await db.featureBuild.update({
    where: { buildId: args.buildId },
    data: { designReview: updatedReview as never },
  });

  return { ok: true, candidates: accepted, rejected };
}

// ---------------------------------------------------------------------------
// Default agent call — wraps routeAndCall. Dynamic import keeps the LLM
// surface out of unit-test import graphs.
// ---------------------------------------------------------------------------

async function defaultCallAgent(prompt: string): Promise<string> {
  const { routeAndCall } = await import("@/lib/routed-inference");
  const messages = [{ role: "user" as const, content: prompt }];
  const systemPrompt =
    "You are a Build Studio Software Engineer asked to propose 2-4 candidate decompositions of an xlarge design into smaller coordinated builds. Output JSON only — no prose, no markdown around the JSON.";
  const result = await routeAndCall(messages, systemPrompt, "internal");
  return result.content ?? "";
}

// ---------------------------------------------------------------------------
// Prompt construction. Kept here (not as a const string) so tests can assert
// the prompt names the spec-required structured fields. The prompt is
// directive about JSON shape and includes the parent AC list with explicit
// 0-indexed numbering — the agent's only job is partitioning into 2-4
// coherent buckets.
// ---------------------------------------------------------------------------

export function buildDecompositionPrompt(
  doc: BuildDesignDoc,
  assessment: SizeAssessmentSnapshot,
  operatorHint?: string,
): string {
  const acs = doc.acceptanceCriteria ?? [];
  const acList = acs
    .map((ac, i) => `  ${i}. ${typeof ac === "string" ? ac : JSON.stringify(ac)}`)
    .join("\n");

  const hint = operatorHint && operatorHint.trim().length > 0
    ? `\n\nOperator regenerate hint (apply this to the new candidates): ${operatorHint.trim()}`
    : "";

  const tripsText = assessment.trips.length > 0
    ? assessment.trips
        .map((t) => `  - ${t.dimension}=${t.observed} (>= ${t.threshold} ${t.level})`)
        .join("\n")
    : "  (no specific dimension trips)";

  return [
    `# Decompose this design into 2-4 child builds`,
    ``,
    `The design below has been size-assessed as "${assessment.decision}". Threshold trips:`,
    tripsText,
    ``,
    `Your job: propose **2 to 4 different ways** to split this design into smaller coordinated child builds. Each child must:`,
    `- Cover a coherent slice that can ship independently if its dependencies ship first`,
    `- Carry only a subset of the parent's acceptance criteria (by index)`,
    `- Stay under the size thresholds individually (small enough that each child's Plan converges)`,
    `- Use Dale's vocabulary in title/summary (trucks, parts, jobs, techs — NOT "FeatureBuild", "epic", "capsule")`,
    ``,
    `## Parent design`,
    ``,
    `**Problem:** ${doc.problemStatement}`,
    ``,
    doc.dataModel ? `**Data model:**\n${doc.dataModel}\n` : ``,
    `**Proposed approach:** ${doc.proposedApproach}`,
    ``,
    `**Acceptance criteria (use these 0-indexed numbers in acceptanceCriteriaIndices):**`,
    acList,
    hint,
    ``,
    `## Output format`,
    ``,
    `Return ONLY a JSON object of this shape (no prose around it, no markdown fences):`,
    ``,
    `{`,
    `  "candidates": [`,
    `    {`,
    `      "candidateId": "candidate-1",`,
    `      "rationale": "Why this split groups these ACs the way it does",`,
    `      "childScopes": [`,
    `        {`,
    `          "childOrder": 1,`,
    `          "title": "Plain-language child name",`,
    `          "summary": "One-sentence summary in Dale's vocabulary",`,
    `          "acceptanceCriteriaIndices": [0, 1, 4],`,
    `          "dependsOn": []`,
    `        },`,
    `        ...`,
    `      ]`,
    `    },`,
    `    ...`,
    `  ]`,
    `}`,
    ``,
    `Rules the validator will enforce — get these right or the candidate is rejected:`,
    `- Each candidate has 2 to 4 child scopes.`,
    `- childOrder values are 1, 2, 3, ... with no gaps and no duplicates.`,
    `- Every parent acceptance criterion (index 0 to ${acs.length - 1}) appears in EXACTLY ONE child.`,
    `- dependsOn values reference other childOrder values in the SAME candidate.`,
    `- No self-loops, no cycles.`,
    `- Each rationale and title is non-empty.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function appendPriorRound(prior: unknown, now: Date): unknown[] {
  if (
    typeof prior !== "object" ||
    prior === null ||
    !("latest" in prior)
  ) {
    return [];
  }
  const p = prior as {
    latest?: unknown;
    latestGeneratedAt?: unknown;
    latestOperatorHint?: unknown;
    priorRounds?: unknown;
  };
  const existing = Array.isArray(p.priorRounds) ? p.priorRounds : [];
  return [
    ...existing,
    {
      candidates: p.latest,
      generatedAt: p.latestGeneratedAt ?? null,
      operatorHint: p.latestOperatorHint ?? null,
      supersededAt: now.toISOString(),
    },
  ];
}
