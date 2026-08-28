// apps/web/lib/build/ideate-on-approval.ts
//
// Auto-dispatch the Ideate-phase design-doc research when an operator approves
// the start of a backlog-promoted Build Studio draft.
//
// Why this exists:
//   approveBuildStart() (apps/web/lib/actions/build.ts) only sets draftApprovedAt
//   and writes a BuildActivity row. It does NOT trigger the design-doc agent.
//   The dispatchIdeateResearch helper in ./ideate-dispatch.ts is wired to a flag
//   (buildExecState.ideateResearchRequested) that is only set from inside the
//   agentic coworker loop — which means the operator must open the build's chat
//   panel and have a conversation before any agent work begins.
//
//   For backlog-promoted drafts, the BacklogItem.title + body already contain
//   the problem statement and acceptance criteria. The conversation step is
//   unnecessary friction. Without this auto-dispatch, every backlog-promoted
//   build sits forever at "Ready for Planning / A design document is required
//   before planning" until the operator manually engages the coworker chat.
//
// Behavior:
//   - Fire-and-forget invocation from approveBuildStart so the operator's
//     approval click returns immediately.
//   - Idempotent: skip if the build already has a non-empty designDoc.
//   - Only runs for backlog-promoted drafts (originatingBacklogItemId set).
//   - Logs an "ideate_dispatch" BuildActivity row on each exit path so the
//     dispatch is observable in the build UI alongside approve_start.
//   - Catches all errors — never throws into the calling startTransition.
//
// Maps to commandment-tier kernel principle:
//   `structural-verification-is-not-functional` — the approve_start activity
//   was a structural success that produced no functional truth. This wires
//   the structural success to the functional dispatch.

import { prisma } from "@dpf/db";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { classifyRetrySafePreDispatchFailure } from "./build-engine-selection";
import { formatBuildEngineSelectionEvidence } from "./build-engine-selection-runtime";

type DispatchOutcome =
  | { kind: "skipped-no-bi"; reason: string }
  | { kind: "skipped-already-has-design"; reason: string }
  | { kind: "skipped-no-provider"; reason: string }
  | { kind: "dispatched-success"; designDocKeys: string[]; durationMs: number }
  | { kind: "dispatched-failure"; error: string; durationMs: number };

/**
 * Auto-dispatch Ideate-phase design-doc research for an approved backlog-promoted
 * draft. Designed to be called fire-and-forget from approveBuildStart; never
 * throws. All exit paths log a BuildActivity row tagged "ideate_dispatch".
 *
 * @param buildId  FB-* semantic build id
 * @param userId   the approving user — used as the actor for the saveBuildEvidence call
 */
