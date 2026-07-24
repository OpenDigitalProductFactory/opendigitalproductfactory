/**
 * Shared writer for `PortfolioQualityIssue` rows.
 *
 * Several Discovery -> Portfolio surfaces (promotion runner, classifier,
 * enricher, freshness aging, completeness gates) all need to record the same
 * shape of quality issue against an inventory entity, taxonomy node, portfolio,
 * digital product, or relationship. Without a single writer each surface
 * invents its own `issueKey`, severity defaults, and resolve semantics.
 *
 * This module owns:
 *   - the canonical `QualityIssueType` union (the seven kinds we recognize),
 *   - `computeIssueKey` — deterministic key based on issueType + primary scope,
 *   - `openOrUpdateQualityIssue` — the upsert that opens/refreshes/resolves.
 *
 * The DB shape is intentionally loose (`QualityIssueDb`) so callers can pass
 * the real Prisma client OR a narrow handle in tests without dragging the
 * full generated client type into this file.
 */

// The canonical type set is DERIVED from the lifecycle registry
// (./quality-issue-registry), so a detector cannot emit a type that has no
// declared way to close. This list previously named 8 types while the live
// database held 10 — 8 of them undeclared — because the validation below is
// bypassed by direct prisma.portfolioQualityIssue.upsert calls elsewhere.
// Re-exported here to keep the historical import surface stable.
import {
  QUALITY_ISSUE_TYPES,
  QUALITY_ISSUE_REGISTRY,
  isKnownQualityIssueType,
  qualityIssueContract,
  type QualityIssueType,
  type QualityIssueContract,
} from "./quality-issue-registry";

export {
  QUALITY_ISSUE_TYPES,
  QUALITY_ISSUE_REGISTRY,
  isKnownQualityIssueType,
  qualityIssueContract,
  type QualityIssueType,
  type QualityIssueContract,
};

export type QualityIssueSeverity = "info" | "warn" | "error";

export interface QualityIssueScope {
  inventoryEntityId?: string;
  inventoryRelationshipId?: string;
  portfolioId?: string;
  taxonomyNodeId?: string;
  digitalProductId?: string;
}

export interface OpenOrUpdateQualityIssueArgs {
  db: QualityIssueDb;
  issueType: QualityIssueType;
  scope: QualityIssueScope;
  severity?: QualityIssueSeverity;
  summary: string;
  details?: Record<string, unknown>;
  /** "open" (default) re-detects/refreshes; "resolve" flips status to resolved. */
  status?: "open" | "resolve";
}

export interface QualityIssueDb {
  portfolioQualityIssue: {
    upsert(args: {
      where: { issueKey: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; issueKey: true; status: true };
    }): Promise<{ id: string; issueKey: string; status: string }>;
  };
}

/**
 * Priority order for selecting the "primary scope" key. The first non-empty
 * field wins. Order is deliberately narrowest-first: an inventoryEntityId
 * pins the issue to a specific discovered row, while portfolioId is broad.
 */
const SCOPE_PRIORITY: ReadonlyArray<keyof QualityIssueScope> = [
  "inventoryEntityId",
  "digitalProductId",
  "taxonomyNodeId",
  "portfolioId",
  "inventoryRelationshipId",
];

function pickPrimaryScope(scope: QualityIssueScope): {
  key: keyof QualityIssueScope;
  id: string;
} {
  for (const key of SCOPE_PRIORITY) {
    const id = scope[key];
    if (typeof id === "string" && id.length > 0) {
      return { key, id };
    }
  }
  throw new Error("scope must include at least one FK");
}

export function computeIssueKey(
  issueType: QualityIssueType,
  scope: QualityIssueScope,
): string {
  const { key, id } = pickPrimaryScope(scope);
  return `${issueType}:${key}:${id}`;
}

const isKnownIssueType = isKnownQualityIssueType;

/**
 * Upsert a `PortfolioQualityIssue` keyed deterministically by
 * `(issueType, primary scope FK)`.
 *
 * Behavior by `status` arg:
 * - `"open"` (default) — create as `status:"open"` if new; if a row already
 *   exists, refresh `lastDetectedAt` plus latest `severity`/`summary`/`details`
 *   but **do NOT change `status`**. This means re-detecting an issue against
 *   a row already marked `resolved` will refresh the detection timestamp /
 *   summary while leaving the row resolved. Callers that want to re-open a
 *   resolved row must do so explicitly (e.g. via direct DB update); this
 *   writer never silently reverses a resolve.
 * - `"resolve"` — set `status:"resolved"` + `resolvedAt:now` on both create
 *   and update paths. Idempotent: resolving an already-resolved row just
 *   refreshes `resolvedAt`.
 *
 * `firstDetectedAt` and the scope FK columns are written on `create` only;
 * the update payload never touches them.
 *
 * Validates `issueType` against `QUALITY_ISSUE_TYPES` BEFORE touching the DB.
 * Validates that `scope` contains at least one FK BEFORE the upsert.
 */
export async function openOrUpdateQualityIssue(
  args: OpenOrUpdateQualityIssueArgs,
): Promise<{ id: string; issueKey: string; status: string }> {
  const {
    db,
    issueType,
    scope,
    severity = "warn",
    summary,
    details,
    status = "open",
  } = args;

  // Validate issueType BEFORE any DB call so unknown values can't leak rows.
  if (!isKnownIssueType(issueType)) {
    throw new Error(`unknown issue type: ${String(issueType)}`);
  }

  // computeIssueKey also validates that scope has at least one FK.
  const issueKey = computeIssueKey(issueType, scope);
  const now = new Date();

  // Build the create payload. Always populate every scope FK that was passed
  // so the row carries the full breadcrumb (a promotion-skip on an entity may
  // also know its portfolio + taxonomy node).
  const createBase: Record<string, unknown> = {
    issueKey,
    issueType,
    severity,
    summary,
    firstDetectedAt: now,
    lastDetectedAt: now,
    inventoryEntityId: scope.inventoryEntityId ?? null,
    inventoryRelationshipId: scope.inventoryRelationshipId ?? null,
    portfolioId: scope.portfolioId ?? null,
    taxonomyNodeId: scope.taxonomyNodeId ?? null,
    digitalProductId: scope.digitalProductId ?? null,
  };
  if (details !== undefined) {
    createBase.details = details;
  }

  // Update path: latest detection wins for severity/summary/details and we
  // always refresh `lastDetectedAt`. We never roll back firstDetectedAt or
  // change scope FKs on update — those are immutable for a given issueKey.
  const updateBase: Record<string, unknown> = {
    lastDetectedAt: now,
    severity,
    summary,
  };
  if (details !== undefined) {
    updateBase.details = details;
  }

  if (status === "resolve") {
    // Resolve path: row may not exist yet (rare — e.g. the surface that
    // would have created it ran while the issue was already gone). Either
    // way the persisted state is the same: status=resolved, resolvedAt=now.
    createBase.status = "resolved";
    createBase.resolvedAt = now;
    updateBase.status = "resolved";
    updateBase.resolvedAt = now;
  } else {
    // Open path: create as open; on update do NOT flip status. Re-detecting
    // an already-resolved issue should not silently re-open it — that's a
    // policy decision callers should make explicitly via status:"open" only
    // for fresh detections, not from a resolve loop.
    createBase.status = "open";
  }

  return db.portfolioQualityIssue.upsert({
    where: { issueKey },
    create: createBase,
    update: updateBase,
    select: { id: true, issueKey: true, status: true },
  });
}
