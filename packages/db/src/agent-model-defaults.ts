export type AgentModelConfigDefault = {
  agentId: string;
  minimumTier: string;
  budgetClass: string;
  minimumCapabilities?: Record<string, boolean>;
  minimumContextTokens?: number;
};

export const AGENT_MODEL_CONFIG_DEFAULTS: AgentModelConfigDefault[] = [
  { agentId: "build-specialist", minimumTier: "strong", budgetClass: "quality_first", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "coo", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "platform-engineer", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "admin-assistant", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "ops-coordinator", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "portfolio-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "external-catalog-scout", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "inventory-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "ea-architect", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "hr-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "customer-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "marketing-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "storefront-advisor", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "onboarding-coo", minimumTier: "basic", budgetClass: "minimize_cost", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "doc-specialist", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "data-architect", minimumTier: "adequate", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "compliance-officer", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
  { agentId: "finance-controller", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "finance-agent", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 16000 },
  { agentId: "licensing-specialist", minimumTier: "strong", budgetClass: "balanced", minimumCapabilities: { toolUse: true }, minimumContextTokens: 32000 },
];
