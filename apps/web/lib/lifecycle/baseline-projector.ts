// Baseline Plateau projector — IO applier (EP-LIFECYCLE / slice 3).
// Spec: docs/superpowers/specs/2026-06-07-unified-lifecycle-backbone-design.md §5.
//
// Thin IO layer over the pure planBaselineProjection diff. Resolves (creates on first run)
// the baseline Plateau EaElement, loads existing projected memberships, applies the plan,
// and emits a LifecycleEvent when a thing leaves the current-state estate. Idempotent: a
// no-delta run performs no writes.
//
// Uses a narrow prisma client surface (cast at the call site, like data-model-mirror-apply
// .ts) so this module typechecks without the generated client carrying the new models.

import {
  planBaselineProjection,
  type BaselineMemberInput,
  type BaselinePlanSummary,
  type ExistingMembership,
} from "./baseline-projection";
import { governedThingRefKey } from "../governed-thing-ref";

const NOTATION_SLUG = "archimate4";
const PLATEAU_TYPE_SLUG = "plateau";
/** Stable marker (in EaElement.properties) identifying the system-owned baseline plateau. */
export const BASELINE_PLATEAU_KEY = "current-state-baseline";
export const BASELINE_PLATEAU_NAME = "Current State (Baseline)";

export type BaselineProjectorClient = {
  eaNotation: {
    findUnique(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
  eaElementType: {
    findUnique(args: Record<string, unknown>): Promise<{ id: string } | null>;
  };
  eaElement: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string } | null>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
  plateauMembership: {
    findMany(args: Record<string, unknown>): Promise<ExistingMembership[]>;
    create(args: Record<string, unknown>): Promise<{ id: string }>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
  lifecycleEvent: {
    create(args: Record<string, unknown>): Promise<{ id: string }>;
  };
};

export type BaselineProjectionResult = {
  status: "applied" | "noop";
  plateauElementId: string;
  summary: BaselinePlanSummary;
};

/** Resolve the system-owned baseline Plateau element, creating it on first run. */
export async function resolveBaselinePlateau(prisma: BaselineProjectorClient): Promise<string> {
  const existing = await prisma.eaElement.findFirst({
    where: { properties: { path: ["baselineKey"], equals: BASELINE_PLATEAU_KEY } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const notation = await prisma.eaNotation.findUnique({ where: { slug: NOTATION_SLUG }, select: { id: true } });
  if (!notation) throw new Error(`EA notation '${NOTATION_SLUG}' not found — seed the ArchiMate 4 notation first.`);

  const plateauType = await prisma.eaElementType.findUnique({
    where: { notationId_slug: { notationId: notation.id, slug: PLATEAU_TYPE_SLUG } },
    select: { id: true },
  });
  if (!plateauType) throw new Error(`EA element type '${PLATEAU_TYPE_SLUG}' not found for '${NOTATION_SLUG}'.`);

  const created = await prisma.eaElement.create({
    data: {
      elementTypeId: plateauType.id,
      name: BASELINE_PLATEAU_NAME,
      description: "System-owned current-state plateau, projected from the live discovered estate.",
      lifecycleStage: "production",
      lifecycleStatus: "active",
      refinementLevel: "actual",
      properties: { baselineKey: BASELINE_PLATEAU_KEY, systemOwned: true },
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Reconcile the baseline Plateau membership against the current-state evidence.
 * The caller gathers `evidence` by resolving current-perspective governed things via
 * resolveLifecycle() and supplying each one's corroborating evidenceRef.
 */
export async function reconcileBaselinePlateau(deps: {
  prisma: BaselineProjectorClient;
  evidence: BaselineMemberInput[];
  actorPrincipalId?: string | null;
}): Promise<BaselineProjectionResult> {
  const { prisma, evidence } = deps;
  const plateauElementId = await resolveBaselinePlateau(prisma);

  const existing = await prisma.plateauMembership.findMany({
    where: { plateauElementId, membershipSource: "projected" },
  });

  const plan = planBaselineProjection(evidence, existing);
  if (!plan.material) {
    return { status: "noop", plateauElementId, summary: plan.summary };
  }

  for (const op of plan.ops) {
    if (op.op === "open") {
      await prisma.plateauMembership.create({
        data: {
          plateauElementId,
          governedThingKind: op.member.kind,
          governedThingId: op.member.id,
          membershipSource: "projected",
          stateSnapshot: op.member.stateSnapshot,
          evidenceRef: op.member.evidenceRef,
          validTo: null,
        },
      });
    } else if (op.op === "refresh") {
      await prisma.plateauMembership.update({
        where: { id: op.id },
        data: {
          stateSnapshot: op.member.stateSnapshot,
          evidenceRef: op.member.evidenceRef,
          validTo: null, // clears a prior close on reopen
        },
      });
    } else if (op.op === "close") {
      await prisma.plateauMembership.update({
        where: { id: op.id },
        data: { validTo: new Date() },
      });
      // A thing leaving the current-state estate is a lifecycle transition worth logging.
      await prisma.lifecycleEvent.create({
        data: {
          governedThingKind: op.ref.kind,
          governedThingId: op.ref.id,
          toStatus: "inactive",
          reason: op.reason,
          evidenceRef: `baseline-plateau:${governedThingRefKey(op.ref)}`,
          actorPrincipalId: deps.actorPrincipalId ?? null,
        },
      });
    }
  }

  return { status: "applied", plateauElementId, summary: plan.summary };
}
