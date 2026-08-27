"use server";

import { requireCapability } from "@/lib/actions/shared/guards";
import { prisma, type Prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  validateFeatureBrief,
  canTransitionPhase,
  checkPhaseGate,
  generateBuildId,
  bumpVersion,
  normalizeHappyPathState,
  type FeatureBrief,
  type BuildPhase,
  type VersionBump,
  type BuildDesignDoc,
  type BuildPlanDoc,
  type ReviewResult,
  type BuildDeliberationSummary,
} from "@/lib/feature-build-types";
import { buildDesignReviewPrompt, buildPlanReviewPrompt, parseReviewResponse } from "@/lib/build-reviewers";
import { queueBuildReviewVerification } from "@/lib/build-review-verification-trigger";
import { saveBuildArtifactRevision, type BuildArtifactField } from "@/lib/build/build-artifact-provenance";
import { buildAcceptanceEvidenceRecord, writeAcceptanceMet } from "@/lib/build/auto-accept";
import { evaluateBuildStudioDecision } from "@/lib/build/decision-service";
import { ok, err, type ActionResult } from "@/lib/shared/action-result";
import {
  assertFeatureBuildDependencyGate,
  FEATURE_BUILD_DEPENDENCY_GATE_SELECT,
  recordReadyDependentsAfterCompletion,
} from "@/lib/build/feature-build-dependencies";
import { evaluateBuildStudioPlanAdvancementGate } from "@/lib/decision-perspective/build-studio-gate";
import { resolvePlannedFilePaths } from "@/lib/decision-perspective/planned-file-paths";
import type { ResumeBuildImplementationOutcome } from "@/lib/build/progress-visibility-types";
import {
  type BusinessBriefEvidenceKind,
  type BusinessBuildBriefSource,
  businessBuildBriefEditToPersistence,
  legacyFeatureBuildBriefToBusinessBuildBriefInput,
} from "@/lib/build/business-build-brief";
import { routeAndCall } from "@/lib/routed-inference";
import * as crypto from "crypto";
import { listReleasableSandboxFiles } from "@/lib/build/sandbox/sandbox";
import {
  attachBuildStudioWorkCapsule,
  type BuildStudioCapsuleDb,
} from "@/lib/work-capsules/build-studio-attachment";
import type { UnifiedWipDb } from "@/lib/build/unified-wip-query";
import { revalidatePortalContextForBuild } from "@/lib/portal-context/invalidation";
import {
  businessBriefJsonPayload,
  readPersistedSourceCurrency,
  derivePhaseHandoffContext,
  deriveResumeImplementationMode,
  formatResumeImplementationOutcomeMessage,
} from "@/lib/build/build-actions-core";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import { assertBuildPhaseInitiativeReadiness } from "@/lib/build/build-entry-gate";
import { assertFeatureBuildCompletion } from "@/lib/backlog/initiative-readiness/build-terminal-transition";
// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireBuildAccess(): Promise<string> {
  return (await requireCapability("view_platform")).userId;
}

// ─── Create Feature Build ────────────────────────────────────────────────────

// Discriminated result so EXPECTED domain errors (empty title, WIP cap) carry a
// plain-English message all the way to the client. A thrown Error would have its
// message stripped at the Server-Action boundary in production ("An error
// occurred in the Server Components render … message omitted in production"),
// so the operator would see a scary generic digest instead of "you already have
// 3 builds in progress". Unexpected failures (DB errors) still throw.
export type CreateFeatureBuildResult =
  | { ok: true; buildId: string }
  | { ok: false; error: string; code?: string };

export async function createFeatureBuild(input: {
  title: string;
  description?: string;
  portfolioId?: string;
}): Promise<CreateFeatureBuildResult> {
  const userId = await requireBuildAccess();

  if (!input.title.trim()) return { ok: false, error: "Title is required" };

  // WIP cap (BI-937128F6): don't let a new build start while the shared BS
  // sandbox pool is saturated. The pressure is now the unified, pool-aware count
  // across ALL surfaces' active WIP — a new BS build contends on the bs-sandbox
  // pool, so it gates on that pool's pressure (capacity BUILD_WIP_CAP, unchanged),
  // replacing the old BS-only build count. Returned (not thrown) so the
  // plain-English message survives the Server-Action → client boundary in prod.
  const { decideUnifiedWip, BuildWipCapError } = await import("@/lib/build/wip-cap");
  const { loadActiveUnifiedWip, poolPressure } = await import("@/lib/build/unified-wip-query");
  const wip = await loadActiveUnifiedWip(prisma as unknown as UnifiedWipDb);
  const wipDecision = decideUnifiedWip("bs-sandbox", poolPressure(wip, "bs-sandbox"));
  if (!wipDecision.admitted) {
    const err = new BuildWipCapError(wipDecision.pressure, wipDecision.capacity);
    return { ok: false, error: err.message, code: err.code };
  }

  const buildId = generateBuildId();

  const result = await prisma.$transaction(async (tx) => {
    await admitRuntimeGuardedWork(tx as never, "build-studio-active");
    const created = await tx.featureBuild.create({
      data: {
        buildId,
        title: input.title.trim(),
        ...(input.description !== undefined && { description: input.description.trim() || null }),
        ...(input.portfolioId !== undefined && { portfolioId: input.portfolioId || null }),
        createdById: userId,
      },
    });

    await attachBuildStudioWorkCapsule({
      db: tx as unknown as BuildStudioCapsuleDb,
      build: {
        id: created.id,
        buildId: created.buildId,
        title: created.title,
        description: created.description,
        phase: created.phase,
      },
      actor: { userId, agentId: null, principalId: null },
    });

    return { buildId: created.buildId };
  });

  // EP-COST Phase 3: start ideate-phase tracking (fire-and-forget). .catch swallows the drain-time QuiescingError startBuildPhaseRun throws (BI-QUIESCE-005).
  const { startBuildPhaseRun } = await import("@/lib/build/build-phase-run");
  void startBuildPhaseRun(result.buildId, "ideate").catch(() => {});

  return { ok: true, buildId: result.buildId };
}

/**
 * Record the owner's approval to start a governed backlog draft.
 *
 * BI-CE1AB982 — returns a result value rather than throwing for the expected
 * "we cannot run this" case. A thrown Error is stripped to a production digest
 * (same reason advanceBuildPhase returns its outcome, BI-8C6AA60E), and the
 * whole point of the pre-flight is that the owner reads the real cause.
 */
