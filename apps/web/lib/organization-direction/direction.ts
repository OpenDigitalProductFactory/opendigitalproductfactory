// The instance's direction: mission, vision and top-level outcomes
// (BI-916216E7, EP-OUTCOME-HIERARCHY; spec
// docs/superpowers/specs/2026-10-28-instance-direction-design.md, WWMD
// DI-5C99BCBB0AF4).
//
// The top of the outcome hierarchy. The owner writes it. Agents read it and
// never write it, and nothing here fills a field the owner left empty. Every
// save appends an InstanceDirectionRevision snapshot so decisions can cite the
// version they read (direction@vN). Outcomes are retired, never deleted,
// because epics will point at the outcome they serve (BI-7CD178F8).

import { err, ok, type ActionResult } from "@/lib/shared/action-result";
import { DIRECTION_LIMITS, MAX_INSTANCE_OUTCOMES } from "./direction-vocabulary";

export { DIRECTION_LIMITS, MAX_INSTANCE_OUTCOMES };

/** The stable semantic id an instance outcome carries (IO-XXXXXXXX). */
export function newInstanceOutcomeId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return `IO-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}


export type DirectionOutcome = { id: string | null; statement: string; measure: string | null };
export type DirectionInput = { mission: string; vision: string; outcomes: DirectionOutcome[] };
export type DirectionSource = "settings" | "setup";

export type OrganizationDirection = {
  mission: string | null;
  vision: string | null;
  outcomes: Array<{ id: string; statement: string; measure: string | null }>;
  /** The latest revision number, or null when the owner never saved one. */
  version: number | null;
};

export type DirectionGap = "mission" | "vision" | "outcomes";

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** Validate and normalise an owner's direction payload. Pure. */
export function sanitizeDirectionInput(raw: unknown): ActionResult<DirectionInput> {
  if (!raw || typeof raw !== "object") return err("Nothing to save.");
  const input = raw as Record<string, unknown>;
  const mission = text(input.mission);
  const vision = text(input.vision);
  if (mission.length > DIRECTION_LIMITS.mission) {
    return err(`Keep the mission under ${DIRECTION_LIMITS.mission} characters.`);
  }
  if (vision.length > DIRECTION_LIMITS.vision) {
    return err(`Keep the vision under ${DIRECTION_LIMITS.vision} characters.`);
  }

  const rows = Array.isArray(input.outcomes) ? input.outcomes : [];
  const outcomes: DirectionOutcome[] = [];
  for (const row of rows) {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const statement = text(r.statement);
    const measure = text(r.measure);
    if (!statement && !measure) continue;
    if (!statement) return err("Each outcome needs a statement before its measure.");
    if (statement.length > DIRECTION_LIMITS.statement) {
      return err(`Keep each outcome under ${DIRECTION_LIMITS.statement} characters.`);
    }
    if (measure.length > DIRECTION_LIMITS.measure) {
      return err(`Keep each "how we'll know" under ${DIRECTION_LIMITS.measure} characters.`);
    }
    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
    outcomes.push({ id, statement, measure: measure || null });
  }
  if (outcomes.length > MAX_INSTANCE_OUTCOMES) {
    return err("Keep it to five outcomes or fewer, so each one stays a real priority.");
  }
  return ok({ mission, vision, outcomes });
}

/** Which parts of the direction are still missing. Pure. */
export function directionGaps(state: {
  mission: string | null | undefined;
  vision: string | null | undefined;
  outcomeCount: number;
}): DirectionGap[] {
  const gaps: DirectionGap[] = [];
  if (!text(state.mission)) gaps.push("mission");
  if (!text(state.vision)) gaps.push("vision");
  if (state.outcomeCount === 0) gaps.push("outcomes");
  return gaps;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- structural clients: the real PrismaClient and test fakes */
type DirectionTx = {
  businessContext: { upsert: (args: any) => Promise<unknown> };
  instanceOutcome: {
    findMany: (args: any) => Promise<Array<{ id: string }>>;
    updateMany: (args: any) => Promise<unknown>;
    update: (args: any) => Promise<unknown>;
    create: (args: any) => Promise<{ id: string }>;
  };
  instanceDirectionRevision: {
    findFirst: (args: any) => Promise<{ version: number } | null>;
    create: (args: any) => Promise<unknown>;
  };
};
export type DirectionWriteClient = { $transaction: <T>(fn: (tx: DirectionTx) => Promise<T>) => Promise<T> };
export type DirectionReadClient = {
  businessContext: { findUnique: (args: any) => Promise<{ mission?: string | null; vision?: string | null } | null> };
  instanceOutcome: {
    findMany: (args: any) => Promise<Array<{ id: string; statement: string; measure: string | null }>>;
  };
  instanceDirectionRevision: { findFirst: (args: any) => Promise<{ version: number } | null> };
};
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Persist the owner's direction in one transaction: the mission and vision on
 * BusinessContext, the outcome rows (kept rows updated, removed rows retired,
 * new rows created), and the next revision snapshot. Returns the new version.
 */
export async function saveOrganizationDirection(
  db: DirectionWriteClient,
  input: {
    organizationId: string;
    direction: DirectionInput;
    changedByUserId: string | null;
    source: DirectionSource;
    now?: Date;
    /** Test seam for the semantic id. */
    mintId?: () => string;
  },
): Promise<{ version: number }> {
  const { organizationId, direction } = input;
  const now = input.now ?? new Date();
  const mission = direction.mission || null;
  const vision = direction.vision || null;

  return db.$transaction(async (tx) => {
    await tx.businessContext.upsert({
      where: { organizationId },
      create: { organizationId, mission, vision },
      update: { mission, vision },
    });

    const active = await tx.instanceOutcome.findMany({
      where: { organizationId, lifecycle: "active" },
      select: { id: true },
    });
    const activeIds = new Set(active.map((row) => row.id));
    const keptIds = new Set(
      direction.outcomes.map((o) => o.id).filter((id): id is string => id !== null && activeIds.has(id)),
    );
    const retiredIds = [...activeIds].filter((id) => !keptIds.has(id));
    if (retiredIds.length > 0) {
      await tx.instanceOutcome.updateMany({
        where: { organizationId, id: { in: retiredIds }, lifecycle: "active" },
        data: { lifecycle: "retired", lifecycleAt: now },
      });
    }

    const snapshot: Array<{ id: string; statement: string; measure: string | null }> = [];
    for (const [ordinal, outcome] of direction.outcomes.entries()) {
      const fields = { statement: outcome.statement, measure: outcome.measure, ordinal };
      if (outcome.id && keptIds.has(outcome.id)) {
        await tx.instanceOutcome.update({ where: { id: outcome.id }, data: fields });
        snapshot.push({ id: outcome.id, statement: outcome.statement, measure: outcome.measure });
      } else {
        const created = await tx.instanceOutcome.create({
          data: { id: (input.mintId ?? newInstanceOutcomeId)(), organizationId, lifecycle: "active", ...fields },
        });
        snapshot.push({ id: created.id, statement: outcome.statement, measure: outcome.measure });
      }
    }

    const last = await tx.instanceDirectionRevision.findFirst({
      where: { organizationId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;
    await tx.instanceDirectionRevision.create({
      data: {
        organizationId,
        version,
        mission,
        vision,
        outcomes: snapshot,
        changedByUserId: input.changedByUserId,
        source: input.source,
      },
    });
    return { version };
  });
}

/** Read the current direction. Empty fields stay empty. */
export async function loadOrganizationDirection(
  db: DirectionReadClient,
  organizationId: string,
): Promise<OrganizationDirection> {
  const [bc, outcomes, latest] = await Promise.all([
    db.businessContext.findUnique({ where: { organizationId }, select: { mission: true, vision: true } }),
    db.instanceOutcome.findMany({
      where: { organizationId, lifecycle: "active" },
      orderBy: [{ ordinal: "asc" }, { createdAt: "asc" }],
      take: MAX_INSTANCE_OUTCOMES,
      select: { id: true, statement: true, measure: true },
    }),
    db.instanceDirectionRevision.findFirst({
      where: { organizationId },
      orderBy: { version: "desc" },
      select: { version: true },
    }),
  ]);
  return {
    mission: text(bc?.mission) || null,
    vision: text(bc?.vision) || null,
    outcomes,
    version: latest?.version ?? null,
  };
}

/**
 * Stable evidence refs a decision ledger records for the direction it read,
 * e.g. direction:outcome:<id>@v3. A mission captured before the first direction
 * save cites @v0.
 */
export function directionEvidence(direction: OrganizationDirection): Array<{ ref: string; text: string }> {
  const v = `@v${direction.version ?? 0}`;
  const evidence: Array<{ ref: string; text: string }> = [];
  if (direction.mission) evidence.push({ ref: `direction:mission${v}`, text: `Mission: ${direction.mission}` });
  if (direction.vision) evidence.push({ ref: `direction:vision${v}`, text: `Vision: ${direction.vision}` });
  for (const o of direction.outcomes) {
    evidence.push({
      ref: `direction:outcome:${o.id}${v}`,
      text: `Outcome: ${o.statement}${o.measure ? ` (how we'll know: ${o.measure})` : ""}`,
    });
  }
  return evidence;
}

/**
 * What a decision ledger records about the direction it read. When nothing is
 * recorded it says so, and never stands in a default.
 */
export function directionLedgerFields(direction: OrganizationDirection | null): {
  instanceDirection: { recorded: boolean; version: number | null; refs: string[]; missing: DirectionGap[] };
} {
  if (!direction) {
    return { instanceDirection: { recorded: false, version: null, refs: [], missing: ["mission", "vision", "outcomes"] } };
  }
  const refs = directionEvidence(direction).map((e) => e.ref);
  return {
    instanceDirection: {
      recorded: refs.length > 0,
      version: direction.version,
      refs,
      missing: directionGaps({ ...direction, outcomeCount: direction.outcomes.length }),
    },
  };
}
