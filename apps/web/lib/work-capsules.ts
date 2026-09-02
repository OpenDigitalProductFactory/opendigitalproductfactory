import { slugify } from "@/lib/shared/slugify";

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
  // Employment lifecycle (BI-2624B7EA). These three are the definition keys the
  // actuator spawns, registered in WORK_CASE_SOURCE_REGISTRY by BI-28EFA338.
  // They are BUSINESS instances: they coordinate a worker, not a code change, so
  // they carry no repository, worktree, PR or CI evidence (AC-ELA-006) and
  // BUSINESS_WORK_CAPSULE_SOURCES below stops one being defaulted onto them.
  "worker-onboarding",
  "worker-change",
  "worker-offboarding",
] as const;

/**
 * Capsule sources whose instances coordinate business work rather than a change
 * to this repository.
 *
 * A development capsule without a repository is broken; a business capsule WITH
 * one is a category error — it invites a reader to look for a branch that will
 * never exist. `createWorkCapsule` therefore defaults a repository for the
 * development sources only.
 */
export const BUSINESS_WORK_CAPSULE_SOURCES = new Set<string>([
  "worker-onboarding",
  "worker-change",
  "worker-offboarding",
]);

/**
 * The repository a new capsule records, if any.
 *
 * A development capsule without a repository is broken; a business capsule WITH
 * one is a category error that sends a reader looking for a branch that will
 * never exist (AC-ELA-006). Lives here, beside the source set the decision reads.
 */
export function capsuleRepositoryFullName(
  source: string,
  provided: string | null | undefined,
  platformDefault: () => string,
): string | null {
  return provided?.trim() || (BUSINESS_WORK_CAPSULE_SOURCES.has(source) ? null : platformDefault());
}

export type WorkCapsuleSource = (typeof WORK_CAPSULE_SOURCES)[number];

export const WORK_CAPSULE_DECISION_SCOPES = ["wwmd", "wwwd", "wsid"] as const;

export type WorkCapsuleDecisionScope = (typeof WORK_CAPSULE_DECISION_SCOPES)[number];

export const WORK_CAPSULE_PORTFOLIO_ROLES = [
  "foundational",
  "manufactureAndDeliver",
  "forEmployees",
  "productsAndServicesSold",
] as const;

export type WorkCapsulePortfolioRole = (typeof WORK_CAPSULE_PORTFOLIO_ROLES)[number];

export const WORK_CAPSULE_SCOPE_ACTIVITY_KINDS = [
  "delivery",
  "support",
  "improvement",
  "governance",
  "launch-readiness",
  "craft-judgment",
  "lifecycle",
  "remediation",
] as const;

export type WorkCapsuleScopeActivityKind = (typeof WORK_CAPSULE_SCOPE_ACTIVITY_KINDS)[number];

export const WORK_CAPSULE_OUTCOME_ANCHOR_KINDS = [
  "backlog-item",
  "epic",
  "work-case",
  "digital-product",
  "service-request",
  "customer-account",
  "coworker",
  "decision-interaction",
  "document",
  "external",
] as const;

export type WorkCapsuleOutcomeAnchorKind = (typeof WORK_CAPSULE_OUTCOME_ANCHOR_KINDS)[number];

export const WORK_CAPSULE_EXECUTOR_KINDS = [
  "build-studio",
  "codex-desktop",
  "claude-desktop",
  "grok-desktop",
  "antigravity-desktop",
  "human",
  "git-webhook",
  "dpf-native",
] as const;

export type WorkCapsuleExecutorKind = (typeof WORK_CAPSULE_EXECUTOR_KINDS)[number];

export const WORK_CAPSULE_ACTIVITY_KINDS = [
  "created",
  "adopted",
  "workspace-planned",
  "status-changed",
  "status-override",
  "executor-changed",
  "scope-claimed",
  "scope-released",
  "work-intent-declared",
  "change-impact-planned",
  "evidence-recorded",
  "runtime-target-registered",
  "runtime-target-released",
  "runtime-verification-passed",
  "runtime-verification-failed",
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
  // BI-C41AB195: human-legible agent-session activities (Linear AgentActivity
  // pattern). The Workroom IS the teammate session; these are what the
  // executor is thinking/doing/asking, rolled up onto one item's timeline.
  "thought",
  "action",
  "question",
  "response",
  "error",
] as const;

