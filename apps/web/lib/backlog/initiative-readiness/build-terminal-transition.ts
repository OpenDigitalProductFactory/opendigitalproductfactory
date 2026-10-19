import { createHash } from "node:crypto";

import { prisma } from "@dpf/db";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import { reconcileInitiativeObjectives, type ObjectiveReconciliationActivity } from "./objective-reconciliation";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalTransitionDb,
} from "./terminal-transition-repository";

type BuildOriginator = {
  id: string;
  itemId: string;
  type: string | null;
  source: string | null;
  workType: string | null;
  scopeKind: string | null;
  archetypeCategories: string[];
  archetypeIds: string[];
  organizationId: string | null;
  submittedById: string;
  activities: Array<ObjectiveReconciliationActivity & { gateKey: string | null; backlogItemId?: string }>;
};

type TerminalBuild = {
  id: string;
  buildId: string;
  phase: string;
  kind: string;
  verificationOut: unknown;
  uxVerificationStatus: string | null;
  originator: BuildOriginator | null;
};

type BuildTerminalClient = {
  $queryRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  featureBuild: {
    findUnique(args: unknown): Promise<TerminalBuild | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  backlogItemActivity: { create(args: unknown): Promise<unknown> };
  authorizationDecisionLog: { create(args: unknown): Promise<unknown> };
};

type ProjectReadiness = typeof projectBacklogItemReadiness;
type ReconcileObjectives = typeof reconcileInitiativeObjectives;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * Delivery evidence for a build: its own checks passed, and its change is
 * delivered. Delivery is either a recorded build pass or proof the caller
 * already holds that the merged change is live (BI-3555F94E: nothing in the
 * pipeline writes `buildPassed`, so no build could ever pass this). UX counts
 * where there is UI to verify; "skipped" means the build had no UX criteria,
 * which the proportional gates treat as not applicable, never as verified.
 */
export function buildDeliveryState(build: Pick<TerminalBuild, "verificationOut" | "uxVerificationStatus">, deliveryProven = false) {
  const verification = object(build.verificationOut);
  const delivered = verification.buildPassed === true || deliveryProven;
  const uxSettled = build.uxVerificationStatus === "complete" || build.uxVerificationStatus === "skipped";
  return verification.typecheckPassed === true
    && verification.testsFailed === 0
    && delivered
    && uxSettled
    ? "pass" as const
    : "missing" as const;
}

function factsDigest(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

type BuildReadinessFacts = Awaited<ReturnType<typeof import("@/lib/build/build-entry-gate").loadBuildReadinessFacts>>;

async function loadTerminalBuildFacts(buildId: string): Promise<BuildReadinessFacts | null> {
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      kind: true, designDoc: true, designReview: true, buildPlan: true,
      originator: { select: { id: true, itemId: true, title: true, body: true, workType: true } },
    },
  });
  if (!build?.originator) return null;
  const { loadBuildReadinessFacts } = await import("@/lib/build/build-entry-gate");
  return loadBuildReadinessFacts(prisma as never, { ...build, originator: build.originator });
}

