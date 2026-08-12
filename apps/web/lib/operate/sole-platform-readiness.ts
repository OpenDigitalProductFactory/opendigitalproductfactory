export type SolePlatformReadinessCategory =
  | "recover"
  | "upgrade"
  | "data-continuity"
  | "health"
  | "governance";

export type SolePlatformReadinessDimensionId =
  | "backup-success"
  | "trial-restore"
  | "self-upgrade-recovery-point"
  | "rollback-readiness"
  | "migration-safety"
  | "db-continuity"
  | "platform-health"
  | "alert-routing"
  | "operator-runbook";

export type SolePlatformEvidenceStatus =
  | "passed"
  | "degraded"
  | "failed"
  | "not-run"
  | "not-applicable";

export type SolePlatformRequirementLevel = "blocker" | "degradation";
export type SolePlatformFindingKind =
  | "missing-evidence"
  | "stale-evidence"
  | "failed-evidence"
  | "degraded-evidence"
  | "open-blocker";
export type SolePlatformReadinessStatus = "ready" | "degraded" | "not-ready";
export type SolePlatformDimensionState =
  | "passed"
  | "blocked"
  | "degraded"
  | "missing"
  | "stale"
  | "not-applicable";

export interface SolePlatformReadinessPolicy {
  id: SolePlatformReadinessDimensionId;
  category: SolePlatformReadinessCategory;
  label: string;
  requirement: SolePlatformRequirementLevel;
  staleAfterHours: number;
  allowNotApplicable?: boolean;
  acceptedEvidence: readonly string[];
  defaultNextAction: string;
}

export interface SolePlatformReadinessEvidence {
  dimensionId: SolePlatformReadinessDimensionId;
  status: SolePlatformEvidenceStatus;
  observedAt?: Date | string | null;
  summary?: string;
  sourceKind?: string;
  sourceId?: string;
  nextAction?: string;
}

export interface SolePlatformOperationalBlocker {
  code: string;
  severity: SolePlatformRequirementLevel;
  summary: string;
  nextAction: string;
  sourceKind?: string;
  sourceId?: string;
}

export interface SolePlatformReadinessInput {
  evidence: readonly SolePlatformReadinessEvidence[];
  blockers?: readonly SolePlatformOperationalBlocker[];
  now?: Date;
  policies?: readonly SolePlatformReadinessPolicy[];
}

export interface SolePlatformReadinessFinding {
  code: string;
  kind: SolePlatformFindingKind;
  severity: SolePlatformRequirementLevel;
  dimensionId?: SolePlatformReadinessDimensionId;
  summary: string;
  nextAction: string;
  sourceKind?: string;
  sourceId?: string;
}

export interface SolePlatformDimensionVerdict {
  policy: SolePlatformReadinessPolicy;
  state: SolePlatformDimensionState;
  evidence: SolePlatformReadinessEvidence | null;
  finding: SolePlatformReadinessFinding | null;
}

export interface SolePlatformReadinessVerdict {
  status: SolePlatformReadinessStatus;
  generatedAt: string;
  summary: string;
  dimensions: SolePlatformDimensionVerdict[];
  findings: SolePlatformReadinessFinding[];
  counts: {
    passed: number;
    degraded: number;
    blocked: number;
    missing: number;
    stale: number;
    notApplicable: number;
  };
  evidenceRefs: Array<{
    dimensionId: SolePlatformReadinessDimensionId;
    sourceKind: string;
    sourceId: string;
  }>;
}

