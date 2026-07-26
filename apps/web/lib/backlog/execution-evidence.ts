import { isRecord } from "@/lib/shared/coerce";

export const EXECUTION_EVIDENCE_KINDS = [
  "test_pass",
  "test_fail",
  "build_pass",
  "build_fail",
  "ux_verified",
  "ux_fail",
  "migration_pass",
  "migration_fail",
  "source_verified",
  "spec_review",
  "manual_check",
  "external_link",
] as const;

export type ExecutionEvidenceKind = (typeof EXECUTION_EVIDENCE_KINDS)[number];

export type ExecutionEvidenceDimension =
  | "unit-tests"
  | "production-build"
  | "ux"
  | "migration"
  | "source"
  | "documentation"
  | "manual"
  | "supporting-context";

export type EvidencePolarity = "pass" | "fail" | "neutral";

type EvidenceKindMetadata = {
  dimension: ExecutionEvidenceDimension;
  polarity: EvidencePolarity;
  gateEligible: boolean;
};

const EVIDENCE_KIND_METADATA: Record<ExecutionEvidenceKind, EvidenceKindMetadata> = {
  test_pass: { dimension: "unit-tests", polarity: "pass", gateEligible: true },
  test_fail: { dimension: "unit-tests", polarity: "fail", gateEligible: false },
  build_pass: { dimension: "production-build", polarity: "pass", gateEligible: true },
  build_fail: { dimension: "production-build", polarity: "fail", gateEligible: false },
  ux_verified: { dimension: "ux", polarity: "pass", gateEligible: true },
  ux_fail: { dimension: "ux", polarity: "fail", gateEligible: false },
  migration_pass: { dimension: "migration", polarity: "pass", gateEligible: true },
  migration_fail: { dimension: "migration", polarity: "fail", gateEligible: false },
  source_verified: { dimension: "source", polarity: "pass", gateEligible: true },
  spec_review: { dimension: "documentation", polarity: "pass", gateEligible: true },
  manual_check: { dimension: "manual", polarity: "pass", gateEligible: true },
  external_link: { dimension: "supporting-context", polarity: "neutral", gateEligible: false },
};

const EVIDENCE_KIND_SET: ReadonlySet<string> = new Set(EXECUTION_EVIDENCE_KINDS);

export function isExecutionEvidenceKind(value: unknown): value is ExecutionEvidenceKind {
  return typeof value === "string" && EVIDENCE_KIND_SET.has(value);
}

export function evidenceKindMetadata(kind: ExecutionEvidenceKind): EvidenceKindMetadata {
  return EVIDENCE_KIND_METADATA[kind];
}

export type NormalizedExecutionEvidencePayload = {
  evidenceKind: ExecutionEvidenceKind;
  url: string | null;
  body: string | null;
  toolExecutionId: string | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeExecutionEvidencePayload(
  raw: unknown,
): NormalizedExecutionEvidencePayload | null {
  if (!isRecord(raw) || !isExecutionEvidenceKind(raw.evidenceKind)) return null;
  return {
    evidenceKind: raw.evidenceKind,
    url: optionalString(raw.url),
    body: optionalString(raw.body),
    toolExecutionId: optionalString(raw.toolExecutionId),
  };
}

export function validateExecutionEvidenceStructure(
  kind: ExecutionEvidenceKind,
  url: string | null,
): string | null {
  if (kind !== "source_verified") return null;
  if (!url) return "source_verified evidence requires an HTTP(S) source or pull-request URL";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "source_verified evidence requires an HTTP(S) source or pull-request URL";
    }
    return null;
  } catch {
    return "source_verified evidence requires an HTTP(S) source or pull-request URL";
  }
}