export async function completeFeatureBuildTransition(args: {
  db?: TerminalTransitionDb;
  buildId: string;
  expectedPhase: string;
  evaluatedAt?: string;
  /**
   * The caller has already proven the merged change is live (the delivery
   * preconditions in build-flow-state.ts). Stands in for `buildPassed`.
   */
  deliveryProven?: boolean;
  dependencies?: {
    reconcileObjectives?: ReconcileObjectives;
    projectReadiness?: ProjectReadiness;
    /** The build's shape, sensitivity, inherited scope and reviewed design. */
    loadFacts?: (buildId: string) => Promise<BuildReadinessFacts | null>;
  };
}): Promise<GovernedTerminalTransitionResult> {
  const db = args.db ?? (prisma as unknown as TerminalTransitionDb);
  const evaluatedAt = args.evaluatedAt ?? new Date().toISOString();
  // BI-3555F94E: every other build gate judges the item on its bound shape and
  // the build's reviewed design (build-entry-gate.ts). This one judged every
  // build as unshaped feature work, which owes plan documents and receipts the
  // automated lane never produces, so no shaped build could complete. Read
  // outside the transaction: they are reads, and the projector is pure.
  // A failed read falls back to the unshaped table: stricter, never looser.
  const facts = await (args.dependencies?.loadFacts ?? loadTerminalBuildFacts)(args.buildId).catch(() => null);
  let lockedBuild: TerminalBuild | null = null;
  const actor = {
    actorType: "agent" as const,
    actorRef: "system:build-completion",
    humanContextRef: "pending",
    agentContextRef: null,
  };
  const authority = {
    organizationId: null as string | null,
    actionKey: "complete_feature_build",
    objectRef: args.buildId,
    rationale: { capability: "view_platform", grant: "build_lifecycle", source: "build-completion" },
    authoritySnapshot: {
      decision: "allow" as const,
      effectiveHumanCapability: "view_platform",
      effectiveAgentGrant: "build_lifecycle",
      tokenScope: "organization",
      organizationId: "platform",
      actionKey: "complete_feature_build",
      policyVersion: "coworker-authority.v1",
    },
  };
  return executeGovernedTerminalTransition({
    db,
    actor,
    authority,
    resolve: async (genericTx) => {
      const tx = genericTx as unknown as BuildTerminalClient;
      const build = await tx.featureBuild.findUnique({ where: { buildId: args.buildId }, select: {
        id: true, buildId: true, phase: true, kind: true, verificationOut: true, uxVerificationStatus: true,
        originator: { select: {
          id: true, itemId: true, type: true, source: true, workType: true, scopeKind: true,
          archetypeCategories: true, archetypeIds: true, organizationId: true, submittedById: true,
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
      } });
      if (!build) throw new Error(`FeatureBuild ${args.buildId} not found.`);
      await tx.$queryRawUnsafe('SELECT "id" FROM "FeatureBuild" WHERE "id" = $1 FOR UPDATE', build.id);
      if (build.phase !== args.expectedPhase) {
        throw new Error(`FeatureBuild ${args.buildId} expected phase=${args.expectedPhase}, got ${build.phase}.`);
      }
      if (!build.originator) throw new Error(`FeatureBuild ${args.buildId} has no canonical backlog receipt anchor.`);
      lockedBuild = build;
      const originator = build.originator;
      actor.humanContextRef = originator.submittedById;
      authority.organizationId = originator.organizationId;
      authority.authoritySnapshot.organizationId = originator.organizationId ?? "platform";
      const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
        itemId: originator.itemId,
        itemRowId: originator.id,
        activities: originator.activities,
      });
      const delivery = buildDeliveryState(build, args.deliveryProven === true);
      const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
        item: {
          ...originator,
          activeBuildKind: build.kind,
          ...(facts ? { workShape: facts.workShape, deliverySensitivity: facts.deliverySensitivity } : {}),
        },
        ...(facts ? { buildDesign: facts.buildDesign, inheritedScope: facts.inheritedScope } : {}),
        activities: originator.activities as InitiativeReadinessActivity[],
        target: "completion",
        transitionObject: { kind: "feature-build", id: build.id, expectedVersion: args.expectedPhase, targetState: "complete" },
        authorization: "pass",
        capsuleIdentity: "pass",
        completion: {
          deliveryEvidence: delivery,
          acceptanceEvidence: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveReconciliation: reconciliation.state === "pass" ? "pass" : reconciliation.state === "fail" ? "fail" : "missing",
          objectiveBaselineConflict: reconciliation.state === "conflict",
          projectionError: reconciliation.state === "malformed",
          evidenceRefs: {
            DELIVERY_EVIDENCE_REQUIRED: [`feature-build:${build.buildId}`],
            ACCEPTANCE_EVIDENCE_REQUIRED: reconciliation.evidenceRefs,
            OBJECTIVE_RECONCILIATION_REQUIRED: reconciliation.evidenceRefs,
          },
        },
        evaluatedAt,
      });
      return {
        governed: projected.governed,
        decision: projected.decision,
        anchorBacklogItemId: originator.id,
        factsDigest: factsDigest({
          buildId: build.buildId,
          buildRowId: build.id,
          expectedPhase: args.expectedPhase,
          workShape: facts?.workShape ?? null,
          delivery,
          baselineId: reconciliation.baselineId,
          objectiveState: reconciliation.state,
          evidenceRefs: reconciliation.evidenceRefs,
          evaluatedAt,
        }),
      };
    },
    mutate: async (genericTx) => {
      const tx = genericTx as unknown as BuildTerminalClient;
      if (!lockedBuild) throw new Error("Terminal readiness did not resolve a FeatureBuild.");
      return (await tx.featureBuild.updateMany({
        where: { id: lockedBuild.id, phase: args.expectedPhase },
        data: { phase: "complete" },
      })).count;
    },
  });
}
