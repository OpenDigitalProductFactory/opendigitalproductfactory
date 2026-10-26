import { createHash } from "node:crypto";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import type { ReassessmentBudgetConfiguration } from "../lib/inference/budget-gate";

/** Isolated test policy. These explicit records are never live grants. */
export function reassessmentBudgetFixture(overrides: Partial<ReassessmentBudgetConfiguration> = {}): ReassessmentBudgetConfiguration {
  const limits = { dailyTokenLimit: 200_000, perTaskTokenLimit: 0, timeoutSeconds: 30, maxTokens: 100, executionType: "in_process" as const };
  const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
  const snapshot = { source: "registry-and-execution-config" as const, agentId: "reviewer", registryAgentId: "reviewer", registryAgentName: "reviewer",
    executionAgentRowId: "fixture-agent", executionConfigId: "fixture-config", registryLimits: { ...limits }, executionConfigLimits: { ...limits },
    registryConfigurationDigest: hash({ limits, owner: "fixture-registry" }), executionConfigurationDigest: hash({ limits, owner: "fixture-current-config" }),
    configuredDailyLimit: 200_000, configuredPerTaskLimit: 0, configuredTimeoutMs: 30_000, configuredMaxOutputTokens: 100, ...overrides };
  return { ...snapshot, configurationDigest: hash(snapshot) };
}