export type WorkCapsuleActivityKind = (typeof WORK_CAPSULE_ACTIVITY_KINDS)[number];

export const WORK_INTENTS = ["design", "review", "plan", "implementation"] as const;
export type WorkIntent = (typeof WORK_INTENTS)[number];

export type WorkIntentDeclared = {
  schemaVersion: 1;
  intent: WorkIntent;
  policyVersion: string;
  subject: {
    kind: "backlog-item" | "epic" | "feature-build" | "task-run";
    id: string;
  };
};

export type WorkIntentParseResult =
  | ({ ok: true } & WorkIntentDeclared)
  | { ok: false; code: "work-intent-malformed"; error: string };

export function parseWorkIntentDeclared(value: unknown): WorkIntentParseResult {
  if (!value || typeof value !== "object") {
    return { ok: false, code: "work-intent-malformed", error: "Work intent payload must be an object." };
  }
  const payload = value as Record<string, unknown>;
  const subject = payload.subject as Record<string, unknown> | null;
  const validSubjectKinds = new Set(["backlog-item", "epic", "feature-build", "task-run"]);
  if (payload.schemaVersion !== 1
    || typeof payload.intent !== "string" || !WORK_INTENTS.includes(payload.intent as WorkIntent)
    || typeof payload.policyVersion !== "string" || !payload.policyVersion.trim()
    || !subject || typeof subject.id !== "string" || !subject.id.trim()
    || typeof subject.kind !== "string" || !validSubjectKinds.has(subject.kind)) {
    return { ok: false, code: "work-intent-malformed", error: "Work intent payload is incomplete or invalid." };
  }
  return {
    ok: true,
    schemaVersion: 1,
    intent: payload.intent as WorkIntent,
    policyVersion: payload.policyVersion,
    subject: { kind: subject.kind as WorkIntentDeclared["subject"]["kind"], id: subject.id },
  };
}

export function projectLatestWorkIntent(rows: Array<{
  id: string;
  recordedAt: Date;
  payload: unknown;
}>): (WorkIntentParseResult & { activityId?: string }) {
  const latest = [...rows].sort((left, right) => {
    const byTime = right.recordedAt.getTime() - left.recordedAt.getTime();
    return byTime || right.id.localeCompare(left.id);
  })[0];
  if (!latest) {
    return { ok: false, code: "work-intent-malformed", error: "No work intent has been declared." };
  }
  const parsed = parseWorkIntentDeclared(latest.payload);
  return parsed.ok ? { ...parsed, activityId: latest.id } : parsed;
}

/**
 * The subset of activity kinds an executor emits as a human-legible session
 * feed (thought / action / question / response / error) — as distinct from the
 * lifecycle/plumbing kinds above (created, lease-renewed, executor-changed…).
 */
export const AGENT_ACTIVITY_KINDS = [
  "thought",
  "action",
  "question",
  "response",
  "error",
] as const;

export type AgentActivityKind = (typeof AGENT_ACTIVITY_KINDS)[number];

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

// WS9 (BI-CBAAEA94): how long a NON-lease-backed capsule (e.g. a Build Studio
// capsule, whose leaseExpiresAt is null by construction) may sit with no fresh
// liveness signal — no open PR, no live linked build, no recent sync — before it
// is treated as idle/stale rather than "working". This is the liveness floor for
// the surface a null lease cannot cover; lease-backed capsules use their exact
// leaseExpiresAt, not this. Deliberately generous (6h) so a genuinely-long build
// phase is never mistaken for abandonment. Override with WORK_CAPSULE_IDLE_MS.
export const WORK_CAPSULE_IDLE_STALE_MS =
  Number(process.env.WORK_CAPSULE_IDLE_MS) || 6 * 60 * 60 * 1000;

export const RELEASE_WORKTREE_DEFAULTS = {
  win32: "D:\\DPF",
  darwin: "{home}/dpf",
  linux: "{home}/dpf",
} as const;

