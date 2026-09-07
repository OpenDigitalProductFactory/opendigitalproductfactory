export type AgentModelConfigDefault = {
  agentId: string;
  minimumTier: string;
  budgetClass: string;
  minimumCapabilities?: Record<string, boolean>;
  minimumContextTokens?: number;
};

export type ExistingAgentModelConfig = {
  minimumTier: string;
  budgetClass: string;
  pinnedProviderId: string | null;
  pinnedModelId: string | null;
  minimumCapabilities: unknown;
  minimumContextTokens: number | null;
  configuredById: string | null;
};

export type AgentModelDefaultUpdate = {
  minimumTier?: string;
  budgetClass?: string;
  pinnedProviderId?: null;
  pinnedModelId?: null;
  minimumCapabilities?: Record<string, boolean>;
  minimumContextTokens?: number;
};

export const AGENT_MODEL_CONFIG_DEFAULTS: AgentModelConfigDefault[] = [
  // Value-stream orchestrators (LIFE-005). An orchestrator reads a whole
  // stream and routes it, so it needs real tool fidelity and room to hold the
  // survey — a weak local model would route confidently and wrongly. 32k is
  // the floor, not the target.
  { agentId: "evaluate-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "explore-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "integrate-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "deploy-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "release-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "consume-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "operate-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "governance-orchestrator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "finance-agent", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "build-specialist", minimumTier: "strong", budgetClass: "quality_first", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "change-reviewer", minimumTier: "strong", budgetClass: "quality_first", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "coo", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "platform-engineer", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "admin-assistant", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "ops-coordinator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "portfolio-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "external-catalog-scout", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  // BI-6D10EB1F: strong floor — market-research synthesis with a strict
  // no-fabrication requirement is quality-sensitive; a weak local model
  // fabricates competitor numbers rather than citing sources.
  { agentId: "market-research-analyst", minimumTier: "strong", budgetClass: "quality_first", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "inventory-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "ea-architect", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "hr-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "time-off-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "customer-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  // minimumContextTokens: 0 — no static context floor. Routing uses a dynamic
  // floor computed from actual message size (estimatedInputTokens × 1.5), which
  // naturally scales with each subtask. The prompt instructs the agent to work
  // in focused atomic turns so any available model — including local — can serve.
  { agentId: "marketing-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 0 },
  { agentId: "storefront-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "onboarding-coo", minimumTier: "basic", budgetClass: "minimize_cost", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "doc-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "data-architect", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "compliance-officer", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "finance-controller", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  // Bookkeeper (S-BK): confidential money-of-record work — a weak local model must
  // not import statements or reconcile, so floor at strong with tool use.
  { agentId: "bookkeeper", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  // Floors added by the EP-COWORKER-LIFECYCLE conformance gate (LIFE-005):
  // these three roster coworkers had no minimum tier at all, so a weak local
  // model could serve confidential merge/dispatch/legal work.
  { agentId: "data-steward", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "dispatcher", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "farm-ranch-steward", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "legal-operations-counsel", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "finance-agent", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "licensing-specialist", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  // EP-32B0E693: active in-process SOC and accessibility coworkers need an
  // explicit floor. These values follow the risk and input shape of the work;
  // they do not alter staffing, authority, or execution cadence.
  { agentId: "ux-accessibility-agent", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true, imageInput: true }, minimumContextTokens: 32000 },
  { agentId: "soc-triage-analyst", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "soc-investigator", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "soc-threat-hunter", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "soc-incident-commander", minimumTier: "strong", budgetClass: "quality_first", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  // UX Design Critic (AGT-906). imageInput is load-bearing, not optional: this
  // coworker reasons over rendered screenshots, and a text-only model served
  // here would answer confidently about a screen it never saw — the exact
  // fabrication class the model floors exist to prevent. strong tier because
  // design judgment is the task, and the corpus it is calibrated against is
  // expensive founder time that a weak model would waste.
  { agentId: "ux-design-critic", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true, imageInput: true }, minimumContextTokens: 32000 },
  // Internal developer security / mcp-integration acumens (BI-CC44E74F,
  // EP-413F2602), established via the factory door; draft until certification.
  { agentId: "security-engineer", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "integration-engineer", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
];

export function resolveAgentModelDefaultUpdate(
  existing: ExistingAgentModelConfig,
  declaration: AgentModelConfigDefault,
): AgentModelDefaultUpdate | null {
  if (existing.configuredById === null) {
    const desired: AgentModelDefaultUpdate = {
      minimumTier: declaration.minimumTier,
      budgetClass: declaration.budgetClass,
      pinnedProviderId: null,
      pinnedModelId: null,
      ...(declaration.minimumCapabilities !== undefined
        ? { minimumCapabilities: declaration.minimumCapabilities }
        : {}),
      ...(declaration.minimumContextTokens !== undefined
        ? { minimumContextTokens: declaration.minimumContextTokens }
        : {}),
    };
    const changed = Object.entries(desired).some(([key, value]) => {
      const current = existing[key as keyof ExistingAgentModelConfig];
      return JSON.stringify(current) !== JSON.stringify(value);
    });
    return changed ? desired : null;
  }

  const backfill: AgentModelDefaultUpdate = {
    ...(declaration.minimumCapabilities !== undefined &&
    existing.minimumCapabilities === null
      ? { minimumCapabilities: declaration.minimumCapabilities }
      : {}),
    ...(declaration.minimumContextTokens !== undefined &&
    existing.minimumContextTokens === null
      ? { minimumContextTokens: declaration.minimumContextTokens }
      : {}),
  };
  return Object.keys(backfill).length > 0 ? backfill : null;
}
