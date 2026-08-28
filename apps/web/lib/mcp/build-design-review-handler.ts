// Design-review gate handler — Simplify & Strengthen W9 (BI-0E7B0953).
//
// The reviewDesignDoc executeTool case from the mcp-tools.ts legacy monolith,
// split out of build-review-handlers.ts so neither module exceeds the new-file
// size ceiling. The body reproduces the former switch case verbatim — same
// lazy imports, same branches, same return shapes — so behaviour is identical
// over MCP; the local error boundary mirrors executeTool's shared try/catch
// (see build-review-handlers.ts).

import * as crypto from "crypto";

import { prisma } from "@dpf/db";
import { ENTERPRISE_ARCHITECT_DISPLAY_NAME } from "@dpf/db/agent-identity";

import type { ToolResult } from "@/lib/mcp-tools";
import type { ToolPackHandler } from "./tool-pack";
import {
  logBuildActivity,
  recordAutoIntakeFailure,
  extractBuildIdHint,
  resolveActiveBuildId,
  updateBuildHappyPathState,
} from "@/lib/mcp/build-tool-helpers";
import type { ReviewBranchInput } from "@/lib/build/build-reviewers";
import { triggerDesignReviewAutoRepair } from "@/lib/build/pre-build-review-auto-repair";
import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";
import { toFailureResult } from "./build-review-handlers";

type HandlerContext = Parameters<ToolPackHandler>[2];

