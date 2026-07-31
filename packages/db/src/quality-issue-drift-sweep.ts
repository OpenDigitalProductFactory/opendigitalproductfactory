// quality-issue-drift-sweep.ts
//
// The RUNTIME half of quality-issue governance. The registry
// (quality-issue-registry.ts) is the compile-time gate — a detector cannot be
// born without a declared lifecycle. This sweep is what makes that lifecycle
// LIVE on the operator's install:
//
//   1. Auto-resolve (self-heal) — close open issues whose declared auto-resolve
//      condition is now demonstrably true but which discovery-sync's per-source,
//      per-sweep reconcile did not catch: a stale entity/relationship confirmed
//      ACTIVE by a *different* source, or one whose scoped row was deleted. This
//      is the global backstop; the common case is already handled in-sweep.
//
//   2. Drift detection — compare live open counts to each type's declared
//      `expectedSteadyState` budget and return every over-budget queue,
//      worst-first, WITH its owner. This is the runtime analogue of the
//      compile-time gate: a NEW detector that starts accumulating is surfaced
//      automatically instead of found by a human eyeballing a dashboard two
//      months and 2,247 rows later.
//
// This module deliberately does NOT file backlog items or route work. Turning
// drift into funded, routed work (drift -> BI -> weekly token budget -> Build
// Studio / owning coworker) is the auto-processing orchestration owned by the
// holistic estate-management thread (BI-0B420A1D); it consumes the `drift`
// this returns. Keeping the two apart avoids the backlog-flood failure mode a
// self-filing sweep has caused before.

import {
  qualityIssueDrift,
  isKnownQualityIssueType,
  subjectBearingTypes,
  type QualityIssueType,
} from "./quality-issue-registry";
import {
  INVENTORY_ENTITY_CANONICAL_WHERE,
  INVENTORY_RELATIONSHIP_CANONICAL_WHERE,
} from "./inventory-entity-lifecycle";

// Types whose auto-resolve is "observed active again" — the ones the recovery
// backstop can safely close when the scoped row is now active. DERIVED from the
// registry rather than hand-listed, so a new detector that declares
// `raisedBySubjectAbsence: true` is swept without editing this file.
const RECOVERY_RESOLVABLE_TYPES: readonly QualityIssueType[] = [
  ...subjectBearingTypes("entity", true),
  ...subjectBearingTypes("relationship", true),
];

// The DUAL of the above: types raised because a subject is present and needs
// work. These are moot once that subject goes stale or is deleted — nobody can
// verify the support lifecycle of a device that is no longer on the network.
// The recovery backstop never looked in this direction, which is why the live
// queue held 179 open rows pinned to already-stale entities.
const SUBJECT_LOSS_RESOLVABLE_TYPES: readonly QualityIssueType[] = [
  ...subjectBearingTypes("entity", false),
  ...subjectBearingTypes("relationship", false),
];

/** Narrow DB handle — the real Prisma client is a structural superset. */
export interface DriftSweepDb {
  portfolioQualityIssue: {
    groupBy(args: {
      by: ["issueType"];
      where: { status: string };
      _count: { _all: true };
    }): Promise<Array<{ issueType: string; _count: { _all: number } }>>;
    findMany(args: {
      where: Record<string, unknown>;
      select: {
        id: true;
        issueType: true;
        inventoryEntityId: true;
        inventoryRelationshipId: true;
      };
    }): Promise<
      Array<{
        id: string;
        issueType: string;
        inventoryEntityId: string | null;
        inventoryRelationshipId: string | null;
      }>
    >;
    updateMany(args: {
      where: { id: { in: string[] } };
      data: { status: string; resolvedAt: Date };
    }): Promise<{ count: number }>;
  };
  inventoryEntity: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; status: true };
    }): Promise<Array<{ id: string; status: string }>>;
  };
  inventoryRelationship: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; status: true };
    }): Promise<Array<{ id: string; status: string }>>;
  };
}

