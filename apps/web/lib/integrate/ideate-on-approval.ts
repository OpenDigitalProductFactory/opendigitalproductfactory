// apps/web/lib/integrate/ideate-on-approval.ts
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
}): Promise<DispatchOutcome> {
  const { buildId, userId } = params;

  const logActivity = async (summary: string): Promise<void> => {
    await prisma.buildActivity.create({
      data: { buildId, tool: "ideate_dispatch", summary },
    }).catch((err) => {
      console.warn("[ideate-on-approval] Failed to log BuildActivity:", { buildId, summary }, err);
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
    if (existingDesignDoc && typeof existingDesignDoc.problemStatement === "string" && existingDesignDoc.problemStatement.trim().length > 0) {
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
      select: { title: true, body: true },
    });

    if (!bi) {
      const outcome: DispatchOutcome = {
        kind: "skipped-no-bi",
        reason: `originatingBacklogItemId ${build.originatingBacklogItemId} did not resolve to a BacklogItem row — data inconsistency.`,
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      return outcome;
    }

    // Resolve dispatch provider config. The "agentic" default has no external
    // provider — dispatchIdeateResearch would return an "auth error" anyway.
    // Short-circuit to a clean skip with a meaningful BuildActivity row.
    const { getBuildStudioConfig } = await import("@/lib/integrate/build-studio-config");
    const config = await getBuildStudioConfig();
    const providerId = config.provider === "claude"
      ? config.claudeProviderId
      : config.provider === "grok"
        ? config.grokProviderId
        : config.codexProviderId;

    if (config.provider === "agentic" || !providerId) {
      const outcome: DispatchOutcome = {
        kind: "skipped-no-provider",
        reason: `No external CLI provider configured (provider=${config.provider}, providerId=${providerId || "(empty)"}). Configure Claude, Codex, or Grok in Admin > AI Providers to enable auto-dispatch.`,
      };
      await logActivity(`Skipped auto-dispatch: ${outcome.reason}`);
      return outcome;
    }

    const model = config.provider === "claude"
      ? config.claudeModel
      : config.provider === "grok"
        ? config.grokModel
        : config.codexModel;

    // The BI body is the canonical context for backlog-promoted drafts.
    // It typically contains problem statement, acceptance criteria, and
    // architectural notes — exactly what the research prompt needs.
    const featureTitle = bi.title || build.title || "Untitled Feature";
    const featureDescription = bi.body || build.description || "";
    const userContext = bi.body || ""; // Same source — BI body is operator-authored context.

    const startedAt = Date.now();
    await logActivity(`Dispatching ideate research via ${config.provider} (provider=${providerId}, model=${model || "default"})`);

    const { dispatchIdeateResearch } = await import("./ideate-dispatch");
    const ideateResult = await dispatchIdeateResearch({
      featureTitle,
      featureDescription,
      reusabilityScope: "parameterizable",
      userContext,
      // businessContext: see select comment above — field does not exist on
      // FeatureBuild. Passing undefined preserves the dispatch signature.
      businessContext: undefined,
      providerId,
      model,
      dispatchEngine: config.provider,
    });

    const durationMs = Date.now() - startedAt;

    if (!ideateResult.success || !ideateResult.designDoc) {
      const outcome: DispatchOutcome = {
        kind: "dispatched-failure",
        error: ideateResult.error ?? "Ideate research returned no designDoc",
        durationMs,
      };
      await logActivity(`Auto-dispatch failed after ${(durationMs / 1000).toFixed(1)}s: ${outcome.error.slice(0, 200)}`);
      return outcome;
    }

    // Persist via the same code path the agentic coworker uses, so the
    // saveBuildEvidence audit trail is consistent regardless of which
    // dispatch path produced the designDoc.
    const { executeTool } = await import("@/lib/mcp-tools");
    const saveResult = await executeTool(
      "saveBuildEvidence",
      { field: "designDoc", value: ideateResult.designDoc },
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

    const designDocKeys = Object.keys(ideateResult.designDoc as Record<string, unknown>);
    const outcome: DispatchOutcome = {
      kind: "dispatched-success",
      designDocKeys,
      durationMs,
    };
    await logActivity(`Auto-dispatched and saved designDoc in ${(durationMs / 1000).toFixed(1)}s (fields: ${designDocKeys.slice(0, 8).join(", ")})`);
    return outcome;

  } catch (err) {
    // Belt-and-braces: never let an unexpected throw bubble out of a
    // fire-and-forget helper. Log and return a structured failure.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ideate-on-approval] Unhandled error in auto-dispatch:", { buildId }, err);
    await logActivity(`Auto-dispatch threw unexpectedly: ${message.slice(0, 200)}`);
    return { kind: "dispatched-failure", error: message, durationMs: 0 };
  }
}
