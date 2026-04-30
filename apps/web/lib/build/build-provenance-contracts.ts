export const PROVENANCE_GATED_FIELDS = [
  "verificationOut",
  "uxTestResults",
  "acceptanceMet",
] as const;

export type ProvenanceGatedField = (typeof PROVENANCE_GATED_FIELDS)[number];

export type ProvenanceReceiptSummary = {
  id: string;
  buildId?: string | null;
  receiptKind: string;
  executionStatus: string;
};

export type ArtifactContractEvaluationArgs = {
  field: string;
  value: unknown;
  receiptSummaries: ProvenanceReceiptSummary[];
  acceptedArtifacts: Partial<Record<ProvenanceGatedField, unknown>>;
  enforcementMode: "shadow" | "enforce";
};

export type ArtifactContractEvaluationResult = {
  ok: boolean;
  warnings: string[];
  errors: string[];
};

function buildResult(
  warnings: string[],
  errors: string[],
  enforcementMode: "shadow" | "enforce",
): ArtifactContractEvaluationResult {
  if (enforcementMode === "enforce" && errors.length > 0) {
    return { ok: false, warnings, errors };
  }

  return { ok: true, warnings: [...warnings, ...errors], errors };
}

function evaluateVerificationOut(
  args: ArtifactContractEvaluationArgs,
): ArtifactContractEvaluationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (args.receiptSummaries.length === 0) {
    errors.push("verificationOut requires at least one verification receipt");
  }

  const hasVerificationReceipt = args.receiptSummaries.some(
    (receipt) =>
      receipt.receiptKind === "sandbox-test-run" ||
      receipt.receiptKind === "sandbox-command",
  );

  if (!hasVerificationReceipt) {
    errors.push(
      "verificationOut requires a sandbox-test-run or sandbox-command receipt",
    );
  }

  return buildResult(warnings, errors, args.enforcementMode);
}

function evaluateUxTestResults(
  args: ArtifactContractEvaluationArgs,
): ArtifactContractEvaluationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const hasUxReceipt = args.receiptSummaries.some(
    (receipt) =>
      receipt.receiptKind === "ux-run" ||
      receipt.receiptKind === "ux-evaluation",
  );

  if (!hasUxReceipt) {
    errors.push("uxTestResults requires at least one UX receipt");
  }

  return buildResult(warnings, errors, args.enforcementMode);
}

function evaluateAcceptanceMet(
  args: ArtifactContractEvaluationArgs,
): ArtifactContractEvaluationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!args.acceptedArtifacts.verificationOut) {
    errors.push(
      "acceptanceMet requires an accepted verificationOut artifact",
    );
  }

  if (
    Array.isArray(args.value) &&
    args.value.length > 0 &&
    !args.acceptedArtifacts.uxTestResults
  ) {
    warnings.push(
      "acceptanceMet was saved before an accepted uxTestResults artifact was available",
    );
  }

  return buildResult(warnings, errors, args.enforcementMode);
}

export function evaluateArtifactContract(
  args: ArtifactContractEvaluationArgs,
): ArtifactContractEvaluationResult {
  switch (args.field) {
    case "verificationOut":
      return evaluateVerificationOut(args);
    case "uxTestResults":
      return evaluateUxTestResults(args);
    case "acceptanceMet":
      return evaluateAcceptanceMet(args);
    default:
      return { ok: true, warnings: [], errors: [] };
  }
}