export interface QualityIssueDriftReport {
  scannedAt: Date;
  /** Open-count per registered issue type after the auto-resolve pass. */
  openByType: Record<string, number>;
  /** How many rows the self-heal backstop closed this run, per type. */
  autoResolved: Record<string, number>;
  /** Over-budget queues, worst overrun first, each tagged with its owner. */
  drift: Array<{
    type: QualityIssueType;
    open: number;
    budget: number;
    over: number;
    owner: string;
  }>;
  /** True when no registered queue is over its declared steady-state budget. */
  healthy: boolean;
}

/**
 * Resolve the recovery/orphan backstop: open stale_entity / stale_relationship
 * rows whose FK-linked entity or relationship is now `active` (recovered) or no
 * longer exists (deleted). Returns per-type counts of what was closed.
 *
 * Pure over the injected db; the caller supplies `now` so the result is
 * deterministic in tests.
 */
async function autoResolveRecovered(
  db: DriftSweepDb,
  now: Date,
): Promise<Record<string, number>> {
  const candidates = await db.portfolioQualityIssue.findMany({
    where: {
      status: "open",
      issueType: { in: RECOVERY_RESOLVABLE_TYPES as unknown as string[] },
      OR: [
        { inventoryEntityId: { not: null } },
        { inventoryRelationshipId: { not: null } },
      ],
    },
    select: {
      id: true,
      issueType: true,
      inventoryEntityId: true,
      inventoryRelationshipId: true,
    },
  });

  if (candidates.length === 0) return {};

  const entityIds = [
    ...new Set(candidates.map((c) => c.inventoryEntityId).filter((v): v is string => !!v)),
  ];
  const relationshipIds = [
    ...new Set(
      candidates.map((c) => c.inventoryRelationshipId).filter((v): v is string => !!v),
    ),
  ];

  const [entities, relationships] = await Promise.all([
    entityIds.length
      ? db.inventoryEntity.findMany({
          where: { ...INVENTORY_ENTITY_CANONICAL_WHERE, id: { in: entityIds } },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
    relationshipIds.length
      ? db.inventoryRelationship.findMany({
          where: {
            ...INVENTORY_RELATIONSHIP_CANONICAL_WHERE,
            id: { in: relationshipIds },
          },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const entityStatus = new Map(entities.map((e) => [e.id, e.status]));
  const relationshipStatus = new Map(relationships.map((r) => [r.id, r.status]));

  // Resolvable when the scoped row is active again, OR when it is gone entirely
  // (deleted → its FK id is absent from the lookup): an issue about a row that
  // no longer exists can never be acted on.
  const resolvableByType: Record<string, string[]> = {};
  for (const c of candidates) {
    const recovered = c.inventoryEntityId
      ? entityStatus.get(c.inventoryEntityId) !== "stale"
      : c.inventoryRelationshipId
        ? relationshipStatus.get(c.inventoryRelationshipId) !== "stale"
        : false;
    if (recovered) {
      (resolvableByType[c.issueType] ??= []).push(c.id);
    }
  }

  const resolved: Record<string, number> = {};
  for (const [type, ids] of Object.entries(resolvableByType)) {
    if (ids.length === 0) continue;
    const { count } = await db.portfolioQualityIssue.updateMany({
      where: { id: { in: ids } },
      data: { status: "resolved", resolvedAt: now },
    });
    resolved[type] = count;
  }
  return resolved;
}

/**
 * Resolve issues whose SUBJECT HAS GONE: open rows of a subject-bearing type
 * whose FK-linked entity/relationship is now `stale` or no longer present.
 *
 * This is the dual of `autoResolveRecovered`. An issue like "still needs
 * identity review for manufacturer" asserts that a live thing needs work; once
 * that thing stops being observed, the assertion is moot and no operator or
 * coworker can ever close it by acting. Leaving these open buries the rows that
 * ARE actionable — 179 of 462 open issues in the live queue were pinned to
 * already-stale entities.
 *
 * Deliberately requires a non-null FK: a row with no subject link (legacy
 * residue) is left alone rather than guessed at from its issueKey.
 *
 * Pure over the injected db; the caller supplies `now` for deterministic tests.
 */
async function autoResolveMootSubjects(
  db: DriftSweepDb,
  now: Date,
): Promise<Record<string, number>> {
  const candidates = await db.portfolioQualityIssue.findMany({
    where: {
      status: "open",
      issueType: { in: SUBJECT_LOSS_RESOLVABLE_TYPES as unknown as string[] },
      OR: [
        { inventoryEntityId: { not: null } },
        { inventoryRelationshipId: { not: null } },
      ],
    },
    select: {
      id: true,
      issueType: true,
      inventoryEntityId: true,
      inventoryRelationshipId: true,
    },
  });

  if (candidates.length === 0) return {};

  const entityIds = [
    ...new Set(candidates.map((c) => c.inventoryEntityId).filter((v): v is string => !!v)),
  ];
  const relationshipIds = [
    ...new Set(
      candidates.map((c) => c.inventoryRelationshipId).filter((v): v is string => !!v),
    ),
  ];

  const [entities, relationships] = await Promise.all([
    entityIds.length
      ? db.inventoryEntity.findMany({
          where: { ...INVENTORY_ENTITY_CANONICAL_WHERE, id: { in: entityIds } },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
    relationshipIds.length
      ? db.inventoryRelationship.findMany({
          where: {
            ...INVENTORY_RELATIONSHIP_CANONICAL_WHERE,
            id: { in: relationshipIds },
          },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const entityStatus = new Map(entities.map((e) => [e.id, e.status]));
  const relationshipStatus = new Map(relationships.map((r) => [r.id, r.status]));

  // Moot when the subject is stale, or absent from the canonical lookup
  // (deleted, or merged away — the surviving row raises its own issues).
  const resolvableByType: Record<string, string[]> = {};
  for (const c of candidates) {
    const subjectGone = c.inventoryEntityId
      ? (entityStatus.get(c.inventoryEntityId) ?? "stale") === "stale"
      : c.inventoryRelationshipId
        ? (relationshipStatus.get(c.inventoryRelationshipId) ?? "stale") === "stale"
        : false;
    if (subjectGone) {
      (resolvableByType[c.issueType] ??= []).push(c.id);
    }
  }

  const resolved: Record<string, number> = {};
  for (const [type, ids] of Object.entries(resolvableByType)) {
    if (ids.length === 0) continue;
    const { count } = await db.portfolioQualityIssue.updateMany({
      where: { id: { in: ids } },
      data: { status: "resolved", resolvedAt: now },
    });
    resolved[type] = count;
  }
  return resolved;
}

/**
 * Run the quality-issue drift sweep: self-heal the backstop in BOTH directions
 * (subject recovered, subject lost), then measure drift against the registry
 * budgets. Pure over the injected db + clock.
 */
export async function runQualityIssueDriftSweep(
  db: DriftSweepDb,
  now: Date = new Date(),
): Promise<QualityIssueDriftReport> {
  const recovered = await autoResolveRecovered(db, now);
  const moot = await autoResolveMootSubjects(db, now);

  const autoResolved: Record<string, number> = { ...recovered };
  for (const [type, count] of Object.entries(moot)) {
    autoResolved[type] = (autoResolved[type] ?? 0) + count;
  }

  const grouped = await db.portfolioQualityIssue.groupBy({
    by: ["issueType"],
    where: { status: "open" },
    _count: { _all: true },
  });

  const openByType: Record<string, number> = {};
  for (const row of grouped) {
    // Only registered types carry a budget; an unregistered type reaching the DB
    // is prevented at compile time, but a legacy row is ignored rather than
    // assigned an invented budget.
    if (isKnownQualityIssueType(row.issueType)) {
      openByType[row.issueType] = row._count._all;
    }
  }

  const drift = qualityIssueDrift(openByType);

  return {
    scannedAt: now,
    openByType,
    autoResolved,
    drift,
    healthy: drift.length === 0,
  };
}