export const SOLE_PLATFORM_READINESS_MATRIX: readonly SolePlatformReadinessPolicy[] = [
  {
    id: "backup-success",
    category: "recover",
    label: "Managed backup success",
    requirement: "blocker",
    staleAfterHours: 30,
    acceptedEvidence: ["BackupRun(status=ok, prunedAt=null)"],
    defaultNextAction: "Run the managed backup job and confirm the latest retained backup completed successfully.",
  },
  {
    id: "trial-restore",
    category: "recover",
    label: "Trial restore proof",
    requirement: "blocker",
    staleAfterHours: 168,
    acceptedEvidence: ["BackupRestore(trigger=trial-verification, status=ok)"],
    defaultNextAction: "Run a trial restore and confirm it completes without a corruption alert.",
  },
  {
    id: "self-upgrade-recovery-point",
    category: "upgrade",
    label: "Self-upgrade recovery point",
    requirement: "blocker",
    staleAfterHours: 720,
    acceptedEvidence: ["SelfUpgradeRun.completionEvidence.recoveryPoint(status=ok)"],
    defaultNextAction: "Run the governed self-upgrade path until it records a complete recovery point.",
  },
  {
    id: "rollback-readiness",
    category: "upgrade",
    label: "Rollback readiness",
    requirement: "blocker",
    staleAfterHours: 720,
    acceptedEvidence: ["SelfUpgradeRun rollback evidence or hasGovernedRecoveryPoint=true"],
    defaultNextAction: "Verify the latest upgrade can restore from its governed recovery point.",
  },
  {
    id: "migration-safety",
    category: "upgrade",
    label: "Migration safety evidence",
    requirement: "blocker",
    staleAfterHours: 168,
    acceptedEvidence: ["migration-safety-guard pass", "local-CI migration apply pass"],
    defaultNextAction: "Run migration safety verification against the target source before treating the install as primary.",
  },
  {
    id: "db-continuity",
    category: "data-continuity",
    label: "Database continuity guard",
    requirement: "blocker",
    staleAfterHours: 24,
    acceptedEvidence: ["db continuity verdict ok"],
    defaultNextAction: "Resolve the database continuity guard and confirm the host marker and DB epoch agree.",
  },
  {
    id: "platform-health",
    category: "health",
    label: "Platform health",
    requirement: "blocker",
    staleAfterHours: 1,
    acceptedEvidence: ["aggregatePlatformHealth(status=healthy)"],
    defaultNextAction: "Restore required platform services and rerun the health probes.",
  },
  {
    id: "alert-routing",
    category: "health",
    label: "Alert routing",
    requirement: "degradation",
    staleAfterHours: 168,
    acceptedEvidence: ["alert route test or notification delivery receipt"],
    defaultNextAction: "Send or verify an operational alert route so owners will see recovery-critical failures.",
  },
  {
    id: "operator-runbook",
    category: "governance",
    label: "Operator recovery runbook",
    requirement: "degradation",
    staleAfterHours: 2160,
    acceptedEvidence: ["current DR or self-upgrade runbook reviewed"],
    defaultNextAction: "Review the operator-facing DR and self-upgrade runbooks and record the review.",
  },
] as const;

const STATUS_TO_STATE: Record<SolePlatformEvidenceStatus, SolePlatformDimensionState> = {
  passed: "passed",
  degraded: "degraded",
  failed: "blocked",
  "not-run": "missing",
  "not-applicable": "not-applicable",
};

