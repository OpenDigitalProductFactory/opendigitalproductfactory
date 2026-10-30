import { createHash } from "node:crypto";

import { prisma, type Prisma } from "@dpf/db";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { projectBacklogItemReadiness, type InitiativeReadinessActivity } from "./entry-adapter";
import { reconcileInitiativeObjectives, type ObjectiveReconciliationActivity } from "./objective-reconciliation";
import {
  executeGovernedTerminalTransition,
  type GovernedTerminalTransitionResult,
  type TerminalActor,
  type TerminalAuthority,
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

const TERMINAL_BUILD_SELECT = {
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
} as const;

/**
 * Mint the delivered item's body-criteria baseline inside the completion
 * transaction (BI-729D9B27): lock the item row after the build row, then the
 * same mint the backlog completion runs. Returns whether a baseline now exists
 * that did not before.
 */
async function mintBuildItemBodyBaseline(tx: unknown, args: {
  itemRowId: string;
  profile: import("./types").ReadinessProfile;
  effectiveShape: string;
  actor: TerminalActor;
  authority: TerminalAuthority;
}): Promise<boolean> {
  const client = tx as Prisma.TransactionClient;
  await client.$queryRawUnsafe('SELECT "id" FROM "BacklogItem" WHERE "id" = $1 FOR UPDATE', args.itemRowId);
  const [{ BACKLOG_COMPLETION_ITEM_SELECT }, { ensureItemBodyBaseline }] = await Promise.all([
    import("./backlog-completion-evaluation"),
    import("./body-baseline-persistence"),
  ]);
  const item = await client.backlogItem.findUnique({ where: { id: args.itemRowId }, select: BACKLOG_COMPLETION_ITEM_SELECT });
  if (!item) return false;
  const count = () => client.backlogItemActivity.count({ where: { backlogItemId: args.itemRowId, kind: "initiative_scope_baseline" } });
  const before = await count();
  await ensureItemBodyBaseline(client, { item: item as never, profile: args.profile, effectiveShape: args.effectiveShape, actor: args.actor, authority: args.authority });
  return (await count()) > before;
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
    mintBodyBaseline?: typeof mintBuildItemBodyBaseline;
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
      const build = await tx.featureBuild.findUnique({ where: { buildId: args.buildId }, select: TERMINAL_BUILD_SELECT });
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
      const delivery = buildDeliveryState(build, args.deliveryProven === true);
      const evaluate = (activities: BuildOriginator["activities"]) => {
        const reconciliation = (args.dependencies?.reconcileObjectives ?? reconcileInitiativeObjectives)({
          itemId: originator.itemId,
          itemRowId: originator.id,
          activities,
        });
        const projected = (args.dependencies?.projectReadiness ?? projectBacklogItemReadiness)({
          item: {
            ...originator,
            activeBuildKind: build.kind,
            ...(facts ? { workShape: facts.workShape, deliverySensitivity: facts.deliverySensitivity } : {}),
          },
          ...(facts ? { buildDesign: facts.buildDesign, inheritedScope: facts.inheritedScope } : {}),
          activities: activities as InitiativeReadinessActivity[],
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
        return { reconciliation, projected };
      };
      let { reconciliation, projected } = evaluate(originator.activities);
      // BI-729D9B27: a delivered medium build owes an independent acceptance that
      // is mapped against the item's body criteria, and only the backlog-item
      // completion minted that baseline, a path a build-originated item never
      // takes. Mint it here on the same terms: delivery proven and passing,
      // acceptance still owed. It records scope, not a receipt.
      if (args.deliveryProven === true && delivery === "pass"
        && projected.decision.shapeDecision?.effective === "medium"
        && [...projected.decision.blockers, ...projected.decision.unmet].some((entry) => entry.code === "ACCEPTANCE_EVIDENCE_REQUIRED")) {
        const minted = await (args.dependencies?.mintBodyBaseline ?? mintBuildItemBodyBaseline)(genericTx, {
          itemRowId: originator.id,
          profile: projected.decision.profile,
          effectiveShape: "medium",
          actor,
          authority,
        });
        if (minted) {
          const reread = await tx.featureBuild.findUnique({ where: { buildId: args.buildId }, select: TERMINAL_BUILD_SELECT });
          if (reread?.originator) ({ reconciliation, projected } = evaluate(reread.originator.activities));
        }
      }
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
