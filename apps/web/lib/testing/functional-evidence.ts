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

const TOKEN_PATTERNS = [
  /\bdpfmcp_[A-Za-z0-9_-]+/g,
  /\bBearer\s+[A-Za-z0-9._-]+/g,
];

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
  const redact = (text: string) =>
    TOKEN_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, "[redacted-token]"), text);

  return {
    ...evidence,
    actual: redact(evidence.actual),
    expected: redact(evidence.expected),
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
