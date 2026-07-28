import type { SensitivityLevel } from "./agent-router-types";

export type RouteContextDef = {
  routePrefix: string;
  domain: string;
  sensitivity: SensitivityLevel;
  domainContext: string;
  domainTools: string[];
  docsPath?: string;
  skills: Array<{
    label: string;
    description: string;
    capability: string | null;
    prompt: string;
    taskType?: "conversation" | "code_generation" | "analysis";
  }>;
};
