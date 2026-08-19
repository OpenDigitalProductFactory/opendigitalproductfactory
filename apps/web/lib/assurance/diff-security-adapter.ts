import { scanDiffForSecurityIssues, type ScanFinding } from "@/lib/build/security-scan";
import type { AssuranceAdapter, AssuranceRunInput, AssuranceRunOutput } from "./adapter-contract";
import { createFindingKey, normalizeVendorIdentifier } from "./finding-key";
import type {
  AssurancePolicySeverity,
  AssuranceReleaseImpact,
  NormalizedAssuranceFinding,
} from "./types";

const ADAPTER_KEY = "diff-security";
const ADAPTER_VERSION = "1";

function mapSeverity(severity: ScanFinding["severity"]): AssurancePolicySeverity {
  if (severity === "critical") return "critical";
  if (severity === "warning") return "medium";
  return "info";
}

function mapReleaseImpact(severity: ScanFinding["severity"]): AssuranceReleaseImpact {
  if (severity === "critical") return "block";
  if (severity === "warning") return "warn";
  return "track";
}

function normalizeFinding(finding: ScanFinding): NormalizedAssuranceFinding {
  const affectedId = finding.file || "unknown-source-file";
  const vendor = normalizeVendorIdentifier(
    finding.category,
    `${finding.file}:${finding.line}:${finding.message}`,
  );
  const keyInput = {
    adapterKey: ADAPTER_KEY,
    findingKind: "policy-violation" as const,
    affectedType: "source-file" as const,
    affectedId,
    vendorIdentifier: vendor.identifier,
  };

  return {
    ...keyInput,
    findingKey: createFindingKey(keyInput),
    title: finding.message,
    description: finding.evidence,
    sourceSeverity: finding.severity,
    policySeverity: mapSeverity(finding.severity),
    releaseImpact: mapReleaseImpact(finding.severity),
    reachability: "unknown",
    exposure: "unknown",
    identifierStability: vendor.stability,
    evidence: {
      file: finding.file,
      line: finding.line,
      category: finding.category,
      snippet: finding.evidence,
    },
    remediationHint: {},
  };
}

export function createDiffSecurityAdapter(): AssuranceAdapter {
  return {
    adapterKey: ADAPTER_KEY,
    adapterVersion: ADAPTER_VERSION,
    supportedScopes: ["source-file", "build-artifact-revision", "release-bundle"],
    async run(input: AssuranceRunInput): Promise<AssuranceRunOutput> {
      const diff = typeof input.input.diff === "string" ? input.input.diff : "";
      const result = scanDiffForSecurityIssues(diff);

      return {
        status: result.passed ? "passed" : "failed",
        summary: {
          scannedFiles: result.scannedFiles,
          criticalCount: result.criticalCount,
          warningCount: result.warningCount,
          summary: result.summary,
        },
        findings: result.findings.map(normalizeFinding),
        artifacts: [
          {
            artifactKind: "summary",
            name: "diff-security-scan-summary",
            value: result,
          },
        ],
      };
    },
  };
}
