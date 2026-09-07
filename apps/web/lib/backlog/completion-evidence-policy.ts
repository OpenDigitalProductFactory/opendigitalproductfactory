import { isRecord } from "@/lib/shared/coerce";

import {
  evidenceKindMetadata,
  isExecutionEvidenceKind,
  type ExecutionEvidenceDimension,
  type ExecutionEvidenceKind,
} from "./execution-evidence";

export const COMPLETION_WORK_CLASSES = [
  "documentation",
  "verified-existing",
  "implementation",
  "operational",
] as const;

export type CompletionWorkClass = (typeof COMPLETION_WORK_CLASSES)[number];
export type CompletionDisposition =
  | { disposition: "verified" }
  | { disposition: "not-applicable"; reason: string };

export type CompletionEvidenceManifest = {
  workClass: CompletionWorkClass;
  evidenceActivityIds: string[];
  useActiveBuildEvidence: boolean;
  ux?: CompletionDisposition;
  migration?: CompletionDisposition;
};

export type CompletionEvidenceFact = {
  id: string;
  itemId: string;
  evidenceKind: ExecutionEvidenceKind;
  recordedAt: Date;
  structurallyValid: boolean;
};

export type ActiveBuildCompletionEvidence = {
  testsPassed: boolean;
  productionBuildPassed: boolean;
  ux: "verified" | "skipped" | "failed" | "not-run";
};

export type CompletionEvidencePolicyInput = {
  item: {
    id: string;
    itemId: string;
    status: string;
    workType: string | null;
  };
  rawManifest: unknown;
  evidence: CompletionEvidenceFact[];
  activeBuildEvidence: ActiveBuildCompletionEvidence | null;
  evidenceCutoff: Date;
  now: Date;
};

export type CompletionEvidenceBlockerCode =
  | "missing-manifest"
  | "invalid-manifest"
  | "incompatible-work-class"
  | "missing-evidence-reference"
  | "foreign-evidence"
  | "stale-evidence"
  | "invalid-evidence"
  | "missing-dimension"
  | "newer-failure"
  | "invalid-not-applicable-reason"
  | "active-build-evidence-missing";

export type CompletionEvidenceBlocker = {
  code: CompletionEvidenceBlockerCode;
  message: string;
  dimension?: ExecutionEvidenceDimension | "manifest";
  evidenceActivityId?: string;
};

export type CompletionEvidenceVerdict = {
  allowed: boolean;
  noOp: boolean;
  normalizedManifest: CompletionEvidenceManifest | null;
  acceptanceEvidenceRefs?: string[];
  blockers: CompletionEvidenceBlocker[];
  nextAction: string | null;
};

const WORK_CLASS_SET: ReadonlySet<string> = new Set(COMPLETION_WORK_CLASSES);
const MIN_NOT_APPLICABLE_REASON_LENGTH = 12;

const ALLOWED_WORK_CLASSES_BY_TYPE: Record<string, ReadonlySet<CompletionWorkClass>> = {
  doc: new Set(["documentation"]),
  feature: new Set(["implementation", "verified-existing"]),
  bug: new Set(["implementation", "verified-existing"]),
  refactor: new Set(["implementation", "verified-existing"]),
  tool: new Set(["implementation", "verified-existing", "operational"]),
  skill: new Set(["implementation", "verified-existing", "operational"]),
  chore: new Set(["implementation", "verified-existing", "operational"]),
};

