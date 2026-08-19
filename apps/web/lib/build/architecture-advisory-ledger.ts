// Governance ledger for the chief-architect advisory (BI-D6CFE63A).
//
// The architectural-alignment review behind `reviewDesignDoc` / `reviewBuildPlan`
// is an inline `routeAndCall` inside an MCP tool handler that IMPERSONATES the
// architect in a system prompt: there is no Agent session, no TaskRun, no
// thread, and — until now — no decision record. So the model activity an
// operator could plainly see in Docker Desktop under "Enterprise Architect" was
// untraceable in the platform's own records, which is why two correct
// observations (real architect activity, empty WSID tier) looked contradictory.
//
// Routing the advisory through the profession gate under the EA identity gives
// the chief-architect lens the same auditability the other two tiers have.
//
// Posture: fail-OPEN, the OPPOSITE of backlog-triage-ledger.ts. The advisory is
// advisory by contract and must never be blocked by a ledger problem; there,
// the ledger is the precondition for a state mutation and must block it.

import type { PrismaClient } from "@dpf/db";
import type { ArchitectureAdvisory, ReviewResult } from "@/lib/explore/feature-build-types";

/**
 * Record an architecture advisory as a WSID decision. Never throws and never
 * blocks: a ledger failure is logged and the review proceeds.
 */
async function ledgerArchitectureAdvisory(
  prisma: PrismaClient,
  arch: ReviewResult,
  advisory: ArchitectureAdvisory,
  userId: string,
  threadId: string | null | undefined,
  routeContext: string,
): Promise<void> {
  try {
    const { evaluateProfessionDecisionGate } = await import(
      "@/lib/decision-perspective/profession-gate"
    );
    const { ENTERPRISE_ARCHITECT_AGENT_ID } = await import("@dpf/db/agent-identity");

    const critical = arch.issues.filter((i) => i.severity === "critical").length;
    const important = arch.issues.filter((i) => i.severity === "important").length;

    await evaluateProfessionDecisionGate({
      db: prisma,
      agentIdentity: {
        agentId: ENTERPRISE_ARCHITECT_AGENT_ID,
        slugId: "ea-architect",
      },
      question: `Architectural alignment review: ${advisory.summary}`,
      options: ["aligned", "revise-before-building"],
      domainClass: "architecture-tradeoff",
      // An advisory that found entrenching debt is a higher-stakes call than a
      // clean pass, and the tier should say so rather than flattening both.
      riskTier: critical > 0 ? "high" : important > 0 ? "medium" : "low",
      routeContext,
      triggeredByUserId: userId,
      caller: {
        agentId: ENTERPRISE_ARCHITECT_AGENT_ID,
        threadId: threadId ?? null,
      },
    });
  } catch (err) {
    // Advisory by contract — never let a ledger failure block the review.
    console.error("[architecture-advisory-ledger] failed", err);
  }
}

/** Reduce a parsed architecture ReviewResult into the advisory record nested on
 *  ReviewResult.architectureAdvisory. Returns null when the reviewer was absent
 *  or its output failed to parse — an architecture reviewer that didn't answer
 *  must not masquerade as "no concerns". */
export function architectureAdvisoryFromReview(
  arch: ReviewResult | null,
): ArchitectureAdvisory | null {
  if (!arch || arch.parseError) return null;
  return { summary: arch.summary, issues: arch.issues };
}

/** Build the advisory and auto-file [reference-doc] findings (process-spine §6.5). */
export async function finalizeArchitectureAdvisory(
  prisma: PrismaClient,
  arch: ReviewResult | null,
  userId: string,
  agentId: string | null | undefined,
  threadId: string | null | undefined,
  routeContext: string,
): Promise<ArchitectureAdvisory | null> {
  const advisory = architectureAdvisoryFromReview(arch);
  if (arch?.issues?.length) {
    try {
      const { promoteReferenceDocFindings } = await import(
        "@/lib/process-spine/canonical-improvement-digest"
      );
      await promoteReferenceDocFindings(prisma, arch.issues, {
        userId,
        agentId: agentId ?? null,
        threadId: threadId ?? null,
        routeContext,
      });
    } catch (err) {
      console.error("[reference-doc-promotion] failed", err);
    }
  }
  // Ledger only a review that actually produced an advisory. A reviewer that
  // did not answer, or whose output failed to parse, must not leave a record
  // implying the architect weighed in (same rule as architectureAdvisoryFromReview).
  if (arch && advisory) {
    await ledgerArchitectureAdvisory(prisma, arch, advisory, userId, threadId, routeContext);
  }
  return advisory;
}