export type ScopeClaim = {
  kind: "path" | "module" | "package" | "route" | "skill" | "prompt";
  value: string;
  intent: "edit" | "read";
  recordedAt: string;
  recordedByPrincipalId: string;
};

const STATUS_SET = new Set<string>(WORK_CAPSULE_STATUSES);
const SOURCE_SET = new Set<string>(WORK_CAPSULE_SOURCES);
const DECISION_SCOPE_SET = new Set<string>(WORK_CAPSULE_DECISION_SCOPES);
const PORTFOLIO_ROLE_SET = new Set<string>(WORK_CAPSULE_PORTFOLIO_ROLES);
const SCOPE_ACTIVITY_KIND_SET = new Set<string>(WORK_CAPSULE_SCOPE_ACTIVITY_KINDS);
const OUTCOME_ANCHOR_KIND_SET = new Set<string>(WORK_CAPSULE_OUTCOME_ANCHOR_KINDS);
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

export function isWorkCapsuleDecisionScope(value: unknown): value is WorkCapsuleDecisionScope {
  return typeof value === "string" && DECISION_SCOPE_SET.has(value);
}

export function isWorkCapsulePortfolioRole(value: unknown): value is WorkCapsulePortfolioRole {
  return typeof value === "string" && PORTFOLIO_ROLE_SET.has(value);
}

export function isWorkCapsuleScopeActivityKind(value: unknown): value is WorkCapsuleScopeActivityKind {
  return typeof value === "string" && SCOPE_ACTIVITY_KIND_SET.has(value);
}

export function isWorkCapsuleOutcomeAnchorKind(value: unknown): value is WorkCapsuleOutcomeAnchorKind {
  return typeof value === "string" && OUTCOME_ANCHOR_KIND_SET.has(value);
}

export function isWorkCapsuleExecutorKind(value: unknown): value is WorkCapsuleExecutorKind {
  return typeof value === "string" && EXECUTOR_SET.has(value);
}

export function isWorkCapsuleActivityKind(value: unknown): value is WorkCapsuleActivityKind {
  return typeof value === "string" && ACTIVITY_SET.has(value);
}

const AGENT_ACTIVITY_SET = new Set<string>(AGENT_ACTIVITY_KINDS);

export function isAgentActivityKind(value: unknown): value is AgentActivityKind {
  return typeof value === "string" && AGENT_ACTIVITY_SET.has(value);
}

export function isWorkCapsuleBranchTaxonomy(value: unknown): value is WorkCapsuleBranchTaxonomy {
  return typeof value === "string" && TAXONOMY_SET.has(value);
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

const MAX_SLUG_LENGTH = 48;

export function buildCapsuleSlug(title: string, capsuleIdFallback?: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  if (slug.length > 0) return slug;
  if (!capsuleIdFallback) return "capsule";
  return slugify(capsuleIdFallback) || "capsule";
}

export function buildCapsuleBranchName(args: {
  taxonomy: WorkCapsuleBranchTaxonomy;
  slug: string;
}): string {
  if (!TAXONOMY_SET.has(args.taxonomy)) {
    throw new Error(`Invalid branch taxonomy: ${args.taxonomy}`);
  }
  return `${args.taxonomy}/${args.slug}`;
}

function resolveHome(explicit: string | undefined): string {
  return explicit ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
}

export function buildCapsuleWorktreePath(args: {
  os: NodeJS.Platform;
  slug: string;
  home?: string;
}): string {
  if (args.os === "win32") return `D:\\DPF-${args.slug}`;
  const home = resolveHome(args.home).replace(/[\\/]+$/g, "");
  return `${home}/dpf-worktrees/${args.slug}`;
}

function normalizeComparablePath(value: string, os: NodeJS.Platform): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+$/g, "");
  return os === "win32" ? normalized.toLowerCase() : normalized;
}