export async function dispatchIdeateForApprovedBuild(params: {
  buildId: string;
  userId: string;
  /** Design-review fix loop: prior reviewer issues appended to the research
   *  context so the regenerated designDoc addresses them. Setting this also
   *  bypasses the idempotency guard (we WANT to overwrite the rejected doc). */
  priorReviewFeedback?: string;
  /** Explicit operator/coworker re-request context from start_ideate_research. */
  requestedUserContext?: string;
  requestedReusabilityScope?: string;
  /** Bypass the designDoc idempotency guard (a fix-loop regeneration). */
  forceRegenerate?: boolean;
}): Promise<DispatchOutcome> {
  const {
    buildId,
    userId,
    priorReviewFeedback,
    requestedUserContext,
    requestedReusabilityScope,
    forceRegenerate = false,
  } = params;

  const logActivity = async (summary: string): Promise<void> => {
    await prisma.buildActivity.create({
      data: { buildId, tool: "ideate_dispatch", summary },
    }).catch((err) => {
      console.warn("[ideate-on-approval] Failed to log BuildActivity:", { buildId, summary }, err);
    });
  };

  /**
   * BI-7AD0759A — keep a bounded excerpt of what the model actually said when its
   * output could not be parsed into a design document.
   *
   * Head AND tail are retained: a truncated or unterminated object shows its
   * shape at both ends, and the tail is usually where it died. An empty response
   * is recorded as such, because "the model returned nothing" is a different
   * diagnosis from "the model returned prose".
   */
  const recordIdeateOutputExcerpt = async (rawOutput: string | undefined): Promise<void> => {
    const { describeIdeateOutput } = await import("./ideate-output-excerpt");
    const summary = describeIdeateOutput(rawOutput);
    await prisma.buildActivity.create({
      data: { buildId, tool: "ideate_output_excerpt", summary },
    }).catch((err) => {
      console.warn("[ideate-on-approval] Failed to log ideate_output_excerpt:", { buildId }, err);
    });
  };

  /** BI-CE1AB982 — durable "refused before start" marker read by progress-visibility. */
  const recordDispatchBlocked = async (reason: string): Promise<void> => {
    await prisma.buildActivity.create({
      data: { buildId, tool: "dispatch_blocked", summary: reason },
    }).catch((err) => {
      console.warn("[ideate-on-approval] Failed to log dispatch_blocked:", { buildId, reason }, err);
    });
  };

  try {
    // Fetch the build with the linked BI and current designDoc evidence.
    // NOTE: businessContext is intentionally NOT selected here — it is not a
    // field on the FeatureBuild Prisma model. PR #947 originally selected it,
    // which threw a PrismaClientValidationError on every approve_start and was
    // silently swallowed by the catch below, leaving every backlog-promoted
    // build stuck at the post-approval gate with no Ideate work ever firing.
    // If a future change adds businessContext (or sources it from BacklogItem),
    // re-introduce it via a separate join rather than as a phantom select field.
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: {
        originatingBacklogItemId: true,
        designDoc: true,
        title: true,
        description: true,
        planReview: true,
        deliberationSummary: true,
      },
    });

    if (!build || !build.originatingBacklogItemId) {
      const outcome: DispatchOutcome = {
        kind: "skipped-no-bi",
        reason: "Build is not backlog-promoted (originatingBacklogItemId is null) — auto-dispatch only fires for backlog-promoted drafts.",
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      return outcome;
    }

    // Idempotency guard: skip if a non-empty designDoc already exists.
    // designDoc shape is BuildDesignDoc | null; we treat presence of a
    // non-empty problemStatement as "real evidence already saved".
    const existingDesignDoc = build.designDoc as { problemStatement?: string } | null;
    const skipIdempotent = !forceRegenerate && !priorReviewFeedback && !requestedUserContext;
    if (skipIdempotent && existingDesignDoc && typeof existingDesignDoc.problemStatement === "string" && existingDesignDoc.problemStatement.trim().length > 0) {
      const outcome: DispatchOutcome = {
        kind: "skipped-already-has-design",
        reason: "Build already has a designDoc with a non-empty problemStatement — skipping re-dispatch to preserve existing evidence.",
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      return outcome;
    }

    // Fetch the BI title + body for the research context.
    //
    // 2026-05-24: FeatureBuild.originatingBacklogItemId is a FK to BacklogItem.id
    // (the cuid PK), not BacklogItem.itemId (the semantic BI-XXXXX). PR #947
    // looked up by itemId here, which always missed because the FK stores the
    // cuid value. The dispatch then short-circuited with `skipped-no-bi` and
    // a "data inconsistency" message — masking a code bug as data corruption.
    // Live evidence captured during FB-B77B8CC4 smoke test 2026-05-24.
    // Same mock-faked-the-schema class of failure as the businessContext bug
    // that PR #1030 fixed in this same file.
    const bi = await prisma.backlogItem.findUnique({
      where: { id: build.originatingBacklogItemId },
      select: { title: true, body: true, effortSize: true, workType: true },
    });

    if (!bi) {
      const outcome: DispatchOutcome = {
        kind: "skipped-no-bi",
        reason: `originatingBacklogItemId ${build.originatingBacklogItemId} did not resolve to a BacklogItem row — data inconsistency.`,
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      return outcome;
    }

    const { getModelTier, deriveDeliverableSensitivity } = await import("@/lib/explore/build-process-matrix");
    const {
      getBuildStudioConfig,
      isModelTierRoutingEnabled,
      isQualityFirstRightsizingEnabled,
    } = await import("@/lib/build/build-studio-config");
    const deliverableSensitivity = deriveDeliverableSensitivity({
      text: `${bi.title}\n${bi.body ?? ""}`,
      workType: bi.workType,
    });
    // BI-B24D4C84: pass the rightsizing opts, as the autonomous callers already
    // do. Without them getModelTier fell through to the legacy size-only branch
    // (`large|xlarge ? robust : local`), so EVERY small/medium item was pinned to
    // the local tier — which forces residencyPolicy=local_only downstream and
    // excluded every cloud engine. Quality-first is ON by default and routes
    // substantive work to `robust`, keeping local for the trivial doc/chore tail.
    const modelTier = (await isModelTierRoutingEnabled())
      ? getModelTier(bi.workType, bi.effortSize, {
          qualityFirst: await isQualityFirstRightsizingEnabled(),
          sensitivity: deliverableSensitivity,
        })
      : undefined;
    const routingSensitivity = deliverableSensitivity === "high" ? "confidential" as const : "internal" as const;

    // Resolve the same task-qualified selection used by model-selection preview
    // and actual dispatch. A blocked result stops before phase work with one action.
    const config = await getBuildStudioConfig({ modelTier, sensitivity: routingSensitivity });
    const selection = config.selection;
    if (!selection || selection.status === "blocked" || !selection.selected) {
      const outcome: DispatchOutcome = {
        kind: "skipped-no-provider",
        reason: selection?.action ?? "No allowed healthy Build Studio engine remains. Review AI Readiness and retry.",
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      // BI-CE1AB982: the line above is the ONLY trace a refused dispatch used to
      // leave, and nothing on the owner surface reads `ideate_dispatch` prose —
      // so the panel kept animating "Build Studio is working on this change" on a
      // build that never started. This row is the durable, queryable signal the
      // progress projection reads to render the build as blocked instead.
      await recordDispatchBlocked(outcome.reason);
      return outcome;
    }
    await logActivity(formatBuildEngineSelectionEvidence(selection));

    let executionProfileRef: import(
      "@/lib/build/autonomous-build-eligibility-reader"
    ).AutonomousBuildExecutionProfileRefV1 | null = null;
    const { getAutonomousPlaybookMode } = await import(
      "@/lib/build/build-studio-config"
    );
    const autonomousMode = getAutonomousPlaybookMode();
    if (autonomousMode !== "off") {
      try {
        const { evaluateBuildStudioIdeateStartGate } = await import(
          "@/lib/decision-perspective/build-studio-ship-gate"
        );
        const gate = await evaluateBuildStudioIdeateStartGate({
          db: prisma,
          build: {
            buildId,
            planReview: build.planReview as Parameters<
              typeof evaluateBuildStudioIdeateStartGate
            >[0]["build"]["planReview"],
            deliberationSummary: build.deliberationSummary as Parameters<
              typeof evaluateBuildStudioIdeateStartGate
            >[0]["build"]["deliberationSummary"],
          },
          sensitivity: deliverableSensitivity,
          triggeredByUserId: userId,
        });
        if (!gate.allowed && autonomousMode === "enforce") {
          await logActivity(
            gate.operatorMessage
            || "Needs your decision before governed design work can begin.",
          );
          return {
            kind: "dispatched-failure",
            error: gate.operatorMessage || "graduated ideate gate withheld",
            durationMs: 0,
          };
        }
        const { resolveAutonomousBuildPhaseEligibility } = await import(
          "@/lib/build/autonomous-build-phase-runtime"
        );
        const autonomy = await resolveAutonomousBuildPhaseEligibility({
          buildId,
          checkpoint: "ideate",
          gateOutcome: gate.evaluation.outcomeType,
          sensitivityOverride: deliverableSensitivity,
        });
        executionProfileRef = autonomy.executionProfileRef;
        if (autonomousMode === "enforce" && !autonomy.mayAct) {
          const reason =
            autonomy.eligibility.blockers.join(", ")
            || "autonomous ideate start is not evidence-cleared";
          await logActivity(`Needs your decision: ${reason}.`);
          return {
            kind: "dispatched-failure",
            error: reason,
            durationMs: 0,
          };
        }
      } catch (error) {
        if (autonomousMode === "enforce") {
          const reason = `autonomous ideate gate unavailable: ${String(
            error instanceof Error ? error.message : error,
          ).slice(0, 180)}`;
          await logActivity(`Needs your decision: ${reason}.`);
          return { kind: "dispatched-failure", error: reason, durationMs: 0 };
        }
      }
    }
    try {
      const { startBuildPhaseRun } = await import("./build-phase-run");
      void startBuildPhaseRun(buildId, "ideate", {
        ...(executionProfileRef ? { executionProfileRef } : {}),
      }).catch(() => {});
    } catch {
      /* phase attribution remains best-effort */
    }

    // The BI body is the canonical context for backlog-promoted drafts.
    // It typically contains problem statement, acceptance criteria, and
    // architectural notes — exactly what the research prompt needs.
    const featureTitle = bi.title || build.title || "Untitled Feature";
    const featureDescription = bi.body || build.description || "";
    // BI body is the operator-authored context; on a fix-loop regeneration we
    // append the reviewer's prior issues so the revised design addresses them.
    const userContext = [
      bi.body || "",
      priorReviewFeedback ?? "",
      requestedUserContext ? `Operator requested another ideate pass:\n${requestedUserContext}` : "",
    ].filter((part) => part.trim().length > 0).join("\n\n");

    const startedAt = Date.now();

    const { dispatchIdeateResearch } = await import("./ideate-dispatch");
    const attemptCandidates = [selection.selected, ...selection.fallbackChain.slice(0, 1)];
    let ideateResult: Awaited<ReturnType<typeof dispatchIdeateResearch>> | null = null;
    let resolvedAttempt = selection.selected;
    for (let attemptIndex = 0; attemptIndex < attemptCandidates.length; attemptIndex += 1) {
      const attempt = attemptCandidates[attemptIndex]!;
      resolvedAttempt = attempt;
      await logActivity(
        `${attemptIndex === 0 ? "Dispatching" : "Retrying"} ideate research via ${attempt.engine} `
        + `(provider=${attempt.providerId}, model=${attempt.modelId || "default"})`,
      );
      ideateResult = await dispatchIdeateResearch({
        buildId,
        featureTitle,
        featureDescription,
        reusabilityScope: requestedReusabilityScope || "parameterizable",
        userContext,
        businessContext: undefined,
        providerId: attempt.providerId,
        model: attempt.modelId ?? undefined,
        dispatchEngine: attempt.engine,
        modelTier,
        sensitivity: routingSensitivity,
      });
      if (ideateResult.success) break;
      const retryClass = classifyRetrySafePreDispatchFailure({
        message: ideateResult.error ?? "",
        durationMs: ideateResult.durationMs,
      });
      const next = attemptCandidates[attemptIndex + 1];
      if (!retryClass || !next || selection.fallbackDisabled) break;
      await logActivity(
        `Ideate ${attempt.engine} ${retryClass} failure occurred before phase side effects; `
        + `falling back once to ${next.engine} (provider=${next.providerId}).`,
      );
    }
    if (!ideateResult) {
      throw new Error("Build engine selection returned no Ideate dispatch attempt.");
    }

    const durationMs = Date.now() - startedAt;

    if (!ideateResult.success || !ideateResult.designDoc) {
      const outcome: DispatchOutcome = {
        kind: "dispatched-failure",
        error: ideateResult.error ?? "Ideate research returned no designDoc",
        durationMs,
      };
      await logActivity(`Auto-dispatch failed after ${(durationMs / 1000).toFixed(1)}s: ${outcome.error.slice(0, 200)}`);
      // BI-7AD0759A: the model's output is the ONLY thing that explains why it
      // could not be parsed, and it was being dropped on the floor here — on a
      // local-only install that leaves the operator a four-minute wait and a
      // fixed sentence. Keep a bounded excerpt as evidence.
      await recordIdeateOutputExcerpt(ideateResult.rawOutput);
      return outcome;
    }
    if (executionProfileRef) {
      const { stampBuildPhaseExecutionProfile } = await import(
        "./build-phase-run"
      );
      executionProfileRef = {
        ...executionProfileRef,
        providerId: resolvedAttempt.providerId,
        modelId: resolvedAttempt.modelId,
      };
      await stampBuildPhaseExecutionProfile(
        buildId,
        "ideate",
        executionProfileRef,
      );
    }

    // Persist via the same code path the agentic coworker uses, so the
    // saveBuildEvidence audit trail is consistent regardless of which
    // dispatch path produced the designDoc.
    const { executeTool } = await import("@/lib/mcp-tools");
    // Pass the explicit buildId. Without it, saveBuildEvidence falls back to
    // resolveActiveBuildId(userId), which resolves to the user's *active* build
    // — and when several builds are in flight that can be a DIFFERENT build.
    // The designDoc would then persist to the wrong build while this build's
    // activity log (correct buildId in scope) records "saved", leaving this
    // build stuck at the post-ideate gate with no design doc.
    const saveResult = await executeTool(
      "saveBuildEvidence",
      { buildId, field: "designDoc", value: ideateResult.designDoc },
      userId,
      {},
    );

    if (!saveResult.success) {
      const outcome: DispatchOutcome = {
        kind: "dispatched-failure",
        error: `saveBuildEvidence rejected the designDoc: ${saveResult.message || saveResult.error || "(no message)"}`,
        durationMs,
      };
      await logActivity(`Auto-dispatch saved-evidence step failed after ${(durationMs / 1000).toFixed(1)}s: ${outcome.error.slice(0, 200)}`);
      return outcome;
    }

    // Read-after-write: saveBuildEvidence reported success, but verify the
    // designDoc actually landed on THIS build before logging "saved". Guards
    // against a silent wrong-build / no-op write reporting success — the
    // `structural-verification-is-not-functional` principle this file's header
    // cites, applied to the save itself.
    const persisted = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { designDoc: true },
    });
    const persistedDoc = persisted?.designDoc as { problemStatement?: string } | null;
    if (
      !persistedDoc ||
      typeof persistedDoc.problemStatement !== "string" ||
      persistedDoc.problemStatement.trim().length === 0
    ) {
      const outcome: DispatchOutcome = {
        kind: "dispatched-failure",
        error: `saveBuildEvidence reported success but no designDoc is present on ${buildId} after the write (possible active-build mis-resolution).`,
        durationMs,
      };
      await logActivity(`Auto-dispatch saved-evidence VERIFICATION FAILED after ${(durationMs / 1000).toFixed(1)}s: designDoc not present on ${buildId} after save.`);
      return outcome;
    }

    // BI-F8C5E01C — research-before-spec: for a right-size-triggered feature,
    // run an external cited deep-research pass and attach it to the ideate
    // evidence trail. Opt-in (DPF_BUILD_PRE_SPEC_RESEARCH) and strictly
    // fail-open — research is advisory and must NEVER fail or delay ideate.
    // The flag is resolved OUTSIDE the try so a disabled/unavailable config does
    // NO work and writes NO activity row (keeps the ideate evidence trail exact
    // when the feature is off — the default).
    let preSpecResearchEnabled = false;
    try {
      const { isPreSpecResearchEnabled } = await import("./build-studio-config");
      preSpecResearchEnabled = isPreSpecResearchEnabled();
    } catch {
      preSpecResearchEnabled = false;
    }
    if (preSpecResearchEnabled) {
      try {
        const { shouldRunPreSpecResearch, conductPreSpecResearch, formatResearchReportMarkdown, makeInferenceResearchDeps } =
          await import("@/lib/build/pre-spec-research");
        const { deriveDeliverableSensitivity } = await import("@/lib/explore/build-process-matrix");
        const sensitivity = deriveDeliverableSensitivity({ text: `${featureTitle}\n${featureDescription}`, workType: bi.workType });
        if (shouldRunPreSpecResearch({ workType: bi.workType, effortSize: bi.effortSize, sensitivity })) {
          const { searchPublicWeb, fetchPublicWebsiteEvidence } = await import("@/lib/public-web-tools");
          const { routeAndCall } = await import("@/lib/routed-inference");
          const deps = makeInferenceResearchDeps({
            llm: async (p) => (await routeAndCall([{ role: "user" as const, content: p }], "You are a research assistant. Follow the output format exactly.", "internal", { budgetClass: "minimize_cost" })).content,
            search: async (q) => (await searchPublicWeb(q)).map((r) => ({ title: r.title, url: r.url, description: r.snippet })),
            fetchSource: async (u) => { const e = await fetchPublicWebsiteEvidence(u); return { title: e.title, textExcerpt: e.textExcerpt }; },
          });
          const report = await conductPreSpecResearch(`${featureTitle}: ${featureDescription}`.slice(0, 400), deps);
          await logActivity(`Pre-spec research (advisory, cited):\n${formatResearchReportMarkdown(report)}`);
        }
      } catch (researchErr) {
        // Advisory — swallow and continue; ideate must not depend on research.
        const { getErrorMessage } = await import("@/lib/shared/get-error-message");
        await logActivity(`Pre-spec research skipped (non-fatal): ${getErrorMessage(researchErr)}`);
      }
    }

    const designDocKeys = Object.keys(ideateResult.designDoc as Record<string, unknown>);
    const outcome: DispatchOutcome = {
      kind: "dispatched-success",
      designDocKeys,
      durationMs,
    };
    await logActivity(`Auto-dispatched and saved designDoc in ${(durationMs / 1000).toFixed(1)}s (fields: ${designDocKeys.slice(0, 8).join(", ")})`);

    // Auto-advance the happy path: run the design review now so the build moves
    // ideate -> plan immediately instead of stranding at ideate until the 20-min
    // stranded-build reconciler heals it. That stall is the autonomous-flow
    // throughput gap — a backlog cannot drain if every build waits ~20 min at
    // each pre-build handoff for the reconciler. Once the design review passes,
    // the plan phase auto-chains on its own (dispatch plan -> reviewBuildPlan ->
    // build), so this single missing link is all that blocks end-to-end
    // hands-off progress (verified live: a one-shot reviewDesignDoc nudge drove a
    // stalled build ideate -> plan -> build automatically).
    //
    // reviewDesignDoc is gate-aware (it correctly PARKS a `decompose-required`
    // design rather than advancing it), so this never bulldozes the
    // decomposition gate. Skipped on a fix-loop regeneration (priorReviewFeedback
    // set): dispatchDesignReviewFixLoop runs the review itself, so auto-reviewing
    // here would double-review. Best-effort — a review hiccup must not fail the
    // fire-and-forget ideate dispatch; the reconciler/fix-loop stays the backstop.
    if (!priorReviewFeedback) {
      try {
        const { executeTool } = await import("@/lib/mcp-tools");
        await executeTool("reviewDesignDoc", { buildId }, userId, { featureBuildId: buildId });
      } catch (err) {
        await logActivity(
          `Auto design-review after ideate did not complete: ${String(err instanceof Error ? err.message : err).slice(0, 160)} — stranded-build reconciler will retry.`,
        );
      }
    }
    return outcome;

  } catch (err) {
    // Belt-and-braces: never let an unexpected throw bubble out of a
    // fire-and-forget helper. Log and return a structured failure.
    const message = getErrorMessage(err);
    console.error("[ideate-on-approval] Unhandled error in auto-dispatch:", { buildId }, err);
    await logActivity(`Auto-dispatch threw unexpectedly: ${message.slice(0, 200)}`);
    return { kind: "dispatched-failure", error: message, durationMs: 0 };
  }
}