function parseObservedAt(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function isStale(args: {
  evidence: SolePlatformReadinessEvidence;
  policy: SolePlatformReadinessPolicy;
  now: Date;
}): boolean {
  if (args.evidence.status !== "passed" && args.evidence.status !== "degraded") return false;
  const observedAt = parseObservedAt(args.evidence.observedAt);
  if (observedAt === null) return true;
  return args.now.getTime() - observedAt > args.policy.staleAfterHours * 60 * 60 * 1000;
}

function moreRecent(
  current: SolePlatformReadinessEvidence | undefined,
  candidate: SolePlatformReadinessEvidence,
): SolePlatformReadinessEvidence {
  if (!current) return candidate;
  const currentTime = parseObservedAt(current.observedAt) ?? Number.NEGATIVE_INFINITY;
  const candidateTime = parseObservedAt(candidate.observedAt) ?? Number.NEGATIVE_INFINITY;
  return candidateTime >= currentTime ? candidate : current;
}

function selectLatestEvidence(
  evidence: readonly SolePlatformReadinessEvidence[],
): Map<SolePlatformReadinessDimensionId, SolePlatformReadinessEvidence> {
  const byDimension = new Map<SolePlatformReadinessDimensionId, SolePlatformReadinessEvidence>();
  for (const item of evidence) {
    byDimension.set(item.dimensionId, moreRecent(byDimension.get(item.dimensionId), item));
  }
  return byDimension;
}

function findingForDimension(args: {
  policy: SolePlatformReadinessPolicy;
  evidence: SolePlatformReadinessEvidence | null;
  stale: boolean;
}): SolePlatformReadinessFinding | null {
  const { policy, evidence, stale } = args;
  const common = {
    severity: policy.requirement,
    dimensionId: policy.id,
    nextAction: evidence?.nextAction ?? policy.defaultNextAction,
    sourceKind: evidence?.sourceKind,
    sourceId: evidence?.sourceId,
  };

  if (!evidence) {
    return {
      ...common,
      code: `${policy.id}:missing`,
      kind: "missing-evidence",
      summary: `${policy.label} has no recorded evidence.`,
    };
  }

  if (evidence.status === "failed") {
    return {
      ...common,
      code: `${policy.id}:failed`,
      kind: "failed-evidence",
      summary: evidence.summary ?? `${policy.label} failed its latest check.`,
    };
  }

  if (evidence.status === "not-run") {
    return {
      ...common,
      code: `${policy.id}:not-run`,
      kind: "missing-evidence",
      summary: evidence.summary ?? `${policy.label} has not been run.`,
    };
  }

  if (evidence.status === "not-applicable" && policy.allowNotApplicable !== true) {
    return {
      ...common,
      code: `${policy.id}:not-applicable`,
      kind: "missing-evidence",
      summary: evidence.summary ?? `${policy.label} cannot be waived for sole-platform readiness.`,
    };
  }

  if (stale) {
    return {
      ...common,
      code: `${policy.id}:stale`,
      kind: "stale-evidence",
      summary: evidence.summary ?? `${policy.label} evidence is stale.`,
    };
  }

  if (evidence.status === "degraded") {
    return {
      ...common,
      code: `${policy.id}:degraded`,
      kind: "degraded-evidence",
      summary: evidence.summary ?? `${policy.label} is degraded.`,
    };
  }

  return null;
}

function dimensionState(args: {
  evidence: SolePlatformReadinessEvidence | null;
  finding: SolePlatformReadinessFinding | null;
  stale: boolean;
}): SolePlatformDimensionState {
  if (!args.evidence) return "missing";
  if (args.finding?.kind === "stale-evidence" || args.stale) return "stale";
  if (args.finding?.severity === "blocker") return "blocked";
  if (args.finding?.severity === "degradation") return "degraded";
  return STATUS_TO_STATE[args.evidence.status];
}

function findingForOpenBlocker(blocker: SolePlatformOperationalBlocker): SolePlatformReadinessFinding {
  return {
    code: blocker.code,
    kind: "open-blocker",
    severity: blocker.severity,
    summary: blocker.summary,
    nextAction: blocker.nextAction,
    sourceKind: blocker.sourceKind,
    sourceId: blocker.sourceId,
  };
}

function summarize(status: SolePlatformReadinessStatus, findings: SolePlatformReadinessFinding[]): string {
  if (status === "ready") {
    return "All required sole-platform operational evidence is current and passing.";
  }
  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const degradations = findings.length - blockers;
  if (status === "not-ready") {
    return `${blockers} blocker${blockers === 1 ? "" : "s"} prevent sole-platform readiness.`;
  }
  return `${degradations} degradation${degradations === 1 ? "" : "s"} require attention before the claim is strong.`;
}

export function evaluateSolePlatformReadiness(
  input: SolePlatformReadinessInput,
): SolePlatformReadinessVerdict {
  const now = input.now ?? new Date();
  const policies = input.policies ?? SOLE_PLATFORM_READINESS_MATRIX;
  const byDimension = selectLatestEvidence(input.evidence);
  const dimensions: SolePlatformDimensionVerdict[] = policies.map((policy) => {
    const evidence = byDimension.get(policy.id) ?? null;
    const stale = evidence ? isStale({ evidence, policy, now }) : false;
    const finding = findingForDimension({ policy, evidence, stale });
    return {
      policy,
      state: dimensionState({ evidence, finding, stale }),
      evidence,
      finding,
    };
  });

  const findings = [
    ...dimensions.map((dimension) => dimension.finding).filter((finding): finding is SolePlatformReadinessFinding => finding != null),
    ...(input.blockers ?? []).map(findingForOpenBlocker),
  ];
  const blockers = findings.filter((finding) => finding.severity === "blocker");
  const degradations = findings.filter((finding) => finding.severity === "degradation");
  const status: SolePlatformReadinessStatus =
    blockers.length > 0 ? "not-ready" : degradations.length > 0 ? "degraded" : "ready";

  return {
    status,
    generatedAt: now.toISOString(),
    summary: summarize(status, findings),
    dimensions,
    findings,
    counts: {
      passed: dimensions.filter((dimension) => dimension.state === "passed").length,
      degraded: dimensions.filter((dimension) => dimension.state === "degraded").length,
      blocked: dimensions.filter((dimension) => dimension.state === "blocked").length,
      missing: dimensions.filter((dimension) => dimension.state === "missing").length,
      stale: dimensions.filter((dimension) => dimension.state === "stale").length,
      notApplicable: dimensions.filter((dimension) => dimension.state === "not-applicable").length,
    },
    evidenceRefs: input.evidence
      .filter((evidence) => evidence.sourceKind && evidence.sourceId)
      .map((evidence) => ({
        dimensionId: evidence.dimensionId,
        sourceKind: evidence.sourceKind!,
        sourceId: evidence.sourceId!,
      })),
  };
}

export function isSolePlatformReady(input: SolePlatformReadinessInput): boolean {
  return evaluateSolePlatformReadiness(input).status === "ready";
}
