import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import { STATUS_OVERRIDE_TTL_MS } from "@/lib/work-capsules";
import type { WorkCapsuleActor } from "@/lib/work-capsules/work-capsule-store-types";
import { canonicalJson } from "@/lib/shared/canonical-json";

import {
  persistedTerminalCompletionDecision,
  projectBacklogItemReadiness,
  type InitiativeReadinessActivity,
} from "./entry-adapter";
import { reconcileInitiativeObjectives, type ObjectiveReconciliationActivity } from "./objective-reconciliation";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalTransitionDb,
} from "./terminal-transition-repository";
import { readinessRequirement } from "./readiness-guidance";
import type { InitiativeReadinessDecision } from "./types";

type TerminalCapsule = {
  id: string;
  capsuleId: string;
  status: string;
  backlogItemId: string | null;
  featureBuildId: string | null;
  archivedAt: Date | null;
  executorRef: string | null;
  leaseHolderPrincipalId: string | null;
  workspaceState: unknown;
};

type CapsuleSubject = {
  id: string;
  itemId: string;
  status: string;
  type: string | null;
  source: string | null;
  workType: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  organizationId: string | null;
  activities: Array<ObjectiveReconciliationActivity & { gateKey: string | null; backlogItemId?: string }>;
};

type CapsuleEvidenceActivity = {
  id: string;
  kind: string;
  recordedAt: Date;
  payload: unknown;
};

type CapsuleTerminalClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  workroom: {
    findUnique(args: unknown): Promise<TerminalCapsule | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  workroomActivity: {
    findMany(args: unknown): Promise<CapsuleEvidenceActivity[]>;
    create(args: unknown): Promise<unknown>;
  };
  backlogItem: { findFirst(args: unknown): Promise<CapsuleSubject | null> };
  featureBuild: {
    findUnique(args: unknown): Promise<{ originator: CapsuleSubject | null } | null>;
  };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

type ProjectReadiness = typeof projectBacklogItemReadiness;
type ReconcileObjectives = typeof reconcileInitiativeObjectives;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function factsDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function passedEvidenceIds(activities: CapsuleEvidenceActivity[]): string[] {
  return activities.flatMap((activity) => {
    if (activity.kind !== "evidence-recorded") return [];
    const payload = object(activity.payload);
    const result = object(payload.result);
    const kind = typeof payload.kind === "string" ? payload.kind : "";
    const verdict = typeof result.verdict === "string" ? result.verdict : "";
    return ["verification", "test", "build"].includes(kind) && ["passed", "merged"].includes(verdict)
      ? [activity.id]
      : [];
  });
}

async function resolveSubject(tx: CapsuleTerminalClient, capsule: TerminalCapsule): Promise<CapsuleSubject | null> {
  const select = {
    id: true, itemId: true, status: true, type: true, source: true, workType: true, scopeKind: true,
    archetypeCategories: true, archetypeIds: true, organizationId: true,
    activities: {
      where: { kind: { in: [
        "initiative_gate_receipt", "initiative_scope_baseline", "plan_backlog_coverage",
        "initiative_objective_mapping", "evidence",
      ] } },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: 500,
      select: { id: true, backlogItemId: true, kind: true, gateKey: true, recordedAt: true, payload: true },
    },
  };
  if (capsule.backlogItemId) {
    return tx.backlogItem.findFirst({
      where: { OR: [{ itemId: capsule.backlogItemId }, { id: capsule.backlogItemId }] },
      select,
    });
  }
  if (!capsule.featureBuildId) return null;
  const build = await tx.featureBuild.findUnique({
    where: { id: capsule.featureBuildId },
    select: { originator: { select } },
  });
  return build?.originator ?? null;
}

function capsuleIdentityState(capsule: TerminalCapsule, actor: WorkCapsuleActor) {
  if (capsule.archivedAt) return "fail" as const;
  if (!actor.principalId || capsule.leaseHolderPrincipalId !== actor.principalId) return "fail" as const;
  return "pass" as const;
}

const WORKROOM_LOCAL_REQUIREMENTS = new Set([
  "CAPSULE_IDENTITY_MISMATCH",
  "DELIVERY_EVIDENCE_REQUIRED",
]);

function rebindAllowedItemCompletion(args: {
  persisted: InitiativeReadinessDecision;
  transitionObject: InitiativeReadinessDecision["transitionObject"];
  capsuleId: string;
  deliveryEvidenceRefs: readonly string[];
  evaluatedAt: string;
}): InitiativeReadinessDecision {
  return {
    ...args.persisted,
    decisionId: "unpersisted",
    transitionObject: args.transitionObject,
    evaluatedAt: args.evaluatedAt,
    satisfied: [
      ...args.persisted.satisfied.filter((requirement) => !WORKROOM_LOCAL_REQUIREMENTS.has(requirement.code)),
      readinessRequirement({
        code: "CAPSULE_IDENTITY_MISMATCH",
        state: "pass",
        accountableRole: "delivery-coordinator",
        profile: args.persisted.profile,
        evidenceRefs: [args.capsuleId],
      }),
      readinessRequirement({
        code: "DELIVERY_EVIDENCE_REQUIRED",
        state: "pass",
        accountableRole: "delivery-coordinator",
        profile: args.persisted.profile,
        evidenceRefs: args.deliveryEvidenceRefs,
      }),
    ],
    unmet: [],
    blockers: [],
  };
}

/** Complete a governed Workroom through the shared audited terminal boundary. */
export async function completeWorkCapsuleTransition(args: {
  db?: TerminalTransitionDb;
  capsuleId: string;
  expectedStatus: string;
  reason: string;
  actor: WorkCapsuleActor;
  evaluatedAt?: string;
  dependencies?: {
    reconcileObjectives?: ReconcileObjectives;
    projectReadiness?: ProjectReadiness;
  };
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as TerminalTransitionDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  let lockedCapsule: TerminalCapsule | null = null;
  let nextWorkspaceState: Record<string, unknown> = {};
  const actor = {
    actorType: args.actor.agentId ? "agent" as const : "human" as const,
    actorRef: args.actor.agentId ?? args.actor.userId,
    humanContextRef: args.actor.userId,
    agentContextRef: args.actor.agentId,
  };
  const authority = {
    organizationId: null as string | null,
    actionKey: "complete_work_capsule",
    objectRef: args.capsuleId,
    rationale: { capability: "manage_backlog", grant: "update_work_capsule_status", source: "work-capsule-status" },
    authoritySnapshot: {
      decision: "allow" as const,
      effectiveHumanCapability: "manage_backlog",
      effectiveAgentGrant: "update_work_capsule_status",
      tokenScope: "organization",
      organizationId: "platform",
      actionKey: "complete_work_capsule",
      policyVersion: "coworker-authority.v1",
    },
  };

  return executeGovernedTerminalTransition({
    db,
    actor,
    authority,
    resolve: async (genericTx) => {
      const tx = genericTx as unknown as CapsuleTerminalClient;
      const capsule = await tx.workroom.findUnique({
        where: { capsuleId: args.capsuleId },
        select: {
          id: true, capsuleId: true, status: true, backlogItemId: true, featureBuildId: true,
          archivedAt: true, executorRef: true, leaseHolderPrincipalId: true, workspaceState: true,
        },
      });
      if (!capsule) throw new Error(`Work Capsule ${args.capsuleId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "WorkCapsule" WHERE "id" = $1 FOR UPDATE', capsule.id);
      if (capsule.status !== args.expectedStatus) {
        throw new Error(`Work Capsule ${args.capsuleId} expected status=${args.expectedStatus}, got ${capsule.status}.`);
      }
      lockedCapsule = capsule;
      nextWorkspaceState = {
        ...object(capsule.workspaceState),
        statusOverride: {
          reason: args.reason,
          until: new Date(new Date(evaluatedAt).getTime() + STATUS_OVERRIDE_TTL_MS).toISOString(),
        },
      };
      const subject = await resolveSubject(tx, capsule);
      if (!subject) throw new Error(`Work Capsule ${args.capsuleId} has no canonical backlog receipt anchor.`);
      authority.organizationId = subject.organizationId;
      authority.authoritySnapshot.organizationId = subject.organizationId ?? "platform";
      const evidence = await tx.workroomActivity.findMany({
        where: { workCapsuleId: capsule.id, kind: "evidence-recorded" },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        take: 200,
        select: { id: true, kind: true, recordedAt: true, payload: true },
      });
      const deliveryEvidenceRefs = passedEvidenceIds(evidence);
      const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
        itemId: subject.itemId,
        itemRowId: subject.id,
        activities: subject.activities,
      });
      const identity = capsuleIdentityState(capsule, args.actor);
      const transitionObject = {
        kind: "work-capsule" as const, id: capsule.id, expectedVersion: args.expectedStatus, targetState: "complete" as const,
      };
      const currentProjection = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: subject,
        activities: subject.activities as InitiativeReadinessActivity[],
        target: "completion",
        transitionObject,
        authorization: "pass",
        capsuleIdentity: identity,
        completion: {
          deliveryEvidence: deliveryEvidenceRefs.length > 0 ? "pass" : "missing",
          acceptanceEvidence: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveReconciliation: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveBaselineConflict: reconciliation.state === "conflict",
          projectionError: reconciliation.state === "malformed",
          evidenceRefs: {
            CAPSULE_IDENTITY_MISMATCH: identity === "pass" ? [capsule.capsuleId] : [],
            DELIVERY_EVIDENCE_REQUIRED: deliveryEvidenceRefs,
            ACCEPTANCE_EVIDENCE_REQUIRED: reconciliation.evidenceRefs,
            OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
          },
        },
        evaluatedAt,
      });
      const persistedCompletion = persistedTerminalCompletionDecision(subject.activities, subject);
      const canReuseItemCompletion = persistedCompletion !== null
        && persistedCompletion.transitionObject.kind === "backlog-item"
        && persistedCompletion.transitionObject.id === subject.id
        && identity === "pass"
        && deliveryEvidenceRefs.length > 0;
      const projected = canReuseItemCompletion
        ? {
            ...currentProjection,
            decision: rebindAllowedItemCompletion({
              persisted: persistedCompletion,
              transitionObject,
              capsuleId: capsule.capsuleId,
              deliveryEvidenceRefs,
              evaluatedAt,
            }),
          }
        : currentProjection;
      return {
        governed: projected.governed,
        decision: projected.decision,
        anchorBacklogItemId: subject.id,
        factsDigest: factsDigest({
          capsuleId: capsule.capsuleId,
          capsuleRowId: capsule.id,
          expectedStatus: args.expectedStatus,
          subjectId: subject.itemId,
          baselineId: reconciliation.baselineId,
          objectiveState: reconciliation.state,
          objectiveEvidenceRefs: reconciliation.evidenceRefs,
          deliveryEvidenceRefs,
          capsuleIdentity: identity,
          reusedItemCompletionDecisionId: canReuseItemCompletion ? persistedCompletion.decisionId : null,
          evaluatedAt,
        }),
      };
    },
    mutate: async (genericTx) => {
      const tx = genericTx as unknown as CapsuleTerminalClient;
      if (!lockedCapsule) throw new Error("Terminal readiness did not resolve a Work Capsule.");
      const updated = await tx.workroom.updateMany({
        where: { id: lockedCapsule.id, status: args.expectedStatus },
        data: { status: "complete", workspaceState: nextWorkspaceState },
      });
      if (updated.count === 1) {
        await tx.workroomActivity.create({ data: {
          workCapsuleId: lockedCapsule.id,
          kind: "status-override",
          summary: args.reason,
          payload: { status: "complete", statusOverride: nextWorkspaceState.statusOverride },
          recordedById: args.actor.userId,
          recordedByAgentId: args.actor.agentId,
        } });
      }
      return updated.count;
    },
  });
}