/**
 * BI-3E0EE3BA — true when an approved Ideate draft still has no real designDoc,
 * i.e. its auto-dispatch never fired (the dead-on-arrival pattern). Pure +
 * unit-tested. Mirrors the idempotency guard inside dispatchIdeateForApprovedBuild
 * so a build it would skip is never counted as "needs dispatch".
 */
export function buildNeedsIdeateDispatch(designDoc: unknown): boolean {
  const dd = designDoc as { problemStatement?: unknown } | null;
  return !(
    dd &&
    typeof dd.problemStatement === "string" &&
    dd.problemStatement.trim().length > 0
  );
}

export function getIdeateResearchRequest(buildExecState: unknown): {
  requested: boolean;
  userContext?: string;
  reusabilityScope?: string;
} {
  if (!buildExecState || typeof buildExecState !== "object" || Array.isArray(buildExecState)) {
    return { requested: false };
  }
  const state = buildExecState as Record<string, unknown>;
  if (state.ideateResearchRequested !== true) return { requested: false };
  return {
    requested: true,
    userContext: typeof state.userContext === "string" ? state.userContext : undefined,
    reusabilityScope: typeof state.reusabilityScope === "string" ? state.reusabilityScope : undefined,
  };
}

async function clearIdeateResearchRequest(buildId: string, buildExecState: unknown): Promise<void> {
  const state =
    buildExecState && typeof buildExecState === "object" && !Array.isArray(buildExecState)
      ? { ...(buildExecState as Record<string, unknown>) }
      : {};
  state.ideateResearchRequested = false;
  await prisma.featureBuild.update({
    where: { buildId },
    data: { buildExecState: state as unknown as import("@dpf/db").Prisma.InputJsonValue },
  }).catch((err) => {
    console.warn("[ideate-on-approval] Failed to clear ideateResearchRequested:", { buildId }, err);
  });
}

