export type ReassessmentRecordedBudgetLimits = {
  dailyTokenLimit: number;
  perTaskTokenLimit: number;
  timeoutSeconds: number;
  maxTokens: number;
  executionType: "in_process";
};

export type ReassessmentBudgetConfiguration = {
  source: "registry-and-execution-config";
  agentId: string;
  registryAgentId: string;
  registryAgentName: string;
  executionAgentRowId: string;
  executionConfigId: string;
  registryLimits: ReassessmentRecordedBudgetLimits;
  executionConfigLimits: ReassessmentRecordedBudgetLimits;
  registryConfigurationDigest: string;
  executionConfigurationDigest: string;
  configuredDailyLimit: number;
  configuredPerTaskLimit: number;
  configuredTimeoutMs: number;
  configuredMaxOutputTokens: number;
  configurationDigest: string;
};

