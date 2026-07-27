import { STALE_CACHE_MS } from "@/lib/work-capsules";

// A capsule that claims to be "working" but has not changed in this long is
// almost certainly stalled (e.g. its build died in ideate). Surface that as a
// degraded health signal instead of a misleading "ok" — Work Control must not
// report a dead capsule as healthy.
const WORKING_STALL_MS = 15 * 60 * 1000;

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
  leaseExpiresAt: Date | null;
  lastSyncedAt: Date | null;
  updatedAt: Date;
};

export type PresentedCapsuleRow = ReturnType<typeof presentCapsuleRow>;

const DECISION_SCOPE_LABELS: Record<string, string> = {
  wwmd: "WWMD",
  wwwd: "WWWD",
  wsid: "WSID",
};

const PORTFOLIO_ROLE_LABELS: Record<string, string> = {
  foundational: "Foundational",
  manufactureAndDeliver: "Manufacture & Deliver",
  forEmployees: "Workforce",
  productsAndServicesSold: "Goods and Services for Sale",
};

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

export function presentCapsuleRow(row: CapsuleRowInput, now = new Date()) {
  const leaseExpired = row.leaseExpiresAt != null && row.leaseExpiresAt.getTime() < now.getTime();
  const staleCache = row.lastSyncedAt != null && now.getTime() - row.lastSyncedAt.getTime() > STALE_CACHE_MS;
  const stalledWorking =
    row.status === "working" && now.getTime() - row.updatedAt.getTime() > WORKING_STALL_MS;

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
    health: leaseExpired
      ? "lease-expired"
      : stalledWorking
        ? "stalled"
        : staleCache
          ? "stale-cache"
          : "ok",
    updatedAt: row.updatedAt.toISOString(),
  };
}