/**
 * BI-3E0EE3BA — recover/auto-drive Ideate for backlog-promoted drafts that were
 * auto-approved (draftApprovedAt set by the governed tee-up) but never had their
 * Ideate research fired. The ONLY caller of dispatchIdeateForApprovedBuild was
 * the operator's "Approve Start" UI click, which an auto-promoted build never
 * receives — so those drafts sit in `ideate` forever with no designDoc, jamming
 * the WIP cap (and the inert-build reaper won't touch them: the auto-approve
 * wrote an `approve_start` activity, so they aren't "inert"). This finds every
 * approved-but-undriven draft and fires the idempotent, never-throwing dispatch:
 * it clears the existing dead-on-arrival builds AND completes the autopilot path
 * for builds the same tee-up run just promoted. Bounded per invocation so a cron
 * step stays short; the next run drains any remainder. Call after the tee-up.
 */
export async function dispatchApprovedIdeateBuilds(params: {
  userId: string;
  limit?: number;
}): Promise<{ candidates: number; dispatched: number; skipped: number }> {
  const { userId, limit = 5 } = params;
  // Fetch a window of approved ideate drafts, then filter in app code (avoids
  // Prisma JSON-null predicate quirks) to those genuinely missing a designDoc.
  const approved = await prisma.featureBuild.findMany({
    where: {
      phase: "ideate",
      draftApprovedAt: { not: null },
      abandonedAt: null,
      parentEpicId: null,
      originatingBacklogItemId: { not: null },
    },
    select: { buildId: true, designDoc: true, buildExecState: true },
    orderBy: { draftApprovedAt: "asc" },
    take: 50,
  });
  const pending = approved
    .filter((b) => buildNeedsIdeateDispatch(b.designDoc) || getIdeateResearchRequest(b.buildExecState).requested)
    .slice(0, limit);

  let dispatched = 0;
  let skipped = 0;
  for (const b of pending) {
    const request = getIdeateResearchRequest(b.buildExecState);
    // dispatchIdeateForApprovedBuild never throws and is idempotent.
    const outcome = await dispatchIdeateForApprovedBuild({
      buildId: b.buildId,
      userId,
      forceRegenerate: request.requested,
      requestedUserContext: request.userContext,
      requestedReusabilityScope: request.reusabilityScope,
    });
    if (request.requested) {
      await clearIdeateResearchRequest(b.buildId, b.buildExecState);
    }
    if (outcome.kind === "dispatched-success") dispatched += 1;
    else skipped += 1;
  }
  return { candidates: pending.length, dispatched, skipped };
}