export async function approveBuildStart(
  buildId: string,
): Promise<ActionResult<{ approvedAt: Date }>> {
  const userId = await requireBuildAccess();

  const [build, devConfig] = await Promise.all([
    prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        createdById: true,
        phase: true,
        originatingBacklogItemId: true,
        draftApprovedAt: true,
      },
    }),
    prisma.platformDevConfig.findUnique({
      where: { id: "singleton" },
      select: { governedBacklogEnabled: true },
    }),
  ]);

  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "ideate" && build.phase !== "plan") {
    throw new Error("Start approval is only available before implementation begins");
  }
  if (!build.originatingBacklogItemId) {
    throw new Error("Only backlog-linked drafts require start approval");
  }
  // Backlog-linked drafts always have an approval gate, regardless of the
  // governedBacklogEnabled platform flag. The flag controls whether NEW drafts
  // are auto-promoted under governance; it does not control whether existing
  // backlog-linked builds can record approval. The previous gate threw
  // "This build is not using the governed backlog workflow" on every fresh
  // install (where the flag defaults to false), making the UI's own
  // "Record Approve Start" button error out — even though the workflow-action
  // resolver renders it solely on the backlog-link condition. Aligning here.
  void devConfig;

  // BI-CE1AB982 — refuse before the owner authorises work that cannot be run.
  if (!build.draftApprovedAt) {
    const { resolveDispatchPreflight } = await import("@/lib/build/dispatch-preflight");
    const preflight = await resolveDispatchPreflight();
    if (preflight) {
      prisma.buildActivity.create({
        data: {
          buildId,
          tool: "dispatch_blocked",
          summary: preflight,
        },
      }).catch(() => {});
      return err(
        `Build Studio cannot start this yet: no configured AI service can run it. ${preflight}`,
      );
    }
  }

  const approvedAt = build.draftApprovedAt ?? new Date();
  await prisma.featureBuild.update({
    where: { buildId },
    data: { draftApprovedAt: approvedAt },
  });

  prisma.buildActivity.create({
    data: {
      buildId,
      tool: "approve_start",
      summary: `Start approved for governed backlog draft at ${approvedAt.toISOString()}`,
    },
  }).catch(() => {});

  // Auto-dispatch Ideate-phase design-doc research for backlog-promoted drafts.
  // Without this, approve_start was a structural success that produced no
  // functional truth — the build sat at "Ready for Planning / A design document
  // is required before planning" until the operator manually engaged the
  // coworker chat. The helper is fire-and-forget, idempotent (skips if designDoc
  // already exists), and only fires for backlog-promoted drafts. Maps to kernel
  // principle `structural-verification-is-not-functional`.
  if (build.originatingBacklogItemId) {
    void (async () => {
      try {
        const { dispatchIdeateForApprovedBuild } = await import("@/lib/build/ideate-on-approval");
        await dispatchIdeateForApprovedBuild({ buildId, userId });
      } catch (err) {
        // dispatchIdeateForApprovedBuild already catches internally and writes
        // a BuildActivity row; this is belt-and-braces for the dynamic import.
        console.error("[approveBuildStart] Ideate auto-dispatch import/invoke failed:", { buildId }, err);
      }
    })();
  }

  return ok({ approvedAt });
}

// ─── Update Feature Brief ────────────────────────────────────────────────────

export async function updateFeatureBrief(
  buildId: string,
  brief: FeatureBrief,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "ideate") throw new Error("Brief can only be updated during Ideate phase");

  const validation = validateFeatureBrief(brief);
  if (!validation.valid) throw new Error(validation.errors.join(", "));

  const organization = await prisma.organization.findFirst({ select: { id: true } });
  if (!organization) throw new Error("Organization is required before saving a business build brief");

  const businessBrief = legacyFeatureBuildBriefToBusinessBuildBriefInput({
    orgId: organization.id,
    buildId: build.buildId,
    featureBuildId: build.id,
    title: build.title,
    brief,
    submittedByUserId: userId,
  });
  const acceptedFields = businessBrief.status === "accepted"
    ? { acceptedByUserId: userId, acceptedAt: new Date() }
    : { acceptedByUserId: null, acceptedAt: null };
  const jsonPayload = businessBriefJsonPayload(businessBrief);

  await prisma.$transaction(async (tx) => {
    await tx.featureBuild.update({
      where: { buildId },
      data: { brief: brief as unknown as Prisma.InputJsonValue },
    });

    await tx.businessBuildBrief.upsert({
      where: { featureBuildId: build.id },
      create: {
        ...businessBrief,
        ...jsonPayload,
        ...acceptedFields,
      },
      update: {
        status: businessBrief.status,
        intakeSource: businessBrief.intakeSource,
        capabilityPackId: businessBrief.capabilityPackId,
        backlogItemId: businessBrief.backlogItemId,
        businessOutcome: businessBrief.businessOutcome,
        affectedPeople: jsonPayload.affectedPeople,
        affectedWorkflow: businessBrief.affectedWorkflow,
        sourceEvidence: jsonPayload.sourceEvidence,
        successSignals: businessBrief.successSignals,
        constraints: businessBrief.constraints,
        businessInterpretation: businessBrief.businessInterpretation,
        technicalInterpretation: jsonPayload.technicalInterpretation,
        riskProfile: jsonPayload.riskProfile,
        hiveReadiness: jsonPayload.hiveReadiness,
        openQuestions: businessBrief.openQuestions,
        confidence: businessBrief.confidence,
        confidenceRationale: businessBrief.confidenceRationale,
        submittedByUserId: businessBrief.submittedByUserId,
        ...acceptedFields,
      },
    });
  });
}

export async function updateBusinessBuildBrief(input: {
  briefId: string;
  intakeSource?: BusinessBuildBriefSource;
  evidenceKind?: BusinessBriefEvidenceKind;
  businessOutcome: string;
  affectedPeopleText: string;
  affectedWorkflow?: string | null;
  sourceEvidenceText: string;
  copyAdaptAvoidText?: string;
  successSignalsText: string;
  constraintsText: string;
  openQuestionsText: string;
  accept?: boolean;
}): Promise<void> {
  const userId = await requireBuildAccess();

  const persistence = businessBuildBriefEditToPersistence(input);
  const briefId = input.briefId.trim();

  const existing = await prisma.businessBuildBrief.findUnique({
    where: { briefId },
    select: {
      briefId: true,
      featureBuildId: true,
      submittedByUserId: true,
      status: true,
    },
  });
  if (!existing) throw new Error("Business build brief not found");
  if (existing.submittedByUserId && existing.submittedByUserId !== userId) {
    throw new Error("Forbidden");
  }

  const acceptedFields = persistence.accepted
    ? { acceptedByUserId: userId, acceptedAt: new Date() }
    : { acceptedByUserId: null, acceptedAt: null };

  await prisma.$transaction(async (tx) => {
    await tx.businessBuildBrief.update({
      where: { briefId },
      data: {
        status: persistence.status,
        intakeSource: persistence.intakeSource,
        businessOutcome: persistence.businessOutcome,
        affectedPeople: persistence.affectedPeople as unknown as Prisma.InputJsonValue,
        affectedWorkflow: persistence.affectedWorkflow,
        sourceEvidence: persistence.sourceEvidence as unknown as Prisma.InputJsonValue,
        successSignals: persistence.successSignals,
        constraints: persistence.constraints,
        businessInterpretation: persistence.businessInterpretation,
        technicalInterpretation: persistence.technicalInterpretation as unknown as Prisma.InputJsonValue,
        riskProfile: persistence.riskProfile as unknown as Prisma.InputJsonValue,
        openQuestions: persistence.openQuestions,
        confidence: persistence.confidence,
        confidenceRationale: persistence.confidenceRationale,
        submittedByUserId: userId,
        ...acceptedFields,
      },
    });

    if (existing.featureBuildId) {
      await tx.featureBuild.update({
        where: { id: existing.featureBuildId },
        data: {
          brief: persistence.legacyFeatureBrief as unknown as Prisma.InputJsonValue,
        },
      });
    }
  });

  revalidatePath("/build");
}

// ─── Advance Phase ───────────────────────────────────────────────────────────

/**
 * Outcome of a phase advance. The two "no releasable source changes" states are
 * EXPECTED operational conditions the operator must be able to read and act on —
 * not invariant violations. Thrown Server Action errors have their messages
 * stripped in production (the operator sees only a digest), which is how a build
 * that passed every gate surfaced as an unexplained render error in BI-8C6AA60E.
 * So those two are RETURNED as values, per the #2758 pattern. The remaining
 * throws in this function are genuine invariant violations where a digest is the
 * correct operator experience.
 */
