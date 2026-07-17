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
] as const;

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
  // pattern). The WorkCapsule IS the teammate session; these are what the
  // executor is thinking/doing/asking, rolled up onto one item's timeline.
  "thought",
  "action",
  "question",
  "response",
  "error",
] as const;

export type WorkCapsuleActivityKind = (typeof WORK_CAPSULE_ACTIVITY_KINDS)[number];

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
  portfolioRole?: unknown;
  servedPersona?: unknown;
  activityKind?: unknown;
  outcomeAnchor?: unknown;
  servesPortfolioRoles?: unknown;
  dependsOnPortfolioRoles?: unknown;
};

export type NormalizedWorkCapsuleScope = {
  decisionScope: WorkCapsuleDecisionScope | null;
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

export function normalizeWorkCapsuleScopeInput(input?: WorkCapsuleScopeInput | null): NormalizedWorkCapsuleScope {
  return {
    decisionScope: normalizeDecisionScope(input?.decisionScope),
    portfolioRole: normalizePortfolioRole(input?.portfolioRole, "portfolioRole"),
    servedPersona: optionalString(input?.servedPersona),
    activityKind: normalizeScopeActivityKind(input?.activityKind),
    outcomeAnchor: normalizeOutcomeAnchor(input?.outcomeAnchor),
    servesPortfolioRoles: normalizePortfolioRoleArray(input?.servesPortfolioRoles, "servesPortfolioRoles"),
    dependsOnPortfolioRoles: normalizePortfolioRoleArray(input?.dependsOnPortfolioRoles, "dependsOnPortfolioRoles"),
  };
}