/** Bounded rounds for the design-review fix loop. Operator-tunable. */
export const DESIGN_FIX_MAX_ROUNDS = Number(process.env.DESIGN_FIX_MAX_ROUNDS) || 2;

/** Bounded re-reviews when the reviewers themselves cannot return a verdict
 *  (BI-D33F968A). Separate from the fix rounds: these attempts are not repairs. */
export const DESIGN_REVIEW_RETRY_LIMIT = Number(process.env.DESIGN_REVIEW_RETRY_LIMIT) || 2;

type DesignReviewVerdict =
  | { decision?: string; issues?: Array<{ severity: string; description: string }> }
  | null;

/**
 * Design-review verification→fix loop — the ideate-phase analog of the
 * BI-99B06AD1 plan loop. When a FEATURE build's designDoc FAILS review (e.g.
 * "fails to address critical security / input-validation / audit-logging" — the
 * local model under-weighting cross-cutting concerns), regenerate the designDoc
 * with the reviewer's issues fed back, re-review, repeat up to N rounds, then
 * escalate-to-human — instead of the build re-failing the same review on every
 * resume forever (the live ideate jam).
 *
 * Scoped to feature builds: a `kind=fix` build's "Incomplete fix diagnosis"
 * failure is a missing fixContext (reproduction/root-cause/fix-approach), which
 * regenerating the designDoc does NOT populate — so those escalate directly
 * rather than churn the loop. Never throws.
 */
