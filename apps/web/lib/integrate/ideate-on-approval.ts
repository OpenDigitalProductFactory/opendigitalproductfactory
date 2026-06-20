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
    // BI-0F291741/local-tuning: resolve per the configured engine. Without the
    // `opencode` branch this fell through to codexProviderId (cloud chatgpt),
    // so a fully-local install (provider="opencode", opencodeProviderId="local")
    // silently ran Ideate research on the cloud instead of the local model.
    const providerId = config.provider === "claude"
      ? config.claudeProviderId
      : config.provider === "grok"
        ? config.grokProviderId
        : config.provider === "opencode"
          ? config.opencodeProviderId
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
        : config.provider === "opencode"
          ? config.opencodeModel
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
    select: { buildId: true, designDoc: true },
    orderBy: { draftApprovedAt: "asc" },
    take: 50,
  });
  const pending = approved
    .filter((b) => buildNeedsIdeateDispatch(b.designDoc))
    .slice(0, limit);

  let dispatched = 0;
  let skipped = 0;
  for (const b of pending) {
    // dispatchIdeateForApprovedBuild never throws and is idempotent.
    const outcome = await dispatchIdeateForApprovedBuild({ buildId: b.buildId, userId });
    if (outcome.kind === "dispatched-success") dispatched += 1;
    else skipped += 1;
  }
  return { candidates: pending.length, dispatched, skipped };
}
