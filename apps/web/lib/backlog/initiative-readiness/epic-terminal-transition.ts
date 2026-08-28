import { createHash, randomUUID } from "node:crypto";

import { prisma } from "@dpf/db";

import { canonicalJson } from "@/lib/shared/canonical-json";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import { reconcileInitiativeObjectives, type ObjectiveReconciliationActivity } from "./objective-reconciliation";
import { readinessRequirement } from "./readiness-guidance";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalActor,
  type TerminalAuthority,
  type TerminalTransitionDb,
} from "./terminal-transition-repository";
import type { InitiativeReadinessDecision } from "./types";

type EpicAnchor = {
  id: string;
  itemId: string;
  type: string | null;
  source: string | null;
  workType: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  organizationId: string | null;
  epicId: string | null;
  activities: Array<ObjectiveReconciliationActivity & { gateKey: string | null; backlogItemId?: string }>;
};

type TerminalEpic = {
  id: string;
  epicId: string;
  status: string;
  submittedById: string | null;
  originatingBacklogItemId: string | null;
  originatingBacklogItem: EpicAnchor | null;
  items: Array<{ id: string; itemId: string; status: string }>;
};

type EpicTerminalClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  epic: {
    findFirst(args: unknown): Promise<TerminalEpic | null>;
    findUnique(args: unknown): Promise<TerminalEpic | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItem: {
    findFirst(args: unknown): Promise<EpicAnchor | null>;
    findUnique(args: unknown): Promise<EpicAnchor | null>;
  };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

type ProjectReadiness = typeof projectBacklogItemReadiness;
type ReconcileObjectives = typeof reconcileInitiativeObjectives;

function factsDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function classificationRequired(
  epic: Pick<TerminalEpic, "id" | "epicId">,
  expectedStatus: string,
  evaluatedAt: string,
): GovernedTerminalTransitionResult {
  const decision: InitiativeReadinessDecision = {
    decisionId: `IRD-${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`,
    policyVersion: "initiative-readiness.v1",
    subject: { kind: "epic", id: epic.epicId },
    transitionObject: { kind: "epic", id: epic.id, expectedVersion: expectedStatus, targetState: "done" },
    profile: "feature",
    target: "completion",
    verdict: "input-required",
    satisfied: [],
    blockers: [],
    unmet: [readinessRequirement({
      code: "CLASSIFICATION_REQUIRED",
      state: "missing",
      accountableRole: "portfolio-owner",
    })],
    evaluatedAt,
  };
  return { ok: false, code: "CLASSIFICATION_REQUIRED", decision, authorityDecisionId: "unpersisted" };
}

function withEpicFacts(args: {
  decision: InitiativeReadinessDecision;
  epic: TerminalEpic;
  expectedStatus: string;
  childBlockers: Array<{ id: string; itemId: string; status: string }>;
}) {
  const dependencyBlocker = args.childBlockers.length === 0 ? [] : [readinessRequirement({
    code: "DEPENDENCY_UNRESOLVED",
    state: "blocked",
    accountableRole: "delivery-coordinator",
    profile: args.decision.profile,
    evidenceRefs: args.childBlockers.map((item) => item.itemId),
    reasons: [`${args.childBlockers.length} child item(s) are not done: ${args.childBlockers.map((item) => item.itemId).join(", ")}.`],
  })];
  return {
    ...args.decision,
    subject: { kind: "epic" as const, id: args.epic.epicId },
    transitionObject: {
      kind: "epic" as const,
      id: args.epic.id,
      expectedVersion: args.expectedStatus,
      targetState: "done",
    },
    verdict: dependencyBlocker.length > 0 ? "denied" as const : args.decision.verdict,
    blockers: [...dependencyBlocker, ...args.decision.blockers],
  };
}

/**
 * Bind a legacy/unanchored Epic to the one BacklogItem ledger that owns its
 * readiness receipts. Conflicts are refused; an existing identical link is
 * idempotent. The anchor change is itself append-only evidence on that ledger.
 */
export async function convergeEpicReceiptAnchor(args: {
  db?: TerminalTransitionDb;
  epicId: string;
  backlogItemId: string;
  actor: TerminalActor;
}): Promise<{ epicId: string; backlogItemId: string; changed: boolean }> {
  const db = args.db ?? (prisma as unknown as TerminalTransitionDb);
  return db.$transaction(async (genericTx) => {
    const tx = genericTx as unknown as EpicTerminalClient;
    const epic = await tx.epic.findFirst({
      where: { OR: [{ epicId: args.epicId }, { id: args.epicId }] },
      select: { id: true, epicId: true, originatingBacklogItemId: true },
    });
    if (!epic) throw new Error(`Epic ${args.epicId} not found.`);
    const anchor = await tx.backlogItem.findFirst({
      where: { OR: [{ itemId: args.backlogItemId }, { id: args.backlogItemId }] },
      select: { id: true, itemId: true, epicId: true },
    });
    if (!anchor) throw new Error(`Backlog item ${args.backlogItemId} not found.`);
    await tx.$queryRawUnsafe('SELECT "id" FROM "Epic" WHERE "id" = $1 FOR UPDATE', epic.id);
    await tx.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', anchor.id);
    if (epic.originatingBacklogItemId && epic.originatingBacklogItemId !== anchor.id) {
      throw new Error(`Epic ${epic.epicId} already has a different canonical receipt anchor.`);
    }
    if (anchor.epicId && anchor.epicId !== epic.id) {
      throw new Error(`Backlog item ${anchor.itemId} belongs to a different Epic.`);
    }
    const overlap = await tx.epic.findFirst({
      where: { originatingBacklogItemId: anchor.id, id: { not: epic.id } },
      select: { epicId: true },
    });
    if (overlap) throw new Error(`Backlog item ${anchor.itemId} already anchors Epic ${overlap.epicId}.`);
    if (epic.originatingBacklogItemId === anchor.id) {
      return { epicId: epic.epicId, backlogItemId: anchor.itemId, changed: false };
    }
    const updated = await tx.epic.updateMany({
      where: { id: epic.id, originatingBacklogItemId: null },
      data: { originatingBacklogItemId: anchor.id },
    });
    if (updated.count !== 1) throw new Error(`Epic ${epic.epicId} receipt anchor changed concurrently.`);
    await tx.backlogItemActivity.create({ data: {
      backlogItemId: anchor.id,
      kind: "epic_receipt_anchor_change",
      summary: `Linked ${epic.epicId} to canonical receipt anchor ${anchor.itemId}`,
      payload: { schemaVersion: 1, epicId: epic.epicId, fromBacklogItemId: null, toBacklogItemId: anchor.itemId },
      recordedById: args.actor.humanContextRef,
      recordedByAgentId: args.actor.agentContextRef,
    } });
    return { epicId: epic.epicId, backlogItemId: anchor.itemId, changed: true };
  }, { isolationLevel: "Serializable" });
}

export async function completeEpicTransition(args: {
  db?: TerminalTransitionDb;
  epicId: string;
  expectedStatus: string;
  actor: TerminalActor;
  authority: TerminalAuthority;
  additionalData?: Record<string, unknown>;
  evaluatedAt?: string;
  dependencies?: {
    reconcileObjectives?: ReconcileObjectives;
    projectReadiness?: ProjectReadiness;
  };
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as TerminalTransitionDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  let lockedEpic: TerminalEpic | null = null;

  if (args.db) {
    const read = await args.db.$transaction(async (genericTx) => {
      const tx = genericTx as unknown as EpicTerminalClient;
      return tx.epic.findFirst({
        where: { OR: [{ epicId: args.epicId }, { id: args.epicId }] },
        select: { id: true, epicId: true, status: true, originatingBacklogItemId: true },
      });
    }, { isolationLevel: "Serializable" });
    if (!read) throw new Error(`Epic ${args.epicId} not found.`);
    if (!read.originatingBacklogItemId) return classificationRequired(read, args.expectedStatus, evaluatedAt);
  } else {
    const initial = await (prisma as unknown as EpicTerminalClient).epic.findFirst({
      where: { OR: [{ epicId: args.epicId }, { id: args.epicId }] },
      select: { id: true, epicId: true, status: true, originatingBacklogItemId: true },
    });
    if (!initial) throw new Error(`Epic ${args.epicId} not found.`);
    if (!initial.originatingBacklogItemId) return classificationRequired(initial, args.expectedStatus, evaluatedAt);
  }

  return executeGovernedTerminalTransition({
    db,
    actor: args.actor,
    authority: args.authority,
    resolve: async (genericTx) => {
      const tx = genericTx as unknown as EpicTerminalClient;
      const epic = await tx.epic.findFirst({
        where: { OR: [{ epicId: args.epicId }, { id: args.epicId }] },
        select: {
          id: true, epicId: true, status: true, submittedById: true, originatingBacklogItemId: true,
          originatingBacklogItem: { select: {
            id: true, itemId: true, type: true, source: true, workType: true, scopeKind: true,
            archetypeCategories: true, archetypeIds: true, organizationId: true, epicId: true,
            activities: {
              where: { kind: { in: [
                "initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage",
                "initiative_objective_mapping", "evidence",
              ] } },
              orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
              take: 500,
              select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
            },
          } },
          items: { select: { id: true, itemId: true, status: true } },
        },
      });
      if (!epic) throw new Error(`Epic ${args.epicId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "Epic" WHERE "id" = $1 FOR UPDATE', epic.id);
      if (epic.status !== args.expectedStatus) {
        throw new Error(`Epic ${epic.epicId} expected status=${args.expectedStatus}, got ${epic.status}.`);
      }
      if (!epic.originatingBacklogItem) throw new Error(`Epic ${epic.epicId} has no canonical receipt anchor.`);
      await tx.$queryRawUnsafe(
        'SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE',
        epic.originatingBacklogItem.id,
      );
      lockedEpic = epic;
      const anchor = epic.originatingBacklogItem;
      args.authority.organizationId = anchor.organizationId;
      args.authority.authoritySnapshot.organizationId = anchor.organizationId ?? "platform";
      const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
        itemId: anchor.itemId,
        itemRowId: anchor.id,
        activities: anchor.activities,
      });
      const childBlockers = epic.items.filter((item) => !["done", "retired"].includes(item.status));
      const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: anchor,
        activities: anchor.activities as InitiativeReadinessActivity[],
        target: "completion",
        transitionObject: { kind: "epic", id: epic.id, expectedVersion: args.expectedStatus, targetState: "done" },
        authorization: "pass",
        capsuleIdentity: "pass",
        completion: {
          deliveryEvidence: childBlockers.length === 0 ? "pass" : "fail",
          acceptanceEvidence: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveReconciliation: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveBaselineConflict: reconciliation.state === "conflict",
          projectionError: reconciliation.state === "malformed",
          evidenceRefs: {
            DEPENDENCY_UNRESOLVED: childBlockers.map((item) => item.itemId),
            DELIVERY_EVIDENCE_REQUIRED: epic.items.filter((item) => item.status === "done").map((item) => item.itemId),
            ACCEPTANCE_EVIDENCE_REQUIRED: reconciliation.evidenceRefs,
            OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
          },
        },
        evaluatedAt,
      });
      const decision = withEpicFacts({ decision: projected.decision, epic, expectedStatus: args.expectedStatus, childBlockers });
      return {
        governed: true,
        decision,
        anchorBacklogItemId: anchor.id,
        factsDigest: factsDigest({
          epicId: epic.epicId,
          epicRowId: epic.id,
          expectedStatus: args.expectedStatus,
          anchorItemId: anchor.itemId,
          baselineId: reconciliation.baselineId,
          objectiveState: reconciliation.state,
          objectiveEvidenceRefs: reconciliation.evidenceRefs,
          childStatuses: epic.items.map((item) => ({ itemId: item.itemId, status: item.status })),
          evaluatedAt,
        }),
      };
    },
    mutate: async (genericTx) => {
      const tx = genericTx as unknown as EpicTerminalClient;
      if (!lockedEpic) throw new Error("Terminal readiness did not resolve an Epic.");
      return (await tx.epic.updateMany({
        where: { id: lockedEpic.id, status: args.expectedStatus },
        data: { ...args.additionalData, status: "done", completedAt: new Date(evaluatedAt) },
      })).count;
    },
  });
}
