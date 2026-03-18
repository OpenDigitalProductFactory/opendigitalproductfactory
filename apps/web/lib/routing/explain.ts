/**
 * EP-INF-001: Build human-readable explanation strings from routing decisions.
 * These are the strings a compliance officer reads — not internal IDs.
 */
import type { RouteDecision } from "./types";

/**
 * Format a RouteDecision.reason for display to non-technical users.
 * Strips internal IDs and uses plain language.
 */
export function formatDecisionForUser(decision: RouteDecision): string {
  if (!decision.selectedEndpoint) {
    return `No AI model was available for this ${decision.taskType} task. ${decision.excludedCount} model(s) were considered but none met the requirements.`;
  }

  const winner = decision.candidates.find(
    (c) => c.endpointId === decision.selectedEndpoint && !c.excluded,
  );
  if (!winner) return decision.reason;

  const parts: string[] = [];

  parts.push(
    `Model '${winner.endpointName}' was selected for your ${decision.taskType} task.`,
  );

  if (Object.keys(winner.dimensionScores).length > 0) {
    const scores = Object.entries(winner.dimensionScores)
      .map(([dim, score]) => `${formatDimensionName(dim)}: ${score}/100`)
      .join(", ");
    parts.push(`It scored ${scores}.`);
  }

  if (decision.policyRulesApplied.length > 0) {
    parts.push(
      `Policy rule(s) applied: ${decision.policyRulesApplied.join(", ")}.`,
    );
  }

  if (decision.excludedCount > 0) {
    parts.push(
      `${decision.excludedCount} other model(s) were excluded.`,
    );
  }

  const scored = decision.candidates.filter((c) => !c.excluded).length;
  if (scored > 1) {
    parts.push(`${scored} models were evaluated in total.`);
  }

  return parts.join(" ");
}

function formatDimensionName(dim: string): string {
  const names: Record<string, string> = {
    reasoning: "Reasoning",
    codegen: "Code Generation",
    toolFidelity: "Tool Calling",
    instructionFollowing: "Instruction Following",
    structuredOutput: "Structured Output",
    conversational: "Conversational",
    contextRetention: "Context Retention",
  };
  return names[dim] ?? dim;
}
