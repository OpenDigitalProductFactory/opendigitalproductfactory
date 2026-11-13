import {redactDiagnosticEvidenceText} from "../shared/diagnostic-evidence-redaction";
export type FunctionalFailureEvidenceInput = {
  testId: string;
  suite: string;
  route: string;
  expected: string;
  actual: string;
  screenshotPath: string | null;
  tracePath: string | null;
  userRole: string;
  agentId: string | null;
  routeContext: string;
  reproCommand: string;
  buildId?: string | null;
  backlogItemId?: string | null;
};

export type FunctionalFailureEvidence = FunctionalFailureEvidenceInput & {
  createdAt: string;
  likelyOwnerArea: string;
};

export function buildFunctionalFailureEvidence(
  input: FunctionalFailureEvidenceInput,
): FunctionalFailureEvidence {
  return {
    ...input,
    createdAt: new Date().toISOString(),
    likelyOwnerArea: inferOwnerArea(input.suite, input.route),
  };
}

export function redactEvidence(evidence: FunctionalFailureEvidence): FunctionalFailureEvidence {
  return {
    ...evidence,
    actual: redactDiagnosticEvidenceText(evidence.actual),
    expected: redactDiagnosticEvidenceText(evidence.expected),
  };
}

function inferOwnerArea(suite: string, route: string): string {
  if (suite.includes("build") || route.startsWith("/build")) return "build-studio";
  if (route.startsWith("/ops")) return "ops-backlog";
  if (route.includes("/discovery")) return "discovery";
  if (route.startsWith("/storefront")) return "storefront";
  if (route.startsWith("/platform/ai")) return "platform-ai";
  if (route.startsWith("/finance")) return "finance";
  return "platform";
}
