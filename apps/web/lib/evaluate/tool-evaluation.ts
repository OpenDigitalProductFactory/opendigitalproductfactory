export type CoSAIThreatCategory =
  | "improper_authentication"
  | "missing_access_control"
  | "input_validation_failure"
  | "data_control_boundary"
  | "inadequate_data_protection"
  | "missing_integrity_controls"
  | "session_transport_security"
  | "network_isolation_failure"
  | "trust_boundary_failure"
  | "resource_management_gap"
  | "operational_security_gap"
  | "supply_chain_risk";

export const COSAI_CATEGORIES: CoSAIThreatCategory[] = [
  "improper_authentication",
  "missing_access_control",
  "input_validation_failure",
  "data_control_boundary",
  "inadequate_data_protection",
  "missing_integrity_controls",
  "session_transport_security",
  "network_isolation_failure",
  "trust_boundary_failure",
  "resource_management_gap",
  "operational_security_gap",
  "supply_chain_risk",
];

export type ToolType =
  | "mcp_server"
  | "npm_package"
  | "api_integration"
  | "ai_provider"
  | "docker_image";

export type EvaluationStatus =
  | "proposed"
  | "in_review"
  | "approved"
  | "conditional"
  | "rejected"
  | "deprecated"
  | "re_evaluation";

export type ToolVerdict = {
  decision: "approve" | "conditional" | "reject";
  rationale: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  threatCategories: CoSAIThreatCategory[];
  confidenceScore: number;
};

export type EvaluationFinding = {
  reviewerAgentId: string;
  category:
    | "security"
    | "architecture"
    | "compliance"
    | "integration"
    | "supply_chain";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  evidence: string;
  recommendation: string;
  mitigatable: boolean;
  mitigation: string | null;
};

export type ReviewerRecord = {
  agentId: string;
  role: string;
  reviewedAt: string;
  findingCount: number;
  perspective: string;
};

export type ApprovedTool = {
  toolName: string;
  toolType: ToolType;
  approvedVersion: string;
  allowedVersionRange: string | null;
  conditions: string[];
  environments: ("development" | "sandbox" | "staging" | "production")[];
  evaluationId: string;
  approvedAt: string;
  reEvaluateAt: string;
  status: "active" | "deprecated" | "suspended";
};

export const RE_EVAL_DEFAULTS: Record<ToolType, number> = {
  mcp_server: 30,
  npm_package: 90,
  api_integration: 60,
  ai_provider: 60,
  docker_image: 30,
};