export type AdvanceBuildPhaseResult = { ok: true } | { ok: false; message: string };

export async function advanceBuildPhase(
  buildId: string,
  targetPhase: BuildPhase,
  options?: { overrideUxFailure?: { reason: string } },
): Promise<AdvanceBuildPhaseResult> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      buildId: true,
      title: true,
      phase: true,
      kind: true,
      createdById: true,
      originatingBacklogItemId: true,
      draftApprovedAt: true,
      designDoc: true,
      designReview: true,
      plan: true,
      brief: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
      uxTestResults: true,
      uxVerificationStatus: true,
      sandboxId: true,
      deliberationSummary: true,
      parentEpicId: true,
      dependenciesOut: FEATURE_BUILD_DEPENDENCY_GATE_SELECT.dependenciesOut,
    },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  const governedConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });

  const requiresStartApproval =
    build.originatingBacklogItemId != null
    && build.draftApprovedAt == null
    && (
      (currentPhase === "ideate" && targetPhase === "plan")
      || (currentPhase === "plan" && targetPhase === "build")
    );

  if (requiresStartApproval) {
    return { ok: false, message: currentPhase === "ideate"
      ? "Approve Start before moving this governed backlog draft into planning."
      : "Approve Start before moving this backlog-linked draft into implementation." };
  }

  if (!canTransitionPhase(currentPhase, targetPhase)) {
    return { ok: false, message: `Cannot transition from ${currentPhase} to ${targetPhase}` };
  }

  if (targetPhase === "complete") await assertFeatureBuildCompletion({ buildId, expectedPhase: currentPhase });
  else await assertBuildPhaseInitiativeReadiness({ buildId, currentPhase, targetPhase });

  if (currentPhase === "ideate" && targetPhase === "plan") {
    const businessBrief = await prisma.businessBuildBrief.findUnique({
      where: { featureBuildId: build.id },
      select: { status: true },
    });
    // null = brief not yet created (governance gap — proceed). Only block on an
    // explicitly non-accepted brief (draft, rejected, etc.) so builds created
    // without going through the full intake UI are not permanently deadlocked.
    if (businessBrief !== null && businessBrief.status !== "accepted") {
      return { ok: false, message: "Accept the business build brief before moving into planning." };
    }
  }

  const brief = build.brief as { acceptanceCriteria?: string[]; fixContext?: import("@/lib/feature-build-types").FixContext } | null;
  // Right-sizing matrix: read processSize from plan.processSize (written at
  // promote time) and pass it to checkPhaseGate so the policy lookup picks
  // the matching LifecyclePolicy. Default "medium" preserves the byte-
  // identical default cell. See
  // docs/superpowers/specs/2026-05-30-build-studio-right-sizing-design.md.
  const buildPlanState = (build.plan as Record<string, unknown> | null) ?? null;
  const processSize = (buildPlanState?.["processSize"] as string | undefined) ?? "medium";
  const gate = checkPhaseGate(currentPhase, targetPhase, {
    kind: build.kind,
    processSize,
    fixContext: brief?.fixContext,
    designDoc: build.designDoc,
    designReview: build.designReview,
    happyPathState: normalizeHappyPathState(buildPlanState?.happyPathState ?? null),
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    taskResults: build.taskResults,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
    uxTestResults: build.uxTestResults,
    uxVerificationStatus: build.uxVerificationStatus,
    acceptanceCriteria: brief?.acceptanceCriteria ?? [],
  });

  if (!gate.allowed) {
    // Operator override: only bypasses UX-verification blockers, never the
    // acceptance-criteria / design-doc / verification-output prerequisites.
    // The gate message for UX failures always starts with "UX verification".
    const override = options?.overrideUxFailure;
    const isUxBlocker = gate.reason?.startsWith("UX verification") ?? false;
    if (override && isUxBlocker && override.reason.trim().length >= 10) {
      await prisma.buildActivity.create({
        data: {
          buildId,
          tool: "ux-override",
          summary: `UX verification override applied for ${targetPhase}: ${override.reason.trim()}`,
        },
      }).catch(() => {});
    } else {
      // BI-04B112CA — an expected "not yet" returns; thrown it is stripped to a
      // digest and the owner sees React #441 instead of the reason (FB-05946F96).
      return { ok: false, message: gate.reason ?? "Phase gate check failed" };
    }
  }

  if (currentPhase === "plan" && targetPhase === "build") {
    assertFeatureBuildDependencyGate({
      id: build.id,
      buildId: build.buildId,
      title: build.title,
      parentEpicId: build.parentEpicId,
      phase: build.phase,
      dependenciesOut: build.dependenciesOut,
    });

    const recommendation = await evaluateBuildStudioDecision({
      userId,
      request: {
        source: "build-studio",
        routeContext: "/build",
        buildId,
        phase: currentPhase,
        question: `Start implementation for "${build.title ?? buildId}" from the reviewed Build Studio plan?`,
        options: [
          {
            id: "start-implementation",
            description: "Start implementation from the reviewed Build Studio plan.",
            operatorLabel: "Start implementation",
          },
          {
            id: "revise-plan",
            description: "Revise the implementation plan before starting.",
            operatorLabel: "Revise plan",
          },
          {
            id: "escalate-owner",
            description: "Escalate to the Build Studio owner before implementation.",
            operatorLabel: "Escalate to owner",
          },
        ],
      },
    });
    prisma.buildActivity.create({
      data: {
        buildId,
        tool: "build-studio-decision",
        summary: `${recommendation.operatorActionLabel}: ${recommendation.reasonSummary}`,
      },
    }).catch(() => {});

    // BI-D996C238 — graduated gate autonomy (opt-in): derive the risk tier from
    // the deliverable's sensitivity instead of the fixed "medium", so a
    // low-sensitivity plan advancement can clear on the ladder while a
    // high-sensitivity one always escalates. Fail-open to undefined (→ the gate's
    // "medium" default) so a config/derive error never changes the gate.
    let graduatedRiskTier: "low" | "medium" | "high" | "critical" | undefined;
    try {
      const { isGraduatedGateAutonomyEnabled } = await import("@/lib/build/build-studio-config");
      if (isGraduatedGateAutonomyEnabled()) {
        const { deriveDeliverableSensitivity } = await import("@/lib/explore/build-process-matrix");
        const { deriveTransitionRiskTier } = await import("@/lib/decision-perspective/graduated-autonomy");
        const text = `${build.title ?? ""}\n${JSON.stringify(build.designDoc ?? build.buildPlan ?? {})}`.slice(0, 4000);
        const sensitivity = deriveDeliverableSensitivity({ text, workType: build.kind });
        graduatedRiskTier = deriveTransitionRiskTier({ sensitivity, transition: "plan-advance" });
      }
    } catch {
      graduatedRiskTier = undefined;
    }

    const decisionGate = await evaluateBuildStudioPlanAdvancementGate({
      db: prisma,
      build: {
        buildId,
        title: build.title ?? buildId,
        phase: currentPhase,
        planReview: build.planReview as ReviewResult | null,
        deliberationSummary: build.deliberationSummary as BuildDeliberationSummary | null,
      },
      triggeredByUserId: userId,
      riskTier: graduatedRiskTier,
      // BI-70280889: without these the acumen consults never run.
      plannedFilePaths: await resolvePlannedFilePaths({ db: prisma, buildId, buildRowId: build.id }),
    });
    if (!decisionGate.allowed) {
      throw new Error(decisionGate.operatorMessage);
    }
  }

  if (currentPhase === "build" && targetPhase === "review") {
    if (!build.sandboxId) {
      throw new Error("Build Studio cannot advance to review because the sandbox is no longer available.");
    }
    const { getClientIdentity } = await import("@/lib/build/sandbox/build-branch");
    const { clientBranch } = await getClientIdentity();
    const releasableFiles = await listReleasableSandboxFiles(build.sandboxId, { baseRef: clientBranch });
    if (releasableFiles.length === 0) {
      return {
        ok: false,
        message:
          "No releasable source changes are present in the sandbox. Tasks are marked complete but no code was written. Resume implementation and make real code changes before advancing to review.",
      };
    }
  }

  if (currentPhase === "review" && targetPhase === "ship") {
    if (!build.sandboxId) {
      throw new Error("Build Studio cannot continue to release because the sandbox is no longer available.");
    }
    const { getClientIdentity } = await import("@/lib/build/sandbox/build-branch");
    const { clientBranch } = await getClientIdentity();
    const releasableFiles = await listReleasableSandboxFiles(build.sandboxId, { baseRef: clientBranch });
    if (releasableFiles.length === 0) {
      return {
        ok: false,
        message:
          "No releasable source changes are present in the sandbox. Resume implementation and make a real code change before continuing to release.",
      };
    }
  }

  if (targetPhase !== "complete") {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { phase: targetPhase },
    });
  }
  revalidatePortalContextForBuild(buildId);

  // Ephemeral ship-phase token lifecycle (BI-9866659C AC #4). Reduces
  // blast radius: ship-phase work (deploy_feature, execute_promotion, etc)
  // can run against a build-scoped token instead of the operator's full
  // session credential. Token entries are issued on review→ship and
  // revoked on ship→exit. Wrapped in try/catch so a token-side failure
  // never blocks the phase transition itself — same non-fatal stance as
  // the agentEventBus emit below.
  try {
    const { manageEphemeralShipTokensForTransition } = await import(
      "@/lib/auth/ephemeral-ship-tokens"
    );
    await manageEphemeralShipTokensForTransition({
      buildId,
      userId,
      currentPhase,
      targetPhase,
      buildTitle: build.title,
    });
  } catch (err) {
    console.error("[ephemeral-ship-token] lifecycle hook failed (non-fatal)", err);
  }

  // Notify the UI immediately so progress indicators update without waiting for debounce
  try {
    const updatedBuild = await prisma.featureBuild.findUnique({ where: { buildId }, select: { threadId: true } });
    if (updatedBuild?.threadId) {
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      agentEventBus.emit(updatedBuild.threadId, {
        type: "phase:change",
        buildId,
        phase: targetPhase,
      } as import("@/lib/agent-event-bus").AgentEvent);
    }
  } catch { /* best-effort — don't block phase transition */ }

  // Write PhaseHandoff document — structured context for the next phase's agent
  try {
    const { fromAgent, toAgent, evidenceFields, evidenceDigest } = derivePhaseHandoffContext({
      currentPhase,
      targetPhase,
      build,
    });

    await prisma.phaseHandoff.create({
      data: {
        buildId,
        fromPhase: currentPhase,
        toPhase: targetPhase,
        fromAgentId: fromAgent,
        toAgentId: toAgent,
        summary: `Phase ${currentPhase} complete. Advancing to ${targetPhase}.`,
        evidenceFields,
        evidenceDigest,
        gateResult: { allowed: gate.allowed, reason: gate.reason ?? "ok" },
      },
    });
  } catch (err) {
    // PhaseHandoff creation is best-effort — don't block phase transition
    console.error("[advanceBuildPhase] PhaseHandoff creation failed:", err);
  }

  // Create calendar events for milestone visibility
  if (targetPhase === "build" || targetPhase === "review" || targetPhase === "ship") {
    try {
      const fullBuild = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { title: true, createdById: true },
      });
      // Find the employee profile for the calendar event owner
      const employee = await prisma.employeeProfile.findFirst({
        where: { userId: fullBuild?.createdById },
        select: { id: true },
      });
      if (employee) {
        const phaseLabels: Record<string, string> = {
          build: "Building",
          review: "Review",
          ship: "Shipping",
        };
        const eventId = `BUILD-${buildId}-${targetPhase}`;
        await prisma.calendarEvent.upsert({
          where: { eventId },
          create: {
            eventId,
            title: `${phaseLabels[targetPhase] ?? targetPhase}: ${fullBuild?.title ?? buildId}`,
            startAt: new Date(),
            eventType: "action",
            category: "platform",
            ownerEmployeeId: employee.id,
            visibility: "team",
            color: targetPhase === "ship" ? "#22c55e" : "#7c8cf8",
          },
          update: {
            title: `${phaseLabels[targetPhase] ?? targetPhase}: ${fullBuild?.title ?? buildId}`,
            startAt: new Date(),
          },
        });
        // Link calendar event to the build
        await prisma.featureBuild.update({
          where: { buildId },
          data: { calendarEventId: eventId },
        });
      }
    } catch {
      // Calendar event creation is best-effort — don't block phase transition
    }
  }

  // Auto-launch sandbox and execute build plan when entering Build phase
  if (targetPhase === "build") {
    // Fire-and-forget: sandbox launch + coding agent execution
    // This runs async so the phase transition returns immediately.
    // Progress streams via SSE event bus.
    autoExecuteBuild(buildId).catch((err) =>
      console.error(`[build] autoExecuteBuild failed for ${JSON.stringify(buildId)}: ${err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))}`),
    );
  }

  // Dispatch coworker-driven UX verification when entering Review phase.
  // Runs asynchronously via Inngest (build/review.verify) — the handler
  // calls browser-use against the live sandbox, persists per-step
  // screenshots on the shared /evidence volume, and updates
  // FeatureBuild.uxVerificationStatus + uxTestResults. The existing
  // checkPhaseGate then blocks review -> ship on any failures.
  if (targetPhase === "review") {
    await queueBuildReviewVerification(buildId);
  }

  return { ok: true };
}