export async function dispatchDesignReviewFixLoop(params: {
  buildId: string;
  userId: string;
}): Promise<{ kind: string; rounds: number }> {
  const { buildId, userId } = params;
  const log = (s: string) =>
    prisma.buildActivity
      .create({ data: { buildId, tool: "design_fix_loop", summary: s.slice(0, 240) } })
      .then(() => {})
      .catch(() => {});

  const escalate = async (build: { id: string; title: string; originatingBacklogItemId: string | null }, review: DesignReviewVerdict, rounds: number) => {
    const { escalateBuildToHuman, SELF_FIX_CLASS } = await import("@/lib/build/escalate-build-to-human");
    let biTitle: string | null = null;
    if (build.originatingBacklogItemId) {
      biTitle = (await prisma.backlogItem
        .findUnique({ where: { id: build.originatingBacklogItemId }, select: { title: true } })
        .catch(() => null))?.title ?? null;
    }
    await escalateBuildToHuman({
      buildPk: build.id,
      buildId,
      featureTitle: build.title,
      biTitle,
      originatingBacklogItemId: build.originatingBacklogItemId,
      phase: "ideate",
      rounds,
      issues: (review?.issues ?? []).map((i) => ({ severity: i.severity, description: i.description })),
      selfFixClass: SELF_FIX_CLASS.NEEDS_HUMAN,
      log,
    });
  };

  try {
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { id: true, title: true, kind: true, originatingBacklogItemId: true, designReview: true },
    });
    if (!build) return { kind: "build-not-found", rounds: 0 };

    let review = build.designReview as DesignReviewVerdict;
    if (review?.decision !== "fail") return { kind: "no-failed-review", rounds: 0 };

    // Fix builds: regenerating the designDoc cannot fill the missing fixContext
    // ("Incomplete fix diagnosis"), so escalate to a human directly.
    if (build.kind === "fix") {
      await escalate(build, review, 0);
      return { kind: "escalated-fix-diagnosis", rounds: 0 };
    }

    const { formatPlanReviewFeedback } = await import("@/lib/build/plan-on-approval");
    const { executeTool } = await import("@/lib/mcp-tools");
    let round = 0;
    // BI-E492F313: did any round actually produce a new design to review? A
    // regeneration that never ran is NOT self-repair exhausted, and must not be
    // treated as one.
    let regenerated = false;
    let reviewRetries = 0;
    while (review?.decision === "fail" && round < DESIGN_FIX_MAX_ROUNDS) {
      // BI-D33F968A: a review that could not be completed says nothing about the
      // design. Regenerating against "Both review agents failed to respond"
      // cannot fix anything — it just spends the budget and ends in escalation
      // (live repro FB-05946F96). Re-run the reviewer instead, and only count a
      // round once a real verdict exists.
      if ((review as { reviewIncomplete?: boolean } | null)?.reviewIncomplete === true) {
        if (reviewRetries >= DESIGN_REVIEW_RETRY_LIMIT) break;
        reviewRetries += 1;
        await log(`Design review could not be completed — re-reviewing (attempt ${reviewRetries}/${DESIGN_REVIEW_RETRY_LIMIT}); the design is not at fault.`);
        await executeTool("reviewDesignDoc", { buildId }, userId, { featureBuildId: buildId, suppressDesignReviewAutoRepair: true });
        const retried = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designReview: true } });
        review = retried?.designReview as DesignReviewVerdict;
        continue;
      }
      round += 1;
      await log(`Design review failed — regenerating (round ${round}/${DESIGN_FIX_MAX_ROUNDS}) against ${review.issues?.length ?? 0} issue(s)`);
      const feedback = formatPlanReviewFeedback(review.issues ?? []);
      const regen = await dispatchIdeateForApprovedBuild({ buildId, userId, priorReviewFeedback: feedback });
      if (regen.kind !== "dispatched-success") {
        // BI-E492F313: this used to `break`, so ONE infrastructure failure both
        // consumed a round and abandoned the rest — the advertised "round 1/2"
        // never happened. A regeneration that could not dispatch says nothing
        // about the design, so spend the remaining rounds instead: engine
        // selection is re-resolved per attempt and a later round can land on an
        // engine that works. Live repro FB-D23311A7: round 1 drew the local
        // model, could not parse its output, and the build was destroyed —
        // taking a sound design doc and an actionable review with it.
        await log(`Design regeneration round ${round} produced no designDoc (${regen.kind}) — retrying if rounds remain.`);
        continue;
      }
      regenerated = true;
      await executeTool(
        "reviewDesignDoc",
        { buildId },
        userId,
        { featureBuildId: buildId, suppressDesignReviewAutoRepair: true },
      );
      const fresh = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designReview: true } });
      review = fresh?.designReview as DesignReviewVerdict;
    }

    // BI-E492F313: escalate-to-human ABANDONS the build, frees the WIP slot and
    // parks the owner's backlog item as deferred. The rule for when that is
    // warranted lives in review-fix-outcome.ts — shared with the plan loop — so
    // it is testable without the dispatch stack and cannot drift per phase.
    const { resolveReviewFixOutcome, outcomeKeepsBuildRecoverable } = await import(
      "@/lib/build/review-fix-outcome"
    );
    const outcomeKind = resolveReviewFixOutcome({
      reviewFailed: review?.decision === "fail",
      regenerated,
      reviewIncomplete: (review as { reviewIncomplete?: boolean } | null)?.reviewIncomplete === true,
    });
    if (outcomeKeepsBuildRecoverable(outcomeKind)) {
      await log(
        outcomeKind === "blocked-review-incomplete"
          ? "No reviewer could complete a design review, so nothing is known about this design. "
            + "Leaving the build recoverable; the design is kept and untouched."
          : `Design repair could not regenerate a design in ${round} round(s) — no engine produced one. `
            + "Leaving the build recoverable; the existing design and review are kept.",
      );
      return { kind: outcomeKind, rounds: round };
    }
    if (outcomeKind === "escalated-after-rounds") {
      await escalate(build, review, round);
      return { kind: outcomeKind, rounds: round };
    }
    await log(`Design review passed after ${round} fix round(s).`);
    return { kind: outcomeKind, rounds: round };
  } catch (err) {
    await log(`Design fix loop error: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`);
    return { kind: "error", rounds: 0 };
  }
}