function releaseWorktreePath(os: NodeJS.Platform, home?: string, override?: string): string {
  if (override?.trim()) return override.trim();
  if (os === "win32") return RELEASE_WORKTREE_DEFAULTS.win32;
  const template = os === "darwin" ? RELEASE_WORKTREE_DEFAULTS.darwin : RELEASE_WORKTREE_DEFAULTS.linux;
  return template.replace("{home}", resolveHome(home).replace(/[\\/]+$/g, ""));
}

export function isRootClonePath(
  candidatePath: string,
  os: NodeJS.Platform,
  home?: string,
  releasePathOverride?: string,
): boolean {
  return (
    normalizeComparablePath(candidatePath, os) ===
    normalizeComparablePath(releaseWorktreePath(os, home, releasePathOverride), os)
  );
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

export type WorkCapsuleOutcomeAnchor = {
  kind: WorkCapsuleOutcomeAnchorKind;
  id?: string;
  label?: string;
  url?: string;
  source?: string;
};

export type WorkCapsuleScopeInput = {
  decisionScope?: unknown;
  /** EP-WORK-POSTURE (BI-8C54B216): the collaboration shape the room is convened WITH. */
  workroomShape?: unknown;
  /**
   * BI-A967717A: the standing ACTIVITY shape that drives the room, as
   * `key@version`. Distinct from `workroomShape`, which says who must be in the
   * room for one consequential act; this says what wakes the room, what stages
   * it moves through, and what stops it. Without it a room is inert — the drive
   * runner reads this claim and skips every room that has none.
   */
  workShape?: unknown;
  portfolioRole?: unknown;
  servedPersona?: unknown;
  activityKind?: unknown;
  outcomeAnchor?: unknown;
  servesPortfolioRoles?: unknown;
  dependsOnPortfolioRoles?: unknown;
};

export type NormalizedWorkCapsuleScope = {
  decisionScope: WorkCapsuleDecisionScope | null;
  workroomShape: WorkroomShapeKey | null;
  workShape: string | null;
  portfolioRole: WorkCapsulePortfolioRole | null;
  servedPersona: string | null;
  activityKind: WorkCapsuleScopeActivityKind | null;
  outcomeAnchor: WorkCapsuleOutcomeAnchor | null;
  servesPortfolioRoles: WorkCapsulePortfolioRole[];
  dependsOnPortfolioRoles: WorkCapsulePortfolioRole[];
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDecisionScope(value: unknown): WorkCapsuleDecisionScope | null {
  const trimmed = optionalString(value);
  if (trimmed === null) return null;
  if (!isWorkCapsuleDecisionScope(trimmed)) {
    throw new Error(`Invalid decisionScope: ${trimmed}`);
  }
  return trimmed;
}

function normalizePortfolioRole(value: unknown, key: string): WorkCapsulePortfolioRole | null {
  const trimmed = optionalString(value);
  if (trimmed === null) return null;
  if (!isWorkCapsulePortfolioRole(trimmed)) {
    throw new Error(`Invalid ${key}: ${trimmed}`);
  }
  return trimmed;
}

function normalizeScopeActivityKind(value: unknown): WorkCapsuleScopeActivityKind | null {
  const trimmed = optionalString(value);
  if (trimmed === null) return null;
  if (!isWorkCapsuleScopeActivityKind(trimmed)) {
    throw new Error(`Invalid activityKind: ${trimmed}`);
  }
  return trimmed;
}

function normalizePortfolioRoleArray(value: unknown, key: string): WorkCapsulePortfolioRole[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid ${key}: expected array`);
  return value.map((entry) => {
    const role = normalizePortfolioRole(entry, key);
    if (role === null) throw new Error(`Invalid ${key}: empty role`);
    return role;
  });
}

function normalizeOutcomeAnchor(value: unknown): WorkCapsuleOutcomeAnchor | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid outcomeAnchor: expected object");
  }

  const candidate = value as Record<string, unknown>;
  const kind = optionalString(candidate.kind);
  if (!kind || !isWorkCapsuleOutcomeAnchorKind(kind)) {
    throw new Error(`Invalid outcomeAnchor.kind: ${kind ?? ""}`);
  }

  const anchor: WorkCapsuleOutcomeAnchor = { kind };
  const id = optionalString(candidate.id);
  const label = optionalString(candidate.label);
  const url = optionalString(candidate.url);
  const source = optionalString(candidate.source);
  if (id) anchor.id = id;
  if (label) anchor.label = label;
  if (url) anchor.url = url;
  if (source) anchor.source = source;
  return anchor;
}

/**
 * EP-WORK-POSTURE (BI-8C54B216). The collaboration-shape keys, mirrored from
 * WORKROOM_SHAPE_KEYS in lib/work-management/room-shapes.ts. Mirrored rather
 * than imported because work-capsules is the lower layer; a conformance test
 * asserts the two lists cannot drift apart.
 */
export const WORK_CAPSULE_WORKROOM_SHAPES = [
  "specialist-alignment",
  "approval-sign-off",
  "outward-review",
  "change-consequential",
  "escalation",
  "craft-stewardship",
] as const;
export type WorkroomShapeKey = (typeof WORK_CAPSULE_WORKROOM_SHAPES)[number];

export function isWorkroomShapeKey(value: unknown): value is WorkroomShapeKey {
  return typeof value === "string"
    && (WORK_CAPSULE_WORKROOM_SHAPES as readonly string[]).includes(value);
}

function normalizeWorkroomShape(value: unknown): WorkroomShapeKey | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isWorkroomShapeKey(value)) {
    throw new Error(
      `workroomShape must be one of: ${WORK_CAPSULE_WORKROOM_SHAPES.join(", ")}.`,
    );
  }
  return value;
}

const WORK_SHAPE_REF_PATTERN = /^[^@\s]+@\d+\.\d+\.\d+$/;

/**
 * `key@version`, validated for shape only. The registry lookup happens where the
 * drive resolves, so this module stays free of a runtime dependency on the shape
 * registry — but a malformed ref is refused here rather than persisted as a
 * claim that silently never matches a shape.
 */
function normalizeWorkShapeRef(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = optionalString(value);
  if (trimmed === null || !WORK_SHAPE_REF_PATTERN.test(trimmed)) {
    throw new Error(
      "workShape must be a declared shape reference of the form key@version, for example dependency-advisory-watch@1.0.0.",
    );
  }
  return trimmed;
}

/**
 * The `scopeClaims` entries a room is convened WITH. Both shapes ride this one
 * JSON column rather than a column each — no migration, and existing readers
 * strictly filter entries they do not recognize, so an unknown claim is inert
 * rather than breaking them.
 *
 * `workroomShape` says who must be in the room for one consequential act;
 * `workShape` says what wakes the room at all. Composed here, beside the
 * normalizer that validates them, rather than inline at the write site.
 */
export function buildWorkCapsuleScopeClaims(
  scope: Pick<NormalizedWorkCapsuleScope, "workroomShape" | "workShape">,
  now: Date,
): Array<Record<string, string>> {
  const recordedAt = now.toISOString();
  const claims: Array<Record<string, string>> = [];
  if (scope.workroomShape) claims.push({ workroomShape: scope.workroomShape, recordedAt });
  if (scope.workShape) claims.push({ workShape: scope.workShape, recordedAt });
  return claims;
}

export function normalizeWorkCapsuleScopeInput(input?: WorkCapsuleScopeInput | null): NormalizedWorkCapsuleScope {
  return {
    decisionScope: normalizeDecisionScope(input?.decisionScope),
    workroomShape: normalizeWorkroomShape(input?.workroomShape),
    workShape: normalizeWorkShapeRef(input?.workShape),
    portfolioRole: normalizePortfolioRole(input?.portfolioRole, "portfolioRole"),
    servedPersona: optionalString(input?.servedPersona),
    activityKind: normalizeScopeActivityKind(input?.activityKind),
    outcomeAnchor: normalizeOutcomeAnchor(input?.outcomeAnchor),
    servesPortfolioRoles: normalizePortfolioRoleArray(input?.servesPortfolioRoles, "servesPortfolioRoles"),
    dependsOnPortfolioRoles: normalizePortfolioRoleArray(input?.dependsOnPortfolioRoles, "dependsOnPortfolioRoles"),
  };
}