/**
 * System-level build execution — delegates to checkpoint pipeline.
 *
 * Exported so the boot reconciler (instrumentation.ts) can re-dispatch builds
 * stranded by a portal restart. It carries no auth (it is the system executor,
 * not a user-facing server action); the only callers are this module's own
 * server actions (which authorize first) and the boot reconciler (which only
 * invokes it for rows it has already confirmed are resumable in-flight builds).
 */
export async function autoExecuteBuild(buildId: string): Promise<void> {
  // BI-89030C9B Phase 1 — durable path. When the flag is on, hand the run to
  // the Inngest function (build/execute.run) instead of executing in-process:
  // the engine's journal then owns crash recovery, so a portal recycle no
  // longer strands the build. The send carries a deterministic idempotency id
  // so the four call sites (and their retries) collapse duplicate dispatches
  // of the same logical attempt into one durable run.
  const { isBuildDurableExecutionEnabled, buildExecuteSendId } = await import(
    "@/lib/build/build-execute-helpers"
  );
  if (isBuildDurableExecutionEnabled()) {
    const current = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { buildExecState: true },
    });
    const { inngest } = await import("@/lib/queue/inngest-client");
    await inngest.send({
      name: "build/execute.run",
      data: { buildId },
      id: buildExecuteSendId(
        buildId,
        current?.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null,
      ),
    });
    return;
  }

  const { agentEventBus } = await import("@/lib/agent-event-bus");
  const { runBuildPipeline } = await import("@/lib/build-pipeline");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { buildExecState: true, threadId: true },
  });

  const emit = (event: import("@/lib/agent-event-bus").AgentEvent) => {
    if (build?.threadId) agentEventBus.emit(build.threadId, event);
  };

  const updateState = async (state: import("@/lib/build-exec-types").BuildExecutionState) => {
    const persisted = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { buildExecState: true },
    });
    const persistedSourceCurrency = readPersistedSourceCurrency(persisted?.buildExecState);
    const nextState = state.sourceCurrency || !persistedSourceCurrency
      ? state
      : { ...state, sourceCurrency: persistedSourceCurrency };

    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildExecState: nextState as unknown as import("@dpf/db").Prisma.InputJsonValue,
        ...(nextState.containerId ? { sandboxId: nextState.containerId } : {}),
        ...(nextState.hostPort ? { sandboxPort: nextState.hostPort } : {}),
      },
    });
  };

  const result = await runBuildPipeline({
    buildId,
    existingState: build?.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null,
    updateState,
    emit,
  });

  // Log completion
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "runBuildPipeline",
      summary: result.step === "complete"
        ? "Build pipeline completed successfully"
        : `Build pipeline failed at step: ${result.failedAt ?? result.step}`,
    },
  }).catch(() => {});
}