const REQUIRED_DIMENSIONS: Record<CompletionWorkClass, readonly ExecutionEvidenceDimension[]> = {
  documentation: ["documentation"],
  "verified-existing": ["source", "manual"],
  implementation: ["source", "unit-tests", "production-build"],
  operational: ["manual"],
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDisposition(raw: unknown): CompletionDisposition | null {
  if (!isRecord(raw)) return null;
  if (raw.disposition === "verified") return { disposition: "verified" };
  if (raw.disposition === "not-applicable") {
    return {
      disposition: "not-applicable",
      reason: stringValue(raw.reason) ?? "",
    };
  }
  return null;
}

export function normalizeCompletionEvidenceManifest(
  raw: unknown,
): CompletionEvidenceManifest | null {
  if (!isRecord(raw) || !WORK_CLASS_SET.has(String(raw.workClass))) return null;
  if (!Array.isArray(raw.evidenceActivityIds)) return null;
  if (
    raw.evidenceActivityIds.length > 50
    || raw.evidenceActivityIds.some((value) => stringValue(value) == null)
  ) {
    return null;
  }
  const evidenceActivityIds = Array.from(
    new Set(raw.evidenceActivityIds.map(stringValue).filter((value): value is string => Boolean(value))),
  );
  return {
    workClass: raw.workClass as CompletionWorkClass,
    evidenceActivityIds,
    useActiveBuildEvidence: raw.useActiveBuildEvidence === true,
    ...(raw.ux === undefined ? {} : { ux: normalizeDisposition(raw.ux) ?? undefined }),
    ...(raw.migration === undefined
      ? {}
      : { migration: normalizeDisposition(raw.migration) ?? undefined }),
  };
}

function blocker(
  code: CompletionEvidenceBlockerCode,
  message: string,
  dimension?: CompletionEvidenceBlocker["dimension"],
  evidenceActivityId?: string,
): CompletionEvidenceBlocker {
  return {
    code,
    message,
    ...(dimension ? { dimension } : {}),
    ...(evidenceActivityId ? { evidenceActivityId } : {}),
  };
}

function validateWorkClass(
  workType: string | null,
  workClass: CompletionWorkClass,
): CompletionEvidenceBlocker | null {
  const allowed = workType ? ALLOWED_WORK_CLASSES_BY_TYPE[workType] : null;
  if (allowed?.has(workClass)) return null;
  return blocker(
    "incompatible-work-class",
    `workType=${workType ?? "missing"} cannot complete as ${workClass}`,
    "manifest",
  );
}

function validateApplicability(
  manifest: CompletionEvidenceManifest,
  blockers: CompletionEvidenceBlocker[],
): ExecutionEvidenceDimension[] {
  if (manifest.workClass !== "implementation") return [];
  const required: ExecutionEvidenceDimension[] = [];
  for (const dimension of ["ux", "migration"] as const) {
    const disposition = manifest[dimension];
    if (!disposition) {
      blockers.push(blocker(
        "invalid-manifest",
        `implementation completion must declare ${dimension} as verified or not-applicable`,
        dimension,
      ));
      continue;
    }
    if (disposition.disposition === "verified") {
      required.push(dimension);
      continue;
    }
    if (disposition.reason.trim().length < MIN_NOT_APPLICABLE_REASON_LENGTH) {
      blockers.push(blocker(
        "invalid-not-applicable-reason",
        `${dimension} not-applicable requires a concrete rationale`,
        dimension,
      ));
    }
  }
  return required;
}

function nextActionFor(blockers: CompletionEvidenceBlocker[]): string | null {
  if (blockers.length === 0) return null;
  const dimensions = Array.from(
    new Set(blockers.map((entry) => entry.dimension).filter((entry) => entry && entry !== "manifest")),
  );
  if (dimensions.length > 0) {
    return `Record fresh evidence for ${dimensions.join(", ")} with record_execution_evidence, then retry with those activity IDs.`;
  }
  return "Correct completionEvidence so it matches this backlog item's work type, then retry.";
}

export function evaluateCompletionEvidence(
  input: CompletionEvidencePolicyInput,
): CompletionEvidenceVerdict {
  if (input.item.status === "done") {
    return {
      allowed: true,
      noOp: true,
      normalizedManifest: null,
      acceptanceEvidenceRefs: [],
      blockers: [],
      nextAction: null,
    };
  }

  const manifest = normalizeCompletionEvidenceManifest(input.rawManifest);
  if (!manifest) {
    const blockers = [
      blocker(
        input.rawManifest == null ? "missing-manifest" : "invalid-manifest",
        "status=done from an agent surface requires a typed completionEvidence manifest",
        "manifest",
      ),
    ];
    return {
      allowed: false,
      noOp: false,
      normalizedManifest: null,
      acceptanceEvidenceRefs: [],
      blockers,
      nextAction: nextActionFor(blockers),
    };
  }

  const blockers: CompletionEvidenceBlocker[] = [];
  const workClassBlocker = validateWorkClass(input.item.workType, manifest.workClass);
  if (workClassBlocker) blockers.push(workClassBlocker);
  const applicabilityDimensions = validateApplicability(manifest, blockers);

  const byId = new Map(input.evidence.map((entry) => [entry.id, entry]));
  const satisfied = new Set<ExecutionEvidenceDimension>();
  const acceptanceEvidenceRefsByDimension = new Map<ExecutionEvidenceDimension, string[]>();
  for (const evidenceActivityId of manifest.evidenceActivityIds) {
    const evidence = byId.get(evidenceActivityId);
    if (!evidence) {
      blockers.push(blocker(
        "missing-evidence-reference",
        `Evidence activity ${evidenceActivityId} does not resolve`,
        undefined,
        evidenceActivityId,
      ));
      continue;
    }
    const metadata = evidenceKindMetadata(evidence.evidenceKind);
    if (evidence.itemId !== input.item.id) {
      blockers.push(blocker(
        "foreign-evidence",
        `Evidence activity ${evidenceActivityId} belongs to another backlog item`,
        metadata.dimension,
        evidenceActivityId,
      ));
      continue;
    }
    if (evidence.recordedAt < input.evidenceCutoff || evidence.recordedAt > input.now) {
      blockers.push(blocker(
        "stale-evidence",
        `Evidence activity ${evidenceActivityId} is outside the current completion window`,
        metadata.dimension,
        evidenceActivityId,
      ));
      continue;
    }
    if (!evidence.structurallyValid || !metadata.gateEligible || metadata.polarity !== "pass") {
      blockers.push(blocker(
        "invalid-evidence",
        `Evidence activity ${evidenceActivityId} cannot satisfy a completion gate`,
        metadata.dimension,
        evidenceActivityId,
      ));
      continue;
    }
    satisfied.add(metadata.dimension);
    if (metadata.dimension === "manual" || metadata.dimension === "ux") {
      const refs = acceptanceEvidenceRefsByDimension.get(metadata.dimension) ?? [];
      refs.push(evidence.id);
      acceptanceEvidenceRefsByDimension.set(metadata.dimension, refs);
    }
  }

  if (manifest.useActiveBuildEvidence) {
    const build = input.activeBuildEvidence;
    if (!build) {
      blockers.push(blocker(
        "active-build-evidence-missing",
        "useActiveBuildEvidence was requested but no active Build Studio evidence resolved",
        "manifest",
      ));
    } else {
      if (build.testsPassed) satisfied.add("unit-tests");
      if (build.productionBuildPassed) satisfied.add("production-build");
      if (build.ux === "verified") satisfied.add("ux");
    }
  }

  const required = [...REQUIRED_DIMENSIONS[manifest.workClass], ...applicabilityDimensions];
  for (const dimension of required) {
    if (!satisfied.has(dimension)) {
      blockers.push(blocker(
        "missing-dimension",
        `Completion evidence is missing ${dimension}`,
        dimension,
      ));
    }
  }

  const latestByDimension = new Map<ExecutionEvidenceDimension, CompletionEvidenceFact>();
  for (const evidence of input.evidence) {
    if (
      evidence.itemId !== input.item.id
      || evidence.recordedAt < input.evidenceCutoff
      || evidence.recordedAt > input.now
      || !isExecutionEvidenceKind(evidence.evidenceKind)
    ) {
      continue;
    }
    const dimension = evidenceKindMetadata(evidence.evidenceKind).dimension;
    const current = latestByDimension.get(dimension);
    if (!current || current.recordedAt < evidence.recordedAt) {
      latestByDimension.set(dimension, evidence);
    }
  }
  for (const dimension of ["manual", "ux"] as const) {
    const latest = latestByDimension.get(dimension);
    if (latest && evidenceKindMetadata(latest.evidenceKind).polarity === "fail") {
      acceptanceEvidenceRefsByDimension.delete(dimension);
    }
  }
  for (const dimension of new Set(required)) {
    const latest = latestByDimension.get(dimension);
    if (latest && evidenceKindMetadata(latest.evidenceKind).polarity === "fail") {
      acceptanceEvidenceRefsByDimension.delete(dimension);
      blockers.push(blocker(
        "newer-failure",
        `A newer ${dimension} failure invalidates the prior pass`,
        dimension,
        latest.id,
      ));
    }
  }

  return {
    allowed: blockers.length === 0,
    noOp: false,
    normalizedManifest: manifest,
    acceptanceEvidenceRefs: [
      ...(acceptanceEvidenceRefsByDimension.get("manual") ?? []),
      ...(acceptanceEvidenceRefsByDimension.get("ux") ?? []),
    ],
    blockers,
    nextAction: nextActionFor(blockers),
  };
}
