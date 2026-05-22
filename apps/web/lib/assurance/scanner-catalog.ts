import type { ApprovedTool, ToolVerdict } from "@/lib/evaluate/tool-evaluation";

export type AssuranceScannerReadinessState = "ready" | "needs-evaluation";
export type AssuranceScannerReadinessReason = "approved-scanner-available" | "no-approved-scanner";

export interface AssuranceScannerReadiness {
  state: AssuranceScannerReadinessState;
  approvedScannerCount: number;
  scannerNames: string[];
  reason: AssuranceScannerReadinessReason;
}

type ToolEvaluationLike = {
  toolName: string;
  toolType?: string | null;
  status: string;
  conditions?: unknown;
  verdict?: unknown;
  approvedAt?: Date | string | null;
};

type ScannerCatalogDb = {
  toolEvaluation?: {
    findMany(args: unknown): Promise<ToolEvaluationLike[]>;
  };
};

export type ApprovedAssuranceTool = Pick<
  ApprovedTool,
  | "toolName"
  | "toolType"
  | "approvedVersion"
  | "allowedVersionRange"
  | "conditions"
  | "environments"
  | "evaluationId"
  | "approvedAt"
  | "reEvaluateAt"
  | "status"
>;

const KNOWN_SCANNER_NAMES = new Set([
  "black duck",
  "black duck sca",
  "black-duck",
  "black-duck-sca",
  "grype",
  "osv scanner",
  "osv-scanner",
  "trivy",
]);

const SCANNER_CONDITION_MARKERS = [
  "assurance:scanner",
  "vulnerability-scanner",
  "vulnerability_scan",
  "supply-chain-scanner",
  "sca",
];

function asConditions(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase();
}

function hasScannerCondition(conditions: string[]): boolean {
  return conditions.some((condition) => {
    const normalized = normalizedName(condition);
    return SCANNER_CONDITION_MARKERS.some((marker) => normalized.includes(marker));
  });
}

function verdictContainsSupplyChainRisk(verdict: unknown): boolean {
  const typed = verdict as Partial<ToolVerdict> | null;
  return Array.isArray(typed?.threatCategories) && typed.threatCategories.includes("supply_chain_risk");
}

function isScannerName(toolName: string): boolean {
  return KNOWN_SCANNER_NAMES.has(normalizedName(toolName));
}

function isRegistryScanner(tool: ApprovedAssuranceTool): boolean {
  return tool.status === "active" && (isScannerName(tool.toolName) || hasScannerCondition(tool.conditions));
}

function isEvaluationScanner(row: ToolEvaluationLike): boolean {
  if (row.status !== "approved" && row.status !== "conditional") return false;
  const conditions = asConditions(row.conditions);
  return isScannerName(row.toolName) || hasScannerCondition(conditions) || verdictContainsSupplyChainRisk(row.verdict);
}

function uniqueNames(names: string[]): string[] {
  return Array.from(new Set(names.map((name) => name.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export function resolveAssuranceScannerReadiness(input: {
  approvedTools: ApprovedAssuranceTool[];
  evaluations: ToolEvaluationLike[];
}): AssuranceScannerReadiness {
  const scannerNames = uniqueNames([
    ...input.approvedTools.filter(isRegistryScanner).map((tool) => tool.toolName),
    ...input.evaluations.filter(isEvaluationScanner).map((row) => row.toolName),
  ]);

  if (scannerNames.length === 0) {
    return {
      state: "needs-evaluation",
      approvedScannerCount: 0,
      scannerNames: [],
      reason: "no-approved-scanner",
    };
  }

  return {
    state: "ready",
    approvedScannerCount: scannerNames.length,
    scannerNames,
    reason: "approved-scanner-available",
  };
}

export function noApprovedScannerReadiness(): AssuranceScannerReadiness {
  return resolveAssuranceScannerReadiness({ approvedTools: [], evaluations: [] });
}

export async function getAssuranceScannerReadiness(
  db: ScannerCatalogDb,
  approvedTools: ApprovedAssuranceTool[] = [],
): Promise<AssuranceScannerReadiness> {
  const evaluations = await db.toolEvaluation?.findMany({
    where: { status: { in: ["approved", "conditional"] } },
    select: {
      toolName: true,
      toolType: true,
      status: true,
      conditions: true,
      verdict: true,
      approvedAt: true,
    },
  }) ?? [];

  return resolveAssuranceScannerReadiness({ approvedTools, evaluations });
}