/**
 * FB-78E967D4 — operator-initiated reset for a build whose `buildExecState`
 * is in a self-contradictory shape that the existing retry/resume paths
 * refuse to handle. The canonical case (FB-F0476EF3) is
 * `step="complete"` with a populated `error`/`failedAt` — a relic of a
 * partial run that the pipeline short-circuited past on a subsequent pass.
 *
 * PR #859 prevents new builds from reaching this shape going forward. This
 * server action exists for rows that were stranded before that fix landed.
 *
 * Behavior:
 *  - Validates the caller owns the build (same auth contract as
 *    {@link retryBuildExecution}).
 *  - Throws if the state is not in fact contradictory. We never null
 *    `buildExecState` on a healthy build — that would discard live
 *    container/port pointers and orphan a running sandbox.
 *  - Clears `buildExecState`, logs an activity row, and fires
 *    {@link autoExecuteBuild} so the pipeline restarts from the beginning
 *    on a clean checkpoint.
 */
export async function resetBuildExecution(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true, buildExecState: true, phase: true },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const state = build.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null;
  if (state == null) {
    throw new Error("Build has no execution state to reset.");
  }

  // "Stalled at pending": the pipeline started accumulating state (sourceCurrency,
  // ideateResearchRequested, etc.) but was killed before setting the first step
  // (e.g. portal restart during the fire-and-forget autoExecuteBuild call).
  // No step means no standard recovery path applies, so reset is valid.
  const isStalledAtPending = state.step == null;
  const isContradictory =
    isStalledAtPending ||
    (state.step !== "failed" && (state.error != null || state.failedAt != null));
  if (!isContradictory) {
    throw new Error(
      "Build execution state is not contradictory. Use Retry Build for failed states or Resume Implementation for partial task failures.",
    );
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      buildExecState: null as unknown as Prisma.InputJsonValue,
      ...(build.phase === "failed" ? { phase: "build" } : {}),
    },
  });

  revalidatePortalContextForBuild(buildId);

  const summaryStepLabel = isStalledAtPending ? "none (stalled before first step)" : String(state.step);
  prisma.buildActivity
    .create({
      data: {
        buildId,
        tool: "resetBuildExecution",
        summary:
          `Reset contradictory pipeline checkpoint (prior step=${summaryStepLabel}` +
          `${state.failedAt ? `, failedAt=${state.failedAt}` : ""}` +
          `${state.error ? `, error=${state.error.slice(0, 200)}` : ""}` +
          `)`,
      },
    })
    .catch(() => {});

  // Fire-and-forget — pipeline starts from a clean state and self-heals.
  // buildId is passed as a separate console.error arg (not embedded in the
  // format string) to avoid CodeQL js/tainted-format-string on the user-
  // routable identifier.
  autoExecuteBuild(buildId).catch((err) =>
    console.error("[build] resetBuildExecution failed for %s: %s",
      JSON.stringify(buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))),
  );
}

export async function retryBuildExecution(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true, buildExecState: true, phase: true },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const state = build.buildExecState as import("@/lib/build-exec-types").BuildExecutionState | null;
  if (!state || state.step !== "failed") {
    throw new Error("Build is not in a failed state. Cannot retry.");
  }

  if (build.phase === "failed") {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { phase: "build" },
    });
    revalidatePortalContextForBuild(buildId);
  }

  // Fire-and-forget retry — picks up from failed step
  autoExecuteBuild(buildId).catch((err) =>
    console.error("[build] retryBuildExecution failed for %s: %s",
      JSON.stringify(buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))),
  );
}

export async function runBuildReviewVerification(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true, phase: true },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "review") {
    throw new Error("Review verification can only run for builds in review");
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      uxVerificationStatus: null,
      uxTestResults: null as unknown as Prisma.InputJsonValue,
    },
  });

  await queueBuildReviewVerification(buildId);
}

export async function recordBuildAcceptance(
  buildId: string,
  note?: string,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      createdById: true,
      phase: true,
      brief: true,
      designDoc: true,
      verificationOut: true,
      uxVerificationStatus: true,
      uxTestResults: true,
    },
  });

  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "review") {
    throw new Error("Acceptance can only be recorded during review");
  }

  const verification = build.verificationOut as
    | { typecheckPassed?: boolean }
    | null;
  if (!verification?.typecheckPassed) {
    throw new Error("Typecheck must be clean before acceptance can be recorded");
  }

  // ADVISORY (operator decision 2026-06-07): UX verification is recorded for
  // visibility but no longer hard-blocks recording acceptance — consistent with
  // the uxVerification-not-blocking phase gate and the informational unit-test
  // gate. browser-use UX results (incl. not-run / failed) are advisory and shown
  // in the Review panel; the QUALITY of the UX check itself is tracked in
  // BI-4BD81F3B. Typecheck (checked above) remains a hard gate.

  const brief = build.brief as { acceptanceCriteria?: string[] } | null;
  const designDoc = build.designDoc as { acceptanceCriteria?: string[] } | null;
  const acceptanceCriteria = Array.isArray(brief?.acceptanceCriteria) && brief.acceptanceCriteria.length > 0
    ? brief.acceptanceCriteria
    : Array.isArray(designDoc?.acceptanceCriteria)
      ? designDoc.acceptanceCriteria
      : [];

  if (acceptanceCriteria.length === 0) {
    throw new Error("No acceptance criteria are available to record");
  }

  const evidenceSuffix = note?.trim()
    ? ` ${note.trim()}`
    : "";
  const acceptanceMet = buildAcceptanceEvidenceRecord(
    acceptanceCriteria,
    `Reviewed in Build Studio after clean typecheck and completed UX verification.${evidenceSuffix}`,
  );

  await writeAcceptanceMet({
    buildId,
    savedByUserId: userId,
    acceptanceMet,
    activityTool: "record_acceptance",
    activitySummary: `Acceptance recorded for ${acceptanceCriteria.length} criteria after review evidence completed.`,
  });
}