export async function reviewDesignDoc(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  try {
      const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
      if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
      let phaseGateBlocker: string | null = null;
      // Right-sizing matrix: also select plan (carries processSize) so the
      // fix-flow gate picks the (fix, small | medium | large | xlarge) cell
      // rather than always falling back to (fix, medium). plan is also
      // needed below for the standard feature path's intake fallback.
      // BI-CE49D82E — also select prior designReview so we can pass its issues
      // to the reviewer prompt for delta-awareness and surface the iteration
      // trajectory in the operator-facing gate reason (mirror of BI-4396EFEC
      // for the plan path). Live repro: FB-5E20E793 oscillated on the same
      // "missing accessibility" complaint round after round.
      const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { designDoc: true, designReview: true, kind: true, brief: true, plan: true } });

      // Fix flow: a fix build has no feature design doc — it carries a structured
      // diagnosis (fixContext) on its brief. Review the diagnosis for completeness
      // and advance ideate → plan, instead of running the feature design reviewers.
      if (build?.kind === "fix") {
        const { isFixContextComplete, checkPhaseGate } = await import("@/lib/feature-build-types");
        const fixBrief = (build.brief ?? null) as import("@/lib/feature-build-types").FeatureBrief | null;
        const fixProcessSize = ((build.plan as Record<string, unknown> | null)?.processSize as string | undefined) ?? "medium";
        const fc = fixBrief?.fixContext;
        const complete = isFixContextComplete(fc);
        const review = complete
          ? { decision: "pass" as const, issues: [] as Array<{ severity: string; description: string }>, summary: "Fix diagnosis is complete: reproduction, root cause, and fix approach are all present." }
          : { decision: "fail" as const, issues: [{ severity: "critical", description: "Fix diagnosis is incomplete. Reproduction steps, root cause, and fix approach are all required — use update_feature_brief to fill fixContext." }], summary: "Incomplete fix diagnosis." };
        await prisma.featureBuild.update({ where: { buildId }, data: { designReview: review as unknown as import("@dpf/db").Prisma.InputJsonValue } });
        const { agentEventBus } = await import("@/lib/agent-event-bus");
        if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
        logBuildActivity(buildId, "reviewDesignDoc", `Fix review: ${review.decision}. ${review.summary}`);
        if (review.decision === "fail") {
          await triggerDesignReviewAutoRepair(buildId, userId, context);
          return { success: true, message: `Fix review FAILED. ${review.issues[0]?.description ?? review.summary}`, data: { review, blocked: true, action: "revise_and_resubmit" } };
        }
        let fixPhaseGateBlocker: string | null = null;
        try {
          const fixPlan = (build.plan as Record<string, unknown> | null);
          const gate = checkPhaseGate("ideate", "plan", { kind: "fix", processSize: fixProcessSize, deliverableSensitivity: fixPlan?.deliverableSensitivity, qualityFirst: fixPlan?.qualityFirst === true, fixContext: fc, designReview: review });
          const readiness = gate.allowed
            ? await enforceBuildInitiativeReadiness({ buildId, target: "plan", targetPhase: "plan", expectedPhase: "ideate" })
            : null;
          if (gate.allowed && readiness?.allowed) {
            const { completeBuildPhaseRun, startBuildPhaseRun } = await import("@/lib/build/build-phase-run");
            void completeBuildPhaseRun(buildId, "ideate");
            void startBuildPhaseRun(buildId, "plan").catch(() => {}); // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
            if (context?.threadId) {
              const { persistPhaseHandoffSummary } = await import("@/lib/build/phase-compaction-wire");
              void persistPhaseHandoffSummary(context.threadId, "ideate");
            }
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "plan" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "plan" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: ideate → plan (fix)");
          } else {
            const reason = gate.reason ?? readiness?.message ?? "Initiative readiness is incomplete.";
            logBuildActivity(buildId, "phase:gate-blocked", reason);
            fixPhaseGateBlocker = reason;
          }
        } catch (err) {
          console.error("[reviewDesignDoc:fix] auto-advance failed:", err);
        }
        const fixMsg = fixPhaseGateBlocker
          ? `Fix review: ${review.decision}. ${review.summary}\n\nPhase did NOT advance to plan. Reason: ${fixPhaseGateBlocker}`
          : `Fix review: ${review.decision}. ${review.summary} Phase advanced to plan.`;
        return { success: true, message: fixMsg, data: { review, phaseGateBlocker: fixPhaseGateBlocker } };
      }

      if (!build?.designDoc) return { success: false, error: "No design document saved yet.", message: "Save designDoc first." };
      const { buildDesignReviewPrompt, buildArchitectureReviewPrompt, finalizeArchitectureAdvisory, parseReviewResponse, mergeReviews, collectReviewerVerdicts } = await import("@/lib/build-reviewers");
      const designDocTyped = build.designDoc as Parameters<typeof buildDesignReviewPrompt>[0];
      // BI-CE49D82E — Compute the iteration context up front so we can
      // (a) feed prior issues into the reviewer prompt and (b) populate
      // ReviewResult.iteration on the output. Round is 1-based: first
      // review = 1, every subsequent reviewDesignDoc call increments.
      const priorDesignReview = (build.designReview ?? null) as
        | { issues?: Array<{ severity?: string; description?: string }>; iteration?: { round?: number } }
        | null;
      const priorRound = priorDesignReview?.iteration?.round ?? 0;
      const priorIssues = Array.isArray(priorDesignReview?.issues)
        ? priorDesignReview!.issues!
            .filter((i): i is { severity: string; description: string } =>
              typeof i?.severity === "string" && typeof i?.description === "string",
            )
            .map((i) => ({ severity: i.severity, description: i.description }))
        : [];
      const currentRound = priorRound + 1;
      const priorContext = priorIssues.length > 0
        ? { round: priorRound, issues: priorIssues }
        : null;
      const prompt = buildDesignReviewPrompt(designDocTyped, "", priorContext);
      const archPrompt = buildArchitectureReviewPrompt({ kind: "design", doc: designDocTyped }, "");
      const { routeAndCall } = await import("@/lib/routed-inference");
      const messages = [{ role: "user" as const, content: prompt }];
      // Run the two checklist reviewers PLUS the advisory architecture reviewer
      // (chief-architect / Enterprise Architect lens) in parallel. The
      // architecture reviewer NEVER enters mergeReviews — it is advisory only:
      // it joins the deliberation trail as the `architect` branch and rides
      // along on review.architectureAdvisory so the coworker can fold concerns
      // into the spec, but it cannot gate pass/fail.
      const [r1settled, r2settled, archSettled] = await Promise.allSettled([
        routeAndCall(messages, "You are a design reviewer.", "internal"),
        routeAndCall(
          messages,
          "You are an independent design reviewer. Focus especially on security, data integrity, edge cases, and accessibility gaps the primary reviewer may have missed.",
          "internal",
          { budgetClass: "minimize_cost" },
        ),
        routeAndCall(
          [{ role: "user" as const, content: archPrompt }],
          `You are the ${ENTERPRISE_ARCHITECT_DISPLAY_NAME} (DPF chief-architect lens) reviewing for architectural alignment. Advisory only — surface concerns and concrete spec edits, never block the gate.`,
          "internal",
          { budgetClass: "minimize_cost" },
        ),
      ]);
      const r1 = r1settled.status === "fulfilled" ? parseReviewResponse(r1settled.value.content) : null;
      const r2 = r2settled.status === "fulfilled" ? parseReviewResponse(r2settled.value.content) : null;
      const archReview = archSettled.status === "fulfilled" ? parseReviewResponse(archSettled.value.content) : null;
      const architectureAdvisory = await finalizeArchitectureAdvisory(prisma, archReview, userId, context?.agentId, context?.threadId, "reviewDesignDoc");
      const reviewBase = r1 && r2 ? mergeReviews(r1, r2) : r1 ?? r2 ?? {
        decision: "fail" as const,
        issues: [{ severity: "critical" as const, description: "Both review agents failed to respond" }],
        summary: "Review could not be completed — retry.",
        // BI-D33F968A: nobody read the work. `fail` is the safe default, not a
        // verdict — mark it so a repair loop does not spend rounds "fixing"
        // something no reviewer looked at.
        reviewIncomplete: true,
      };
      // BI-CE49D82E — Compute the iteration delta against the prior round and
      // attach to the ReviewResult. computeReviewDelta + isOscillating live in
      // feature-build-types so they're independently unit-testable and shared
      // with the plan path.
      const { computeReviewDelta, isOscillating } = await import("@/lib/feature-build-types");
      const reviewWithIteration = (() => {
        if (priorIssues.length === 0) {
          return { ...reviewBase, iteration: { round: currentRound } };
        }
        const delta = computeReviewDelta(priorIssues, reviewBase.issues);
        return {
          ...reviewBase,
          iteration: {
            round: currentRound,
            prior: delta,
            oscillating: isOscillating(delta, reviewBase.issues.length),
          },
        };
      })();
      let review = architectureAdvisory ? { ...reviewWithIteration, architectureAdvisory } : reviewWithIteration;
      // A3 (BI-D506598C): governed Data Architect consultation, flag-gated
      // default-off. Unlike the anonymous `architect` routeAndCall above, this is
      // attributed to the real AGT-BUILD-DA Agent and informed by its profession
      // corpus (BI-B31072B8) — actor trail, not just artifact trail. Advisory
      // only; never gates. Strict no-op when the flag is off (skipped=true).
      try {
        const { runGovernedDaConsultationViaRouteAndCall } = await import(
          "@/lib/build/governed-data-architect-consultation"
        );
        const daAdvisory = await runGovernedDaConsultationViaRouteAndCall({
          doc: typeof build.designDoc === "string" ? build.designDoc : JSON.stringify(designDocTyped),
          db: prisma,
          transport: (messages, systemPrompt) =>
            routeAndCall(messages, systemPrompt, "internal", { budgetClass: "minimize_cost" }),
        });
        if (!daAdvisory.skipped && daAdvisory.findings.length > 0) {
          review = Object.assign({}, review, { dataArchitectureAdvisory: daAdvisory }) as typeof review;
          logBuildActivity(buildId, "reviewDesignDoc", `Data Architect consultation (advisory, ${daAdvisory.agentId}): ${daAdvisory.findings.length} finding(s).`);
        }
      } catch (e) {
        console.warn("[reviewDesignDoc] governed DA consultation failed (fail-open):", e);
      }
      const archAdvisoryNote = architectureAdvisory && architectureAdvisory.issues.length > 0
        ? ` Architecture review (advisory): ${architectureAdvisory.summary} Fold actionable items into the design before building — they do not block this gate.`
        : "";

      // Phase 2 of design-time decomposition (BI-2E6CC391, spec
      // docs/superpowers/specs/2026-05-24-build-studio-design-time-
      // decomposition-design.md). Run the deterministic sizing counter and
      // record the assessment alongside the review. Informational only —
      // no gate, no UX change. Surfaces the rationale ("5 models, 25 ACs,
      // 4 multipliers → required") so when Phase 3's gate ships, operators
      // have already seen the signal in passing.
      const { sizeDesignDoc } = await import("@/lib/build/size-design-doc");
      const sizeAssessment = sizeDesignDoc(build.designDoc as Parameters<typeof sizeDesignDoc>[0]);
      // Preserve the individual reviewer verdicts (pre-merge) so the Review-phase
      // UI can show which named reviewer cleared vs flagged. Nested on the JSON
      // column — no migration. Same r1/r2/archReview the deliberation trail uses.
      const reviewers = collectReviewerVerdicts(r1, r2, archReview);
      // Preserve an operator decomposition override across review re-runs.
      // record_decomposition_override writes designReview.decompositionOverride; the
      // Phase-4b gate below (and resume-pre-build-phase) reads it to let an overridden
      // build advance past decompose-required. Re-attach it here — otherwise this write
      // replaces designReview and wipes the override, the gate sees !hasOverride, and the
      // build re-parks at the decompose gate forever (the override→advance path, incl.
      // resume re-running reviewDesignDoc, never completes).
      const priorOverride =
        (build.designReview as { decompositionOverride?: unknown } | null)?.decompositionOverride ?? null;
      const reviewWithSize = {
        ...review,
        sizeAssessment,
        ...(reviewers.length > 0 ? { reviewers } : {}),
        ...(priorOverride != null ? { decompositionOverride: priorOverride } : {}),
      };
      await prisma.featureBuild.update({ where: { buildId }, data: { designReview: reviewWithSize as unknown as import("@dpf/db").Prisma.InputJsonValue } });
      const { agentEventBus } = await import("@/lib/agent-event-bus");
      if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "designReview" });
      logBuildActivity(buildId, "reviewDesignDoc", `Design review: ${review.decision}. ${review.summary}`);
      logBuildActivity(
        buildId,
        "design-size-assessed",
        `Design size: ${sizeAssessment.decision}. ${sizeAssessment.rationale}`,
      );

      // Record a deliberation trail for this dual-reviewer run. The review
      // result above still gates pass/fail; this layer is the honest
      // retrospective the Deliberation Pattern Framework persists for UI +
      // audit (spec §7). Wrap in try/catch — a deliberation write MUST NOT
      // break the review gate (fail-loud via console.warn per project memory
      // "silent seed skips audit").
      try {
        const reviewerBranches: ReviewBranchInput[] = [];
        if (r1) reviewerBranches.push({ branchNodeId: "reviewer-1", role: "reviewer", review: r1 });
        if (r2) reviewerBranches.push({ branchNodeId: "reviewer-2", role: "reviewer", review: r2 });
        // Advisory architecture branch — its objections become unresolved
        // risks in the deliberation summary but never flip the gate.
        if (archReview) reviewerBranches.push({ branchNodeId: "architect", role: "architect", review: archReview });
        if (reviewerBranches.length > 0) {
          const { runBuildReviewDeliberation } = await import("@/lib/build/build-orchestrator");
          await runBuildReviewDeliberation({
            userId,
            buildId,
            phase: "ideate",
            reviewerBranches,
            ...(context?.threadId ? { threadId: context.threadId } : {}),
          });
        }
      } catch (err) {
        console.warn("[deliberation] failed to record build review trail: %s",
          err instanceof Error ? JSON.stringify(err.message) : JSON.stringify(String(err)));
      }

      // Failed review → structured recovery instructions, no auto-advance
      if (review.decision === "fail") {
        await triggerDesignReviewAutoRepair(buildId, userId, context);
        const criticalIssues = review.issues.filter((i: { severity: string }) => i.severity === "critical");
        const issueList = criticalIssues.length > 0
          ? criticalIssues.map((i: { description: string }) => i.description).join("; ")
          : review.summary;
        // BI-CE49D82E — Include the iteration trajectory in the agent-facing
        // message so the implementer model sees when its revisions are trading
        // one set of issues for another instead of converging. The oscillating
        // signal recommends a scope split rather than another iteration —
        // matching the plan path established by BI-4396EFEC (D38).
        const iter = review.iteration;
        const trajectoryNote = iter?.prior
          ? ` (Round ${iter.round}: ${iter.prior.addressed} addressed, ${iter.prior.persisted} persist, ${iter.prior.newlySurfaced} new${iter.oscillating ? " — issues are not net-decreasing across rounds; consider proposing a scope split rather than another revision." : ""}.)`
          : "";
        return {
          success: true,
          message: `Design review FAILED. Blocking issues: ${issueList}. Revise the design document to address these issues, then call saveBuildEvidence with field "designDoc" and re-run reviewDesignDoc.${trajectoryNote}${archAdvisoryNote}`,
          data: { review, blocked: true, action: "revise_and_resubmit" },
        };
      }

      // Passed review → auto-complete intake anchors the user didn't
      // explicitly set, then try to advance the phase.
      //
      // Before: only designDoc + designReview were passed to checkPhaseGate,
      // which evaluates evidence.happyPathState too and silently failed on
      // null (default-all-null from normalizeHappyPathState). Phase stayed
      // ideate forever, the coworker kept saying "Ready to move to planning?"
      // and nothing moved. Observed by Mark 2026-04-20 on the subnet-filter
      // graph build.
      //
      // Fix:
      //   1. Read plan from DB so we have the real happyPathState.
      //   2. If backlogItemId or epicId are null (user didn't manually
      //      create them), auto-create them here. constrainedGoal and
      //      taxonomyNodeId are normally populated by update_feature_brief
      //      and confirm_taxonomy_placement which the agent already calls
      //      in the ideate loop.
      //   3. Pass happyPathState to checkPhaseGate so the full intake
      //      check actually runs.
      try {
        const { checkPhaseGate, canTransitionPhase, normalizeHappyPathState, deriveIntakeTaxonomyAnchor } = await import("@/lib/feature-build-types");
        const updatedBuild = await prisma.featureBuild.findUnique({
          where: { buildId },
          select: {
            phase: true,
            // Right-sizing matrix: kind drives policy selection in
            // checkPhaseGate; pre-existing rows default to "feature" via
            // the schema default, so this is back-compat-safe.
            kind: true,
            originatingBacklogItemId: true,
            parentEpicId: true,
            draftApprovedAt: true,
            designDoc: true,
            designReview: true,
            plan: true,
            title: true,
            description: true,
            digitalProductId: true,
            digitalProduct: { select: { portfolio: { select: { slug: true } } } },
          },
        });

        if (updatedBuild && updatedBuild.phase === "ideate" && canTransitionPhase("ideate", "plan")) {
          const governedConfig = await prisma.platformDevConfig.findUnique({
            where: { id: "singleton" },
            select: { governedBacklogEnabled: true },
          });
          const requiresStartApproval =
            updatedBuild.originatingBacklogItemId != null
            && updatedBuild.draftApprovedAt == null;

          if (requiresStartApproval) {
            logBuildActivity(buildId, "phase:gate-blocked", "Approve Start is required before ideate can advance to plan.");
            return {
              success: true,
              message: `Design review: ${review.decision}. ${review.summary} This governed backlog draft is prepared and now waiting for Approve Start before planning can begin.`,
              data: { review, blocked: true, action: "approve_start" },
            };
          }

          // Phase 4b decompose-required gate (BI-2E6CC391). If the build's
          // size assessment is "decompose-required" AND no decomposition
          // happened (build still exists in ideate, not superseded) AND no
          // operator override was recorded, refuse advance and tell the
          // operator what to do next. Recommended-tier and ok-tier builds
          // proceed through to plan unchanged.
          const sizedReview = (updatedBuild.designReview ?? null) as
            | { sizeAssessment?: { decision?: string }; decompositionOverride?: unknown }
            | null;
          const decomposeDecision = sizedReview?.sizeAssessment?.decision ?? null;
          const hasOverride = sizedReview?.decompositionOverride != null;
          if (decomposeDecision === "decompose-required" && !hasOverride) {
            // Governed-backlog autopilot: rather than park a hands-off
            // auto-promoted build at the operator decomposition gate forever
            // (BI-C4F828B7 self-perpetuating loop), resolve it autonomously —
            // auto-approve the top decomposition candidate, or auto-override to
            // ship monolithically as a fallback. Operator-driven / non-governed
            // builds return "park" and keep the original wait-for-operator gate.
            const { autoResolveDecomposeRequiredGate } = await import(
              "@/lib/build/auto-resolve-decompose-gate"
            );
            const auto = await autoResolveDecomposeRequiredGate({
              build: {
                buildId,
                parentEpicId: updatedBuild.parentEpicId ?? null,
                originatingBacklogItemId: updatedBuild.originatingBacklogItemId ?? null,
                designReview: updatedBuild.designReview,
              },
              userId,
              governedBacklogEnabled: governedConfig?.governedBacklogEnabled === true,
            });

            if (auto.action === "decomposed") {
              logBuildActivity(
                buildId,
                "auto-decompose",
                `Governed autopilot auto-decomposed into ${auto.childBuildIds.length} child build(s) under Epic ${auto.epicId} (candidate ${auto.candidateId}).`,
              );
              return {
                success: true,
                message: `Design review: ${review.decision}. Size assessment was decompose-required; under governed autopilot this build was auto-decomposed into ${auto.childBuildIds.length} child build(s) under Epic ${auto.epicId}, which now proceed independently.`,
                data: {
                  review,
                  decomposed: true,
                  epicId: auto.epicId,
                  childBuildIds: auto.childBuildIds,
                },
              };
            }

            if (auto.action === "already-decomposed") {
              // Duplicate promotion: the BI already has a decomposition Epic
              // whose children carry this work (BI-1D0CA7A0). Block the advance —
              // never override to monolithic, which would ship it twice.
              const epic = auto.existingEpicId ?? "(unknown)";
              logBuildActivity(buildId, "phase:gate-blocked", `decompose-required gate fired, but the backlog item is already decomposed into Epic ${epic}; advance blocked as a duplicate promotion.`);
              return {
                success: true,
                message: `Design review: ${review.decision}, but this build's backlog item is already decomposed into Epic ${epic}, whose child builds already carry the work. This build is a duplicate promotion — retire it rather than decomposing or overriding it.`,
                data: { review, blocked: true, action: "duplicate_promotion", existingEpicId: auto.existingEpicId ?? null },
              };
            }

            if (auto.action === "park") {
              logBuildActivity(
                buildId,
                "phase:gate-blocked",
                "decompose-required gate fired; advance blocked until decomposition or override.",
              );
              return {
                success: true,
                message: `Design review: ${review.decision}, but the size assessment is decompose-required. Before advancing to Plan, either call approve_decomposition with a chosen DecompositionCandidate (preferred) — see propose_decomposition to generate candidates — OR call record_decomposition_override with a one-line justification to ship monolithically.`,
                data: { review, blocked: true, action: "decompose_or_override" },
              };
            }

            // auto.action === "overridden": the monolithic override is now
            // recorded in the DB, so the decompose gate no longer blocks. Fall
            // through to the phase-advance logic below.
            logBuildActivity(
              buildId,
              "auto-decompose-override",
              `Governed autopilot recorded a monolithic override (${auto.reason}); proceeding to Plan as a single build.`,
            );
          }

          const plan = (updatedBuild.plan as Record<string, unknown> | null) ?? {};
          let happyPathState = normalizeHappyPathState(plan.happyPathState);

          // Auto-create epic if missing via the request-scope-INDEPENDENT
          // autoCreateBuildEpic helper (NOT the createBuildEpic server action,
          // whose headers() throws on autonomous resume — see auto-intake-epic.ts).
          if (!happyPathState.intake.epicId) {
            try {
              const { autoCreateBuildEpic } = await import("@/lib/build/auto-intake-epic");
              const epicTitle = updatedBuild.title || happyPathState.intake.constrainedGoal || "Build Studio feature";
              const createdEpic = await autoCreateBuildEpic({
                db: prisma,
                title: epicTitle,
                portfolioSlug: updatedBuild.digitalProduct?.portfolio?.slug ?? null,
              });
              await updateBuildHappyPathState(userId, {
                intake: { epicId: createdEpic.epicId },
              }, buildId);
              happyPathState = { ...happyPathState, intake: { ...happyPathState.intake, epicId: createdEpic.epicId } };
              logBuildActivity(buildId, "auto-intake:epic", `Auto-created epic ${createdEpic.epicId} (${epicTitle})`);
            } catch (err) {
              recordAutoIntakeFailure(buildId, "epic", err);
            }
          }

          // Auto-create backlog item if missing.
          if (!happyPathState.intake.backlogItemId) {
            try {
              const itemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
              const title = updatedBuild.title || happyPathState.intake.constrainedGoal || "Build Studio feature";
              const body = String(updatedBuild.description ?? "").slice(0, 2000);

              // BacklogItem.epicId is the FK to Epic.id (cuid), NOT the
              // semantic "EP-BUILD-xxx" string. happyPathState stores the
              // semantic id, so we must resolve it to the cuid before
              // passing it as a FK — otherwise the FK check fails with
              // BacklogItem_epicId_fkey and the auto-create swallows silently
              // (observed 2026-04-20 on FB-21EEA510: epic linked, backlog
              // stuck null, phase gate blocked forever).
              let epicCuid: string | null = null;
              if (happyPathState.intake.epicId) {
                const epicRow = await prisma.epic.findUnique({
                  where: { epicId: happyPathState.intake.epicId },
                  select: { id: true },
                });
                epicCuid = epicRow?.id ?? null;
              }

              await prisma.backlogItem.create({
                data: {
                  itemId,
                  title,
                  type: "product",
                  status: "in-progress",
                  submittedById: userId,
                  ...(body ? { body } : {}),
                  ...(epicCuid ? { epicId: epicCuid } : {}),
                },
              });
              await updateBuildHappyPathState(userId, {
                intake: { backlogItemId: itemId },
              }, buildId);
              happyPathState = { ...happyPathState, intake: { ...happyPathState.intake, backlogItemId: itemId } };
              logBuildActivity(buildId, "auto-intake:backlog", `Auto-created backlog item ${itemId} (${title})`);
            } catch (err) {
              recordAutoIntakeFailure(buildId, "backlog", err);
            }
          }

          // Auto-derive constrainedGoal if missing — fall back to the build
          // title. For triaged-BI builds the title was generated from the BI
          // body which itself was triaged, so the title IS the constrained
          // goal for governance purposes. For ad-hoc free-text builds where
          // the user explicitly set a goal via update_feature_brief, this
          // path is a no-op (the goal is already populated).
          //
          // Closes BI-0B3EAAC8: the existing reviewDesignDoc auto-advance
          // already auto-creates epic + backlog item but did NOT auto-derive
          // constrainedGoal or taxonomyNodeId, so triaged-BI builds got
          // stuck in ideate forever even when the BI body fully described
          // the work.
          if (!happyPathState.intake.constrainedGoal && updatedBuild.title) {
            try {
              const goal = updatedBuild.title.trim().slice(0, 280);
              await updateBuildHappyPathState(userId, {
                intake: { constrainedGoal: goal },
              }, buildId);
              happyPathState = {
                ...happyPathState,
                intake: { ...happyPathState.intake, constrainedGoal: goal },
              };
              logBuildActivity(buildId, "auto-intake:constrained-goal", `Auto-set constrainedGoal from build title`);
            } catch (err) {
              recordAutoIntakeFailure(buildId, "constrained-goal", err);
            }
          }

          // Auto-derive taxonomyNodeId (ad-hoc builds otherwise gate-block on
          // "Intake is incomplete" forever — see deriveIntakeTaxonomyAnchor).
          const anchor = deriveIntakeTaxonomyAnchor({
            taxonomyNodeId: happyPathState.intake.taxonomyNodeId,
            originatingBacklogItemId: updatedBuild.originatingBacklogItemId,
            buildId,
          });
          if (anchor) {
            try {
              await updateBuildHappyPathState(userId, {
                intake: { taxonomyNodeId: anchor },
              }, buildId);
              happyPathState = {
                ...happyPathState,
                intake: { ...happyPathState.intake, taxonomyNodeId: anchor },
              };
              logBuildActivity(buildId, "auto-intake:taxonomy-anchor", `Auto-set taxonomyNodeId=${anchor}`);
            } catch (err) {
              recordAutoIntakeFailure(buildId, "taxonomy-anchor", err);
            }
          }

          const idpPlan = (updatedBuild.plan as Record<string, unknown> | null);
          const gate = checkPhaseGate("ideate", "plan", {
            kind: updatedBuild.kind,
            processSize: (idpPlan?.processSize as string | undefined) ?? "medium",
            deliverableSensitivity: idpPlan?.deliverableSensitivity,
            qualityFirst: idpPlan?.qualityFirst === true,
            designDoc: updatedBuild.designDoc,
            designReview: updatedBuild.designReview,
            happyPathState,
          });
          const readiness = gate.allowed
            ? await enforceBuildInitiativeReadiness({ buildId, target: "plan", targetPhase: "plan", expectedPhase: "ideate" })
            : null;
          if (gate.allowed && readiness?.allowed) {
            // EP-COST Phase 3: record ideate-phase cost rollup, start plan tracking, and compact thread
            const { completeBuildPhaseRun, startBuildPhaseRun } = await import("@/lib/build/build-phase-run");
            void completeBuildPhaseRun(buildId, "ideate");
            void startBuildPhaseRun(buildId, "plan").catch(() => {}); // swallow QuiescingError thrown during a self-upgrade drain (BI-QUIESCE-005)
            if (context?.threadId) {
              const { persistPhaseHandoffSummary } = await import("@/lib/build/phase-compaction-wire");
              void persistPhaseHandoffSummary(context.threadId, "ideate");
            }
            await prisma.featureBuild.update({ where: { buildId }, data: { phase: "plan" } });
            if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "plan" });
            logBuildActivity(buildId, "phase:advance", "Phase advanced: ideate → plan");
            // Auto-dispatch plan generation so the build advances without
            // waiting for the operator to manually prompt the coworker. Mirrors
            // the ideate auto-dispatch pattern (plan-on-approval.ts).
            void import("@/lib/build/plan-on-approval").then(m =>
              m.dispatchPlanForApprovedBuild({ buildId, userId })
                .catch(err => console.error("[plan-on-approval] auto-dispatch failed:", err))
            );
          } else {
            const reason = gate.reason ?? readiness?.message ?? "Initiative readiness is incomplete.";
            logBuildActivity(buildId, "phase:gate-blocked", reason);
            // Surface the blocker to the agent so it can self-correct on the next
            // turn. Without this, the agent sees "review passed" and assumes
            // ideate is done — but the phase silently stays in ideate forever
            // because intake anchors (taxonomy, constrainedGoal) weren't set.
            // The agent has the tools (confirm_taxonomy_placement,
            // update_feature_brief) — it just didn't know they were required.
            phaseGateBlocker = reason;
          }
        }
      } catch (err) {
        console.error("[reviewDesignDoc] auto-advance failed:", err);
      }

      const reviewMessage = (phaseGateBlocker
        ? `Design review: ${review.decision}. ${review.summary}\n\n` +
          `IMPORTANT: Phase did NOT advance to plan. Reason: ${phaseGateBlocker} ` +
          `Call confirm_taxonomy_placement (with the right taxonomyNodeId from suggest_taxonomy_placement) ` +
          `and update_feature_brief (with a concrete constrainedGoal) before re-running reviewDesignDoc.`
        : `Design review: ${review.decision}. ${review.summary}`) + archAdvisoryNote;
      return { success: true, message: reviewMessage, data: { review, phaseGateBlocker } };
  } catch (err) {
    return toFailureResult("reviewDesignDoc", err);
  }
}
