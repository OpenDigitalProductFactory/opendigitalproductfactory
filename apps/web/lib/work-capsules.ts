export const WORK_CAPSULE_STATUSES = [
  "draft",
  "ready",
  "working",
  "blocked",
  "verifying",
  "ready-for-review",
  "ready-for-promotion",
  "complete",
  "abandoned",
  "archived",
] as const;

export type WorkCapsuleStatus = (typeof WORK_CAPSULE_STATUSES)[number];

export const WORK_CAPSULE_SOURCES = [
  "backlog",
  "build-studio",
  "external-adoption",
  "git-promotion",
  "manual",
  "scheduled-steward",
] as const;

export type WorkCapsuleSource = (typeof WORK_CAPSULE_SOURCES)[number];

export const WORK_CAPSULE_EXECUTOR_KINDS = [
  "build-studio",
  "codex-desktop",
  "claude-desktop",
  "human",
  "git-webhook",
  "dpf-native",
] as const;

export type WorkCapsuleExecutorKind = (typeof WORK_CAPSULE_EXECUTOR_KINDS)[number];

export const WORK_CAPSULE_ACTIVITY_KINDS = [
  "created",
  "adopted",
  "status-changed",
  "status-override",
  "executor-changed",
  "scope-claimed",
  "scope-released",
  "evidence-recorded",
  "pr-linked",
  "pr-merged",
  "sandbox-attached",
  "verification-passed",
  "verification-failed",
  "provider-blocked",
  "provider-unblocked",
  "lease-renewed",
  "lease-expired",
  "promotion-prepared",
  "promotion-approved",
  "promotion-rolled-back",
  "archived",
  "superseded",
] as const;

export type WorkCapsuleActivityKind = (typeof WORK_CAPSULE_ACTIVITY_KINDS)[number];

export const WORK_CAPSULE_BRANCH_TAXONOMIES = [
  "feat",
  "fix",
  "chore",
  "doc",
  "clean",
] as const;

export type WorkCapsuleBranchTaxonomy = (typeof WORK_CAPSULE_BRANCH_TAXONOMIES)[number];

export const WORK_CAPSULE_EVIDENCE_KINDS = [
  "test",
  "build",
  "screenshot",
  "verification",
  "lint",
  "note",
] as const;

export type WorkCapsuleEvidenceKind = (typeof WORK_CAPSULE_EVIDENCE_KINDS)[number];

export const LEASE_TTL_MS = 30 * 60 * 1000;
export const STALE_CACHE_MS = 30 * 60 * 1000;
export const STATUS_OVERRIDE_TTL_MS = 24 * 60 * 60 * 1000;

export type ScopeClaim = {
  kind: "path" | "module" | "package" | "route" | "skill" | "prompt";
  value: string;
  intent: "edit" | "read";
  recordedAt: string;
  recordedByPrincipalId: string;
};

const STATUS_SET = new Set<string>(WORK_CAPSULE_STATUSES);
const SOURCE_SET = new Set<string>(WORK_CAPSULE_SOURCES);
const EXECUTOR_SET = new Set<string>(WORK_CAPSULE_EXECUTOR_KINDS);
const ACTIVITY_SET = new Set<string>(WORK_CAPSULE_ACTIVITY_KINDS);
const TAXONOMY_SET = new Set<string>(WORK_CAPSULE_BRANCH_TAXONOMIES);
const EVIDENCE_KIND_SET = new Set<string>(WORK_CAPSULE_EVIDENCE_KINDS);
const SCOPE_KIND_SET = new Set<ScopeClaim["kind"]>([
  "path",
  "module",
  "package",
  "route",
  "skill",
  "prompt",
]);
const SCOPE_INTENT_SET = new Set<ScopeClaim["intent"]>(["edit", "read"]);

export function isWorkCapsuleStatus(value: unknown): value is WorkCapsuleStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function isWorkCapsuleSource(value: unknown): value is WorkCapsuleSource {
  return typeof value === "string" && SOURCE_SET.has(value);
}

export function isWorkCapsuleExecutorKind(value: unknown): value is WorkCapsuleExecutorKind {
  return typeof value === "string" && EXECUTOR_SET.has(value);
}

export function isWorkCapsuleActivityKind(value: unknown): value is WorkCapsuleActivityKind {
  return typeof value === "string" && ACTIVITY_SET.has(value);
}

export function isWorkCapsuleEvidenceKind(value: unknown): value is WorkCapsuleEvidenceKind {
  return typeof value === "string" && EVIDENCE_KIND_SET.has(value);
}

export function normalizeBranchTaxonomy(
  branch: string | null | undefined,
): WorkCapsuleBranchTaxonomy | null {
  const prefix = branch?.split("/")[0]?.trim();
  return prefix && TAXONOMY_SET.has(prefix) ? (prefix as WorkCapsuleBranchTaxonomy) : null;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return Number.isFinite(Date.parse(value));
}

export function parseScopeClaims(value: unknown): ScopeClaim[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ScopeClaim => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Record<string, unknown>;
    return (
      typeof candidate.value === "string" &&
      candidate.value.trim().length > 0 &&
      isIsoTimestamp(candidate.recordedAt) &&
      typeof candidate.recordedByPrincipalId === "string" &&
      SCOPE_KIND_SET.has(candidate.kind as ScopeClaim["kind"]) &&
      SCOPE_INTENT_SET.has(candidate.intent as ScopeClaim["intent"])
    );
  });
}
