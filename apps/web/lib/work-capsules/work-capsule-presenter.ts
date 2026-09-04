import { STALE_CACHE_MS } from "@/lib/work-capsules";
import { classifyWorkCapsuleLiveness } from "./liveness";

type CapsuleRowInput = {
  capsuleId: string;
  title: string;
  status: string;
  source: string;
  executorKind: string | null;
  decisionScope?: string | null;
  portfolioRole?: string | null;
  servedPersona?: string | null;
  activityKind?: string | null;
  outcomeAnchor?: unknown;
  servesPortfolioRoles?: unknown;
  dependsOnPortfolioRoles?: unknown;
  headBranch: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  pullRequestNumber?: number | null;
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
  // WS9 (BI-CBAAEA94): the linked Build Studio build snapshot, when loaded, so a
  // null-lease capsule's liveness reads from real build progress instead of its
  // frozen-at-14:00 updatedAt. Optional — absent falls back to lease/sync/idle.
  featureBuild?: { phase: string | null; lastActivityAt: Date | null } | null;
};

export type PresentedCapsuleRow = ReturnType<typeof presentCapsuleRow>;

const DECISION_SCOPE_LABELS: Record<string, string> = {
  wwmd: "WWMD",
  wwwd: "WWWD",
  wsid: "WSID",
};

export const PORTFOLIO_ROLE_LABELS: Record<string, string> = {
  foundational: "Foundational",
  manufactureAndDeliver: "Manufacture & Deliver",
  forEmployees: "Workforce",
  productsAndServicesSold: "Goods and Services for Sale",
};

export function portfolioRoleLabel(value: string | null | undefined): string {
  return labelOf(value, PORTFOLIO_ROLE_LABELS) ?? "Unassigned";
}

const ACTIVITY_KIND_LABELS: Record<string, string> = {
  delivery: "Delivery",
  support: "Support",
  improvement: "Improvement",
  governance: "Governance",
  "launch-readiness": "Launch Readiness",
  "craft-judgment": "Craft Judgment",
  lifecycle: "Lifecycle",
  remediation: "Remediation",
};

function labelOf(value: string | null | undefined, labels: Record<string, string>): string | null {
  if (!value) return null;
  return labels[value] ?? value;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function outcomeAnchorLabel(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.label === "string" && candidate.label.trim()) return candidate.label.trim();
  if (typeof candidate.id === "string" && candidate.id.trim()) return candidate.id.trim();
  if (typeof candidate.kind === "string" && candidate.kind.trim()) return labelOf(candidate.kind.trim(), ACTIVITY_KIND_LABELS);
  return null;
}

type PreclassifiedLiveness = ReturnType<typeof classifyWorkCapsuleLiveness>;

export function presentCapsuleRow(
  row: CapsuleRowInput,
  now = new Date(),
  preclassified?: PreclassifiedLiveness,
) {
  // WS9: liveness is derived from lease / linked-build / sync — NOT updatedAt,
  // which the 14:00 governed-backlog tee-up freezes at capsule birth. The
  // classifier is the single source of truth shared with the tool and reaper.
  const verdict = preclassified ?? classifyWorkCapsuleLiveness(row, now);
  // Stale scanner cache is an orthogonal, still-useful nuance: the lease is live
  // but the cached worktree data is old. Only surfaced when the capsule is not
  // already dead by a stronger signal.
  const staleCache = row.lastSyncedAt != null && now.getTime() - row.lastSyncedAt.getTime() > STALE_CACHE_MS;

  const health =
    verdict.liveness === "delivered"
      ? "delivered"
      : verdict.liveness === "paused"
        ? "paused"
        : verdict.liveness === "lease-expired"
          ? "lease-expired"
          : verdict.liveness === "build-terminal"
            ? "abandoned-build"
            : verdict.liveness === "idle-stale"
              ? "stalled"
              : staleCache
                ? "stale-cache"
                : "ok";

  return {
    capsuleId: row.capsuleId,
    title: row.title,
    status: row.status,
    source: row.source,
    executorKind: row.executorKind ?? "unassigned",
    branch: row.headBranch ?? "no branch",
    scope: {
      decisionScope: row.decisionScope ?? null,
      decisionScopeLabel: labelOf(row.decisionScope, DECISION_SCOPE_LABELS),
      portfolioRole: row.portfolioRole ?? null,
      portfolioRoleLabel: labelOf(row.portfolioRole, PORTFOLIO_ROLE_LABELS),
      servedPersona: row.servedPersona ?? null,
      activityKind: row.activityKind ?? null,
      activityKindLabel: labelOf(row.activityKind, ACTIVITY_KIND_LABELS),
      outcomeAnchorLabel: outcomeAnchorLabel(row.outcomeAnchor),
      servesPortfolioRoleLabels: stringArray(row.servesPortfolioRoles).map((role) => labelOf(role, PORTFOLIO_ROLE_LABELS) ?? role),
      dependsOnPortfolioRoleLabels: stringArray(row.dependsOnPortfolioRoles).map((role) => labelOf(role, PORTFOLIO_ROLE_LABELS) ?? role),
    },
    worktreePath: row.worktreePath,
    pullRequestUrl: row.pullRequestUrl,
    health,
    // WS9 true-liveness surface: `liveness`/`isLive`/`livenessReason` say whether
    // the work is actually alive, and `trueLivenessAt` is the timestamp that
    // proves it (lease expiry / build activity / sync) — never the frozen
    // updatedAt. `updatedAt` is retained for continuity but is not a liveness
    // signal.
    liveness: verdict.liveness,
    isLive: verdict.isLive,
    livenessReason: verdict.reason,
    trueLivenessAt: verdict.trueLivenessAt ? verdict.trueLivenessAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}
