import type { AssuranceAffectedType, NormalizedAssuranceFinding } from "./types";

export interface AssuranceRunScope {
  type: AssuranceAffectedType;
  id: string;
}

export interface AssuranceRunInput {
  scope: AssuranceRunScope;
  input: Record<string, unknown>;
}

export interface AssuranceArtifact {
  artifactKind: "raw-output" | "bom" | "summary";
  name: string;
  digest?: string;
  value: unknown;
}

export interface AssuranceRunOutput {
  status: "passed" | "failed" | "partial" | "error";
  summary: Record<string, unknown>;
  findings: NormalizedAssuranceFinding[];
  artifacts: AssuranceArtifact[];
}

export interface AssuranceAdapter {
  adapterKey: string;
  adapterVersion: string;
  supportedScopes: AssuranceAffectedType[];
  run(input: AssuranceRunInput): Promise<AssuranceRunOutput>;
}
