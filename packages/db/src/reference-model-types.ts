export type FunctionalCriteriaRow = {
  capabilityGroup: string;
  functionName: string;
  componentName: string;
  criteria: string;
  referenceSection: string | null;
};

export type ValueStreamActivityRow = {
  valueStream: string;
  valueStreamStage: string;
  criteria: string;
  referenceSection: string | null;
};

export type ParticipationMatrixRow = {
  valueStream: string;
  valueStreamStage: string;
  reference: string | null;
  participationByColumn: Record<string, string | null>;
};

export type PriorityClass = "required" | "recommended" | "optional";