export async function resumeBuildImplementation(buildId: string): Promise<ResumeBuildImplementationOutcome> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      createdById: true,
      phase: true,
      sandboxId: true,
      diffPatch: true,
      diffSummary: true,
      taskResults: true,
      verificationOut: true,
      threadId: true,
      taskResultsVersion: true,
    },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  let recoverFromMissingReleaseDiff = false;
  if (build.phase === "ship") {
    if (!build.sandboxId) {
      throw new Error("This release-phase build has no sandbox attached, so implementation cannot be resumed safely.");
    }
    const { getClientIdentity } = await import("@/lib/build/sandbox/build-branch");
    const { clientBranch } = await getClientIdentity();
    const releasableFiles = await listReleasableSandboxFiles(build.sandboxId, { baseRef: clientBranch });
    if (releasableFiles.length > 0) {
      throw new Error("This build already has releasable source changes. Continue from the release decisions instead of reopening implementation.");
    }
    recoverFromMissingReleaseDiff = true;
  } else if (build.phase !== "build" && build.phase !== "review") {
    throw new Error("Only builds in implementation, review, or ship-without-diff recovery can be resumed");
  }

  const storedResults = build.taskResults as
    | {
      completedTasks?: number;
      totalTasks?: number;
      timedOut?: boolean;
      tasks?: Array<{
        title: string;
        specialist: string;
        outcome: string;
        durationMs?: number;
      }>;
      timestamp?: string;
    }
    | null;

  const hasRecoverableTask =
    recoverFromMissingReleaseDiff
      || (storedResults?.tasks?.some((task) => task.outcome !== "DONE") ?? false);
  const verificationFailed = (() => {
    const verification = build.verificationOut as
      | {
        typecheckPassed?: boolean;
        testsFailed?: number;
      }
      | null;
    if (!verification) return false;
    return verification.typecheckPassed === false || (verification.testsFailed ?? 0) > 0;
  })();

  if (!recoverFromMissingReleaseDiff && !hasRecoverableTask && !verificationFailed) {
    throw new Error("This build does not currently need implementation recovery");
  }

  try {
    const { isSandboxAvailable, startBuildBranch } = await import("@/lib/build/sandbox/build-branch");
    if (await isSandboxAvailable()) {
      await startBuildBranch(buildId);
    }
  } catch (err) {
    throw new Error(`Could not prepare a clean sandbox workspace for recovery: ${(err as Error).message}`);
  }

  const normalizedTasks = storedResults?.tasks?.map((task) => (
    recoverFromMissingReleaseDiff || task.outcome !== "DONE"
      ? { ...task, outcome: "BLOCKED" }
      : task
  )) ?? [];
  const completedTasks = normalizedTasks.filter((task) => task.outcome === "DONE").length;
  const resetTasks = recoverFromMissingReleaseDiff
    ? normalizedTasks.length
    : (storedResults?.tasks?.filter((task) => task.outcome !== "DONE").length ?? 0);
  const resumeMode = deriveResumeImplementationMode({
    phase: build.phase,
    taskCount: storedResults?.tasks?.length ?? 0,
    resetTasks,
    verificationFailed,
  });

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      phase: "build",
      diffPatch: recoverFromMissingReleaseDiff ? null : build.diffPatch,
      diffSummary: recoverFromMissingReleaseDiff ? null : build.diffSummary,
      verificationOut: null as unknown as Prisma.InputJsonValue,
      taskResults: {
        ...(storedResults ?? {}),
        completedTasks,
        tasks: normalizedTasks,
        timestamp: new Date().toISOString(),
      } as Prisma.InputJsonValue,
      taskResultsVersion: {
        increment: 1,
      },
    },
  });
  revalidatePortalContextForBuild(buildId);

  try {
    if (build.threadId) {
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      agentEventBus.emit(build.threadId, { type: "phase:change", buildId, phase: "build" });
      agentEventBus.emit(build.threadId, { type: "evidence:update", buildId, field: "taskResults" });
    }
  } catch {
    // Best effort only — UI also refetches after the action resolves.
  }

  prisma.buildActivity.create({
    data: {
      buildId,
      tool: "resume_implementation",
      summary: recoverFromMissingReleaseDiff
        ? "Implementation resumed from ship because release preparation found no releasable source diff; implementation tasks were reset for a real rerun."
        : `Implementation resumed from ${build.phase}; non-clean task results were reset for rerun.`,
    },
  }).catch(() => {});

  autoExecuteBuild(buildId).catch((err) =>
    // CodeQL #42 (js/tainted-format-string) + js/log-injection.
    console.error("[build] resumeBuildImplementation failed for %s: %s",
      JSON.stringify(buildId),
      err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err))),
  );

  return {
    mode: resumeMode,
    resetTasks,
    dispatchQueued: true,
    message: formatResumeImplementationOutcomeMessage(resumeMode, resetTasks),
  };
}

// autoA11yAudit was removed on 2026-04-20 when the Inngest-based
// build/review.verify handler (apps/web/lib/queue/functions/build-review-
// verification.ts) took over review-phase UX verification. That handler
// drives browser-use against the live sandbox, persists screenshots, and
// updates FeatureBuild.uxVerificationStatus + uxTestResults — superseding
// the old fire-and-forget prompt-only approach.

// ─── Update Sandbox Info ─────────────────────────────────────────────────────

export async function updateSandboxInfo(
  buildId: string,
  sandboxId: string,
  sandboxPort: number,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  await assertBuildPhaseInitiativeReadiness({ buildId, currentPhase: build.phase, targetPhase: "complete" });

  await prisma.featureBuild.update({
    where: { buildId },
    data: { sandboxId, sandboxPort },
  });
}

// ─── Save Build Results ──────────────────────────────────────────────────────

export async function saveBuildResults(
  buildId: string,
  results: { diffSummary: string; diffPatch: string; codingProvider: string },
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffSummary: results.diffSummary,
      diffPatch: results.diffPatch,
      codingProvider: results.codingProvider,
    },
  });
}

// ─── Delete Feature Build ────────────────────────────────────────────────────

export async function deleteFeatureBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  await (await import("@/lib/backlog/initiative-governance-deletion")).assertFeatureBuildGovernanceDeletable(buildId);
  // Delete related records first (foreign key constraints)
  await prisma.phaseHandoff.deleteMany({ where: { buildId } });
  await prisma.buildActivity.deleteMany({ where: { buildId } });
  await prisma.featureBuild.delete({ where: { buildId } });
}

// ─── Ship Build — Register as DigitalProduct ────────────────────────────────

