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

  const call = describeCallParameters(decision);
  if (call) parts.push(call);

  return parts.join(" ");
}

/**
 * BI-B4081AA1: say how the model was CALLED, not only which one was chosen.
 *
 * RouteDecision already carried the execution plan, but this explanation covered
 * model choice alone — so an operator could see why Qwen3 was picked and could
 * not see that it was called at temperature 1.0. "Set the parameters
 * transparently" needs the transparency half.
 *
 * Intent first, numbers second, provenance last: "temperature 0.6 (the model's
 * own published setting for thinking mode)" reads as a documented requirement
 * rather than an arbitrary choice, which is the difference that matters to
 * someone deciding whether to trust it.
 */
export function describeCallParameters(decision: RouteDecision): string | null {
  const plan = decision.executionPlan;
  if (!plan) return null;

  const sentences: string[] = [];
  const sampling = plan.sampling;
  const temperature = sampling?.values.temperature ?? plan.temperature;

  if (temperature !== undefined) {
    const origin = sampling?.provenance.temperature;
    sentences.push(
      `It was called at temperature ${temperature}${describeVariability(temperature)}${
        origin ? ` — ${describeProvenance(origin, sampling?.mode === "thinking")}` : ""
      }.`,
    );
  }

  if (plan.providerSettings?.thinking || plan.providerSettings?.thinkingConfig
      || plan.providerSettings?.reasoning_effort || plan.providerSettings?.reasoning
      || plan.providerSettings?.think) {
    sentences.push("Extended reasoning was switched on for this call.");
  } else if (plan.effortUnexpressed) {
    // The honest version of a silent no-op.
    sentences.push(
      "This task asked for extended reasoning, but the selected model has no way to accept that instruction, so it ran without it.",
    );
  }

  if (plan.responsePolicy?.strictSchema) {
    sentences.push("The response was constrained to valid JSON as it was generated.");
  }

  if (sampling?.dropped && sampling.dropped.length > 0) {
    sentences.push(
      `${sampling.dropped.length} setting(s) were left off because this model does not accept them.`,
    );
  }

  return sentences.length > 0 ? sentences.join(" ") : null;
}

/** Plain-language reading of a temperature, for someone who does not know the scale. */
function describeVariability(temperature: number): string {
  if (temperature <= 0.05) return " (no variation — the same question gets the same answer)";
  if (temperature <= 0.3) return " (little variation, favouring correctness)";
  if (temperature <= 0.75) return " (some variation)";
  return " (deliberately varied)";
}

function describeProvenance(
  origin: "vendor" | "contract" | "recipe" | "operator",
  thinking: boolean,
): string {
  switch (origin) {
    case "vendor":
      return thinking
        ? "the model's own published setting for reasoning mode"
        : "the model's own published setting";
    case "contract":
      return "what this kind of task needs";
    case "recipe":
      return "what measured best for this model on this kind of task";
    case "operator":
      return "an override someone set for this install";
  }
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
