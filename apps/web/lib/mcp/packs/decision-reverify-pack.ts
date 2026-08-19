// Decision evidence re-verification tool pack (BI-8192557E phase 2b).
//
// Exposes the independent Axis-4 pass: load a recorded decision's persisted
// citations and re-resolve each StructuredLocator against live source, so a
// citation that was admissible-but-false is caught after the fact.
//
// Deliberately a SEPARATE tool rather than a step inside `principle_decide`.
// Re-verification only means something when it runs without access to the
// original scorer's reasoning (separation of duties, mirroring
// lib/build/verified-finding-review.ts). Folding it into the scoring call would
// make the decision certify itself.
//
// Read-only and advisory: it reports, it never mutates the decision. The row is
// sealed into the append-only hash chain, and acting on a degrade (re-scoring
// the affected dimension) is phase 3. Grant is `registry_read`, matching the
// sibling decision-governance reads (`principle_decide`,
// `list_open_decision_reviews`); grants mirror agent-grants.ts TOOL_TO_GRANTS,
// which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
// Type-only: erased at build time, so the handler keeps its lazy-import shape.
import type { SourceAccess } from "@/lib/decision/evidence-reverification";

const definitions: ToolDefinition[] = [
  {
    name: "reverify_decision_evidence",
    description:
      "Independently re-check the evidence cited by a recorded decision. Loads the decision's persisted citations and re-resolves each structured locator (code/spec/doc) against live source, reporting which citations still hold and which no longer do. Use it to audit a past decision before relying on it, or to spot a citation that was well-formed but never true. " +
      "Read FOUR fields together, they mean different things: `outcome` ('verified' = every citation that could be adjudicated still holds; 'degraded' = at least one no longer holds; 'unverifiable' = nothing could be adjudicated), `unverifiableCause` (why), `coverage` (how many recorded sources were actually checkable), and `inconclusive` (citations looked up but not adjudicable in this environment). A 'verified' outcome at low coverage is NOT a clean bill of health for the decision. " +
      "A citation can only be REFUTED against source of known revision. Where the source is not a checkout, a citation that fails to resolve is reported as inconclusive, never as degraded — absence in a tree of unknown provenance is not evidence the citation was false. " +
      "Advisory and read-only: it does not change the decision or its score. Call once per decision; do not poll.",
    inputSchema: {
      type: "object",
      properties: {
        interactionId: {
          type: "string",
          description:
            "The decision's interactionId (e.g. 'DI-18A9DB68B82F'), as returned by principle_decide's ledger or listed by list_open_decision_reviews.",
        },
      },
      required: ["interactionId"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

/** Human-readable headline. States coverage in the same breath as the verdict. */
function summarize(report: {
  outcome: string;
  unverifiableCause: string | null;
  coverage: { recordedSources: number; checked: number; unverifiable: number };
  confirmed: number;
  degraded: number;
  unresolved: number;
  inconclusive: unknown[];
  sourceAccess: { anchored: boolean; detail: string };
}): string {
  const { coverage } = report;
  const open = report.inconclusive.length;
  // Never phrase an unanchored miss as a finding against the decision.
  const openNote = open > 0
    ? ` ${open} citation(s) could NOT be adjudicated here: ${report.sourceAccess.detail}. That is an open question about this environment, not evidence against the decision — re-run where the source is a checkout.`
    : "";

  if (report.outcome === "unverifiable") {
    if (report.unverifiableCause === "no-source-access") {
      return `Cannot verify: ${report.sourceAccess.detail}. This is an environment limitation, NOT a finding about the decision's evidence — none of its ${coverage.recordedSources} recorded source(s) were checked.`;
    }
    if (report.unverifiableCause === "unanchored-source") {
      return `Cannot verify: ${report.sourceAccess.detail}. ${coverage.checked} citation(s) were looked up and none could be confirmed, but on a tree of unknown revision that does NOT mean they are false — treat this as unverified, not as fabricated.`;
    }
    return `Cannot verify: none of the ${coverage.recordedSources} recorded source(s) carry a re-resolvable locator, so this decision's evidence is opaque to re-verification. Treat it as unverified, not as verified.`;
  }
  const scope = `Checked ${coverage.checked} of ${coverage.recordedSources} recorded source(s)${coverage.unverifiable > 0 ? `; ${coverage.unverifiable} carried no re-resolvable locator and were NOT checked` : ""}.`;
  return report.outcome === "degraded"
    ? `Evidence DEGRADED: ${report.degraded} citation(s) no longer match their source and ${report.unresolved} no longer resolve at all. ${scope} The affected (option, dimension) pairs should be treated as unevidenced.`
    : `Evidence holds: ${report.confirmed} checked citation(s) still resolve and still match. ${scope}${openNote}${coverage.unverifiable > 0 ? " Coverage is partial — this is not a clean bill of health for the whole decision." : ""}`;
}

async function reverifyDecisionEvidenceHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const interactionId = String(params["interactionId"] ?? "").trim();
  if (!interactionId) {
    return { success: false, message: "interactionId is required." };
  }

  const { prisma } = await import("@dpf/db");
  const { reverifyDecisionEvidence, guardResolverPaths } = await import(
    "@/lib/decision/evidence-reverification"
  );
  const { createRepoLocatorResolver } = await import("@/lib/decision/locator-resolver");
  const { isDevInstance, getProjectRoot, isPathAllowedSync } = await import(
    "@/lib/build/codebase-tools"
  );

  // Source reachability is decided BEFORE resolving anything, so an install
  // without a checkout reports "cannot verify" rather than a wall of degrades.
  let sourceAccess: SourceAccess;
  if (!isDevInstance()) {
    sourceAccess = {
      available: false,
      detail:
        "this install has no source checkout (production instances ship no code), so code/spec/doc locators cannot be re-resolved here",
    };
  } else {
    const repoRoot = getProjectRoot();
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    if (!existsSync(join(repoRoot, "package.json"))) {
      sourceAccess = {
        available: false,
        detail: `no source found at ${repoRoot} (mount the project via PROJECT_ROOT to enable re-verification)`,
      };
    } else {
      // A checkout carries `.git` (a directory, or a file when it is a
      // worktree). Without it the tree has no revision we can name, and an
      // image-synced source volume is exactly that — readable, partial, and
      // silent about which commit it represents.
      const anchored = existsSync(join(repoRoot, ".git"));
      sourceAccess = {
        available: true,
        repoRoot,
        anchored,
        anchorDetail: anchored
          ? "a git checkout, so a missing file is evidence about the citation"
          : "NOT a git checkout, so its revision is unknown; citations can be confirmed here but never refuted",
      };
    }
  }

  const resolve = sourceAccess.available
    ? guardResolverPaths(createRepoLocatorResolver({ repoRoot: sourceAccess.repoRoot }), isPathAllowedSync)
    : async () => ({ resolved: false, liveExcerpt: null });

  const lookup = await reverifyDecisionEvidence({
    db: prisma as never,
    interactionId,
    sourceAccess,
    resolve,
  });

  if (!lookup.found) {
    return {
      success: false,
      message: `No decision found with interactionId "${interactionId}".`,
    };
  }

  return {
    success: true,
    message: summarize(lookup.report),
    data: lookup.report,
  };
}

export const decisionReverifyPack: ToolPack = {
  packId: "decision-reverify",
  definitions,
  handlers: {
    reverify_decision_evidence: (params) => reverifyDecisionEvidenceHandler(params),
  },
  grants: {
    reverify_decision_evidence: ["registry_read"],
  },
};