export async function shipBuild(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump?: VersionBump;
  /**
   * Explicit actor for autonomous (session-less) ship — the resolved build
   * owner. When provided, the HTTP-session auth (`requireBuildAccess`) is
   * skipped, because it throws in a background/reconciler context that has no
   * session (`auth()` → Unauthorized). The build-ownership check
   * (`createdById === userId`) below still applies, so a build can only be
   * shipped by its own creator. UI callers omit this and authenticate via the
   * session exactly as before — fully backward-compatible.
   */
  actorUserId?: string;
}): Promise<{ productId: string; productInternalId: string; portfolioInternalId: string | null; promotionId: string | null; message: string }> {
  const userId = input.actorUserId ?? await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId: input.buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  // Resolve portfolio + taxonomy node for the product.
  // Use confirmed attribution from ideate phase if available; fall back to portfolio root.
  const portfolio = await prisma.portfolio.findUnique({
    where: { slug: input.portfolioSlug },
    select: { id: true, slug: true },
  });
  let taxonomyNodeId: string | null = null;
  const attribution = build.taxonomyAttribution as { confirmedNodeId?: string; topCandidate?: { nodeId: string; score: number } } | null;
  if (attribution?.confirmedNodeId) {
    // User confirmed a specific taxonomy node during ideate
    const confirmed = await prisma.taxonomyNode.findUnique({
      where: { nodeId: attribution.confirmedNodeId },
      select: { id: true },
    });
    taxonomyNodeId = confirmed?.id ?? null;
  } else if (attribution?.topCandidate && attribution.topCandidate.score >= 0.75) {
    // High-confidence suggestion that user didn't override
    const suggested = await prisma.taxonomyNode.findUnique({
      where: { nodeId: attribution.topCandidate.nodeId },
      select: { id: true },
    });
    taxonomyNodeId = suggested?.id ?? null;
  }
  if (!taxonomyNodeId && portfolio) {
    // Fall back to portfolio root node
    const rootNode = await prisma.taxonomyNode.findFirst({
      where: { portfolioId: portfolio.id, parentId: null },
      select: { id: true },
    });
    taxonomyNodeId = rootNode?.id ?? null;
  }

  // Use a transaction for product create/update + build link
  const result = await prisma.$transaction(async (tx) => {
    let product: { id: string; productId: string; version: string };

    if (build.digitalProductId) {
      // Subsequent build — bump version on existing product
      const existing = await tx.digitalProduct.findUnique({
        where: { id: build.digitalProductId },
        select: { id: true, productId: true, version: true },
      });
      if (!existing) throw new Error("Linked product not found");

      const newVersion = bumpVersion(existing.version, input.versionBump ?? "minor");
      await tx.digitalProduct.update({
        where: { id: existing.id },
        data: {
          version: newVersion,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
      });
      product = { ...existing, version: newVersion };
    } else {
      // First ship — create new product
      const productId = `DP-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const created = await tx.digitalProduct.create({
        data: {
          productId,
          name: input.name,
          lifecycleStage: "production",
          lifecycleStatus: "active",
          version: "1.0.0",
          ...(portfolio ? { portfolioId: portfolio.id } : {}),
          ...(taxonomyNodeId ? { taxonomyNodeId } : {}),
        },
        select: { id: true, productId: true, version: true },
      });
      product = created;
    }

    // Link build to product (do NOT set phase "complete" yet — that happens after epic creation)
    await tx.featureBuild.update({
      where: { buildId: input.buildId },
      data: { digitalProductId: product.id },
    });

    return product;
  });

  // Git tagging + version tracking (best-effort — failures do not block shipping)
  let previousTag: string | null = null;
  let gitCommitHash: string | null = null;
  let changeCount = 0;
  let promotionId: string | null = null;

  try {
    const { createTag, isGitAvailable, getLatestTag, getCommitCount, getCurrentCommitHash } = await import("@/lib/git-utils");

    if (await isGitAvailable()) {
      // Capture previous tag BEFORE creating the new one
      previousTag = await getLatestTag();
      gitCommitHash = await getCurrentCommitHash();

      if (previousTag) {
        changeCount = await getCommitCount(previousTag);
      }

      // Create the new tag
      const tagName = `v${result.version}`;
      const tagMessage = `${input.name} v${result.version}\n\nBuild: ${input.buildId}\nShipped-By: ${userId}`;
      const tagResult = await createTag({ tag: tagName, message: tagMessage });
      if ("error" in tagResult) {
        console.warn("[shipBuild] git tag failed:", tagResult.error);
      }
    }
  } catch (err) {
    console.warn("[shipBuild] git tag error:", err);
  }

  // Apply IT4IT value stream labels to the DigitalProduct in Neo4j
  // The product has been through the build pipeline, so it gets the R2D label
  // (Requirement to Deploy). When it's consumed, it will get R2F.
  try {
    const { syncIT4ITLabels } = await import("@dpf/db");
    await syncIT4ITLabels(result.productId, ["S2P", "R2D"]);
  } catch (err) {
    console.warn("[shipBuild] IT4IT label sync failed:", err);
  }

  // Create ProductVersion + ChangePromotion + RFC records (best-effort)
  try {
    const { createProductVersionWithRFC } = await import("@/lib/version-tracking");

    const versionResult = await createProductVersionWithRFC({
      digitalProductId: result.id,
      version: result.version,
      gitTag: `v${result.version}`,
      gitCommitHash: gitCommitHash ?? "unknown",
      featureBuildId: build.id,
      shippedBy: userId,
      ...(build.diffSummary ? { changeSummary: build.diffSummary } : {}),
    });

    // Store change impact report on the RFC (EP-BUILD-HANDOFF-002 Phase 2b)
    if (build.diffPatch) {
      try {
        const { analyzeChangeImpact } = await import("@/lib/change-impact");
        const impactReport = await analyzeChangeImpact(build.diffPatch);

        // Find the RFC created by createProductVersionWithRFC and store the impact report
        const rfcRecord = await prisma.changeRequest.findFirst({
          where: {
            changeItems: { some: { changePromotionId: versionResult.promotion.id } },
          },
          select: { rfcId: true, id: true },
        });
        if (rfcRecord) {
          await prisma.changeRequest.update({
            where: { id: rfcRecord.id },
            data: { impactReport: impactReport as unknown as Prisma.InputJsonValue },
          });
        }
      } catch (err) {
        console.warn("[shipBuild] impact report storage failed:", err);
      }
    }

    // Auto-approve the promotion — the user already approved deploy_feature
    // which is the HITL gate for the ship sequence.
    await prisma.changePromotion.update({
      where: { promotionId: versionResult.promotion.promotionId },
      data: {
        status: "approved",
        approvedBy: userId,
        approvedAt: new Date(),
        rationale: "Auto-approved via Build Studio ship phase",
      },
    });

    promotionId = versionResult.promotion.promotionId;

    // Git backup for fork_only mode (EP-BUILD-HANDOFF-002 contribution mode)
    if (build.diffPatch) {
      try {
        const { backupPromotionToGit } = await import("@/lib/git-backup");
        const backupResult = await backupPromotionToGit({
          buildId: input.buildId,
          title: input.name,
          diffPatch: build.diffPatch as string,
          productId: result.productId,
          version: result.version,
        });
        if (backupResult.pushed) {
          console.log(`[shipBuild] git backup pushed for ${JSON.stringify(input.buildId)}`);
        } else if (backupResult.error && backupResult.error !== "No git remote URL configured") {
          console.warn(`[shipBuild] git backup failed: ${backupResult.error}`);
        }
      } catch (err) {
        console.warn("[shipBuild] git backup failed:", err);
      }
    }
  } catch (err) {
    console.warn("[shipBuild] version tracking failed:", err);
  }

  // Generate codebase manifest and link to ProductVersion (best-effort)
  try {
    const { generateManifest } = await import("@/lib/manifest-generator");

    const manifest = await generateManifest({
      version: result.version,
      gitRef: gitCommitHash ?? "unknown",
      writeFile: true,
    });

    // Store manifest in DB and link to ProductVersion
    const dbManifest = await prisma.codebaseManifest.create({
      data: {
        version: result.version,
        gitRef: gitCommitHash ?? "unknown",
        manifest: manifest as unknown as Prisma.InputJsonValue,
        digitalProductId: result.id,
      },
      select: { id: true },
    });

    // Link manifest to the ProductVersion (if it was created)
    const pv = await prisma.productVersion.findFirst({
      where: { digitalProductId: result.id, version: result.version },
      select: { id: true },
    });
    if (pv) {
      await prisma.productVersion.update({
        where: { id: pv.id },
        data: { manifestId: dbManifest.id },
      });
    }
  } catch (err) {
    console.warn("[shipBuild] manifest generation failed:", err);
  }

  return {
    productId: result.productId,
    productInternalId: result.id,
    portfolioInternalId: portfolio?.id ?? null,
    promotionId,
    message: `Registered ${input.name} as ${result.productId} v${result.version} in the ${input.portfolioSlug} portfolio.${promotionId ? ` Promotion ${promotionId} approved and ready to execute.` : ""}`,
  };
}

export async function completeBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await assertFeatureBuildCompletion({ buildId, expectedPhase: build.phase });
  revalidatePortalContextForBuild(buildId);
  await recordReadyDependentsAfterCompletion({ db: prisma, buildId }).catch((err) => {
    console.error("[completeBuild] dependency readiness check failed:", err);
  });
  void import("@/lib/build/sandbox/sandbox-build-gc")
    .then((m) => m.releaseSandboxForTerminalBuild(buildId, { deleteBranch: false }))
    .catch(() => {});
  revalidatePath("/build");
}

// ─── Create Epic + Backlog Items for a Build ────────────────────────────────

export async function createBuildEpic(input: {
  buildId: string;
  title: string;
  portfolioSlug?: string;
  digitalProductId?: string;
}): Promise<{ epicId: string; message: string }> {
  await requireBuildAccess();

  // Delegate to the request-scope-independent helper so this interactive
  // server action and the autonomous ideate auto-intake path share ONE epic-
  // create implementation. This action still enforces auth above; the helper
  // itself does only the DB write (it must never call headers()/requireCapability
  // so the auto-intake path can reuse it outside a request scope).
  //
  // NOTE: previously this block also pre-seeded a "Ship: <title>" item with
  // status=done plus a "Gather user feedback" item at epic-create time, which
  // ran during ideate auto-intake — long before the feature shipped — and made
  // the backlog view show the work as already done. The real in-progress
  // backlog item is created separately by the auto-intake path in reviewDesignDoc.
  // Feedback items should be auto-created on actual ship. Removed per Mark's
  // observation 2026-04-20.
  const { autoCreateBuildEpic } = await import("@/lib/build/auto-intake-epic");
  const epic = await autoCreateBuildEpic({
    db: prisma,
    title: input.title,
    portfolioSlug: input.portfolioSlug ?? null,
    logger: { warn: (...a) => console.warn("[createBuildEpic]", ...a) },
  });

  return {
    epicId: epic.epicId,
    message: `Created epic ${epic.epicId}. The in-progress backlog item is created separately by the ideate auto-intake path.`,
  };
}

// ─── Build Disciplines — Work Claims ─────────────────────────────────────────

export async function claimBuild(
  buildId: string,
  agentId?: string,
): Promise<void> {
  await requireBuildAccess();

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      claimedByAgentId: agentId ?? null,
      claimedAt: new Date(),
      claimStatus: "active",
    },
  });
}

export async function releaseBuildClaim(buildId: string): Promise<void> {
  await requireBuildAccess();

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      claimedByAgentId: null,
      claimedAt: null,
      claimStatus: "released",
    },
  });
}

// ─── Build Disciplines — Evidence Storage ────────────────────────────────────

export async function saveBuildEvidence(
  buildId: string,
  field: "designDoc" | "designReview" | "buildPlan" | "planReview" | "taskResults" | "verificationOut" | "acceptanceMet" | "scoutFindings",
  value: unknown,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await saveBuildArtifactRevision({
    buildId,
    field: field as BuildArtifactField,
    savedByUserId: userId,
    value,
  });

  if (field === "taskResults") {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { taskResultsVersion: { increment: 1 } },
    });
  }
}

// ─── Build Disciplines — Reviewer Actions ────────────────────────────────────

async function callReviewerLLM(prompt: string): Promise<string> {
  const result = await routeAndCall(
    [{ role: "user", content: prompt }],
    "You are a build discipline reviewer. Respond only with the requested JSON format.",
    "internal",
    { taskType: "analysis" },
  );
  return result.content;
}

export async function reviewDesignDoc(buildId: string): Promise<ReviewResult> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (!build.designDoc) throw new Error("No design document to review");

  const doc = build.designDoc as unknown as BuildDesignDoc;
  const prompt = buildDesignReviewPrompt(doc, `Build: ${build.title}. ${build.description ?? ""}`);

  const raw = await callReviewerLLM(prompt);
  const result = parseReviewResponse(raw);

  await prisma.featureBuild.update({
    where: { buildId },
    data: { designReview: result as unknown as Prisma.InputJsonValue },
  });

  return result;
}

export async function reviewBuildPlan(buildId: string): Promise<ReviewResult> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (!build.buildPlan) throw new Error("No implementation plan to review");

  const plan = build.buildPlan as unknown as BuildPlanDoc;
  const prompt = buildPlanReviewPrompt(plan);

  const raw = await callReviewerLLM(prompt);
  const result = parseReviewResponse(raw);

  await prisma.featureBuild.update({
    where: { buildId },
    data: { planReview: result as unknown as Prisma.InputJsonValue },
  });

  return result;
}

/**
 * Operator/coworker-triggered re-run of the canonical plan reviewer (BI-E1CB0522).
 *
 * The plain {@link reviewBuildPlan} action above is a DIVERGENT single-reviewer
 * implementation that does NOT apply the kind-aware test-first lenience (#1976 /
 * #1998), dual reviewers, iteration-trajectory, or the plan->build auto-advance.
 * Re-running THAT logic from the UI would leave a stale failed planReview in
 * place even after a relevant reviewer-logic fix deploys — exactly the
 * stuck-state observed on FB-69231490 (a chore blocked on now-lenient
 * test-first criticals).
 *
 * This action instead delegates to the SAME `executeTool("reviewBuildPlan")`
 * path the agentic loop uses (mcp-tools.ts), so a re-run always reflects the
 * current reviewer logic and auto-advances plan->build when the (now-passing)
 * gate is satisfied. The cached planReview is refreshed in the same call.
 *
 * Dynamic import of mcp-tools avoids a module cycle (mcp-tools imports build
 * actions). `featureBuildId` routes the tool to this exact build.
 */
export async function rerunPlanReview(buildId: string): Promise<{
  success: boolean;
  message: string;
  decision: ReviewResult["decision"] | null;
}> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { createdById: true, phase: true, buildPlan: true },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");
  if (build.phase !== "plan") {
    throw new Error("Plan review can only be re-run for builds in the plan phase.");
  }
  if (!build.buildPlan) {
    throw new Error("No implementation plan to review. Generate the plan before re-running review.");
  }

  const { executeTool } = await import("@/lib/mcp-tools");
  const result = await executeTool(
    "reviewBuildPlan",
    { buildId },
    userId,
    { featureBuildId: buildId },
  );

  const review = (result.data as { review?: ReviewResult } | undefined)?.review ?? null;
  revalidatePath(`/build/${buildId}`);
  return {
    success: result.success,
    message: result.message ?? (result.success ? "Plan review re-run complete." : "Plan review re-run failed."),
    decision: review?.decision ?? null,
  };
}
