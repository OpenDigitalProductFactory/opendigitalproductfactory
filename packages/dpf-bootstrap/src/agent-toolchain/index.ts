/**
 * Public surface of the @dpf/bootstrap agent-toolchain planning library.
 * Shell adapters (scripts/dpf-bootstrap-agent-toolchain.{ps1,sh}) consume this
 * module via a small Node bridge and apply the resulting plans.
 *
 * No filesystem writes, network calls, or process spawns happen here. The
 * adapters own all side effects; this package owns the contract.
 */

export type {
  AgentToolchainState,
  McpReadinessProbeResult,
  SmokeTestResult,
  ReadinessState,
  PlanWriteMode,
} from "./types";

export {
  planCodexConfig,
  type CodexConfigPlan,
} from "./codex-config";

export {
  planClaudePluginConfig,
  type ClaudePluginConfigPlan,
  type InstalledPluginEntry,
  type InstalledPluginsFile,
  type PlanClaudePluginOptions,
} from "./claude-plugins";

export {
  planKernelMemorySeed,
  type MemorySeedPlan,
  type MemorySeedWrite,
  type PlanKernelMemorySeedOptions,
} from "./memory-seed";

export {
  planMcpReadinessProbe,
  interpretMcpReadinessResponse,
  type McpReadinessProbePlan,
} from "./mcp-readiness-probe";

export {
  renderSmokeTestScenario,
  interpretSmokeResponse,
  redactTranscriptForPersistence,
  type SmokeTestScenario,
} from "./smoke-test";

export {
  materializeAgentToolchainState,
  type MaterializeInputs,
} from "./install-state";

export {
  computeReadinessState,
  readinessCopy,
  type ReadinessCopy,
} from "./readiness-state";

export {
  computeAgentToolchainPlan,
  summarizePlan,
  type AgentToolchainPlan,
  type ComputeAgentToolchainPlanOptions,
} from "./bridge";

export {
  runMcpReadinessProbe,
  runSmokeProbe,
  type ClientSmokeResult,
} from "./probes";

export {
  normalizeRepoPath,
  repoPathsMatch,
} from "./path-normalize";

export {
  PINNED_UPSTREAM_VERSIONS,
  detectSuperpowersDrift,
  renderUpstreamDriftAdvisory,
  type UpstreamPluginId,
  type UpstreamVersionDrift,
} from "./upstream-versions";
