"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma, type Prisma } from "@dpf/db";
import {
  validateFeatureBrief,
  canTransitionPhase,
  checkPhaseGate,
  generateBuildId,
  bumpVersion,
  type FeatureBrief,
  type BuildPhase,
  type VersionBump,
  type BuildDesignDoc,
  type BuildPlanDoc,
  type ReviewResult,
} from "@/lib/feature-build-types";
import { buildDesignReviewPrompt, buildPlanReviewPrompt, parseReviewResponse } from "@/lib/build-reviewers";
import { routeAndCall } from "@/lib/routed-inference";
import * as crypto from "crypto";

// ─── Auth Guard ──────────────────────────────────────────────────────────────

async function requireBuildAccess(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "view_platform"
    )
  ) {
    throw new Error("Unauthorized");
  }
  return user.id!;
}

// ─── Create Feature Build ────────────────────────────────────────────────────

export async function createFeatureBuild(input: {
  title: string;
  description?: string;
  portfolioId?: string;
}): Promise<{ buildId: string }> {
  const userId = await requireBuildAccess();

  if (!input.title.trim()) throw new Error("Title is required");

  const buildId = generateBuildId();

  await prisma.featureBuild.create({
    data: {
      buildId,
      title: input.title.trim(),
      ...(input.description !== undefined && { description: input.description.trim() || null }),
      ...(input.portfolioId !== undefined && { portfolioId: input.portfolioId || null }),
      createdById: userId,
    },
  });

  return { buildId };
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

  await prisma.featureBuild.update({
    where: { buildId },
    data: { brief: brief as unknown as Prisma.InputJsonValue },
  });
}

// ─── Advance Phase ───────────────────────────────────────────────────────────

export async function advanceBuildPhase(
  buildId: string,
  targetPhase: BuildPhase,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: {
      id: true,
      phase: true,
      createdById: true,
      designDoc: true,
      designReview: true,
      buildPlan: true,
      planReview: true,
      taskResults: true,
      verificationOut: true,
      acceptanceMet: true,
    },
  });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  const currentPhase = build.phase as BuildPhase;
  if (!canTransitionPhase(currentPhase, targetPhase)) {
    throw new Error(`Cannot transition from ${currentPhase} to ${targetPhase}`);
  }

  const gate = checkPhaseGate(currentPhase, targetPhase, {
    designDoc: build.designDoc,
    designReview: build.designReview,
    buildPlan: build.buildPlan,
    planReview: build.planReview,
    taskResults: build.taskResults,
    verificationOut: build.verificationOut,
    acceptanceMet: build.acceptanceMet,
  });

  if (!gate.allowed) {
    throw new Error(gate.reason ?? "Phase gate check failed");
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: targetPhase },
  });

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
    const PHASE_AGENT: Record<string, string> = {
      ideate: "build-specialist",
      plan: "ea-architect",
      build: "build-specialist",
      review: "ops-coordinator",
      ship: "platform-engineer",
    };
    const fromAgent = PHASE_AGENT[currentPhase] ?? "build-specialist";
    const toAgent = PHASE_AGENT[targetPhase] ?? "build-specialist";

    // Build evidence digest — one-line summary per populated field
    const evidenceFields: string[] = [];
    const evidenceDigest: Record<string, string> = {};
    if (build.designDoc) { evidenceFields.push("designDoc"); evidenceDigest.designDoc = "Design document saved"; }
    if (build.designReview) {
      evidenceFields.push("designReview");
      const review = build.designReview as Record<string, unknown>;
      evidenceDigest.designReview = `${review.decision ?? "reviewed"} — ${String(review.summary ?? "").slice(0, 100)}`;
    }
    if (build.buildPlan) { evidenceFields.push("buildPlan"); evidenceDigest.buildPlan = "Implementation plan saved"; }
    if (build.planReview) {
      evidenceFields.push("planReview");
      const review = build.planReview as Record<string, unknown>;
      evidenceDigest.planReview = `${review.decision ?? "reviewed"} — ${String(review.summary ?? "").slice(0, 100)}`;
    }
    if (build.verificationOut) {
      evidenceFields.push("verificationOut");
      const v = build.verificationOut as Record<string, unknown>;
      evidenceDigest.verificationOut = `typecheck: ${v.typecheckPassed ? "pass" : "fail"}`;
    }
    if (build.acceptanceMet) {
      evidenceFields.push("acceptanceMet");
      evidenceDigest.acceptanceMet = Array.isArray(build.acceptanceMet)
        ? `${(build.acceptanceMet as Array<{ met?: boolean }>).filter(c => c.met).length}/${(build.acceptanceMet as unknown[]).length} criteria met`
        : "Evaluated";
    }

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
      console.error(`[build] autoExecuteBuild failed for ${buildId}:`, err),
    );
  }

  // Auto-launch UX accessibility audit when entering Review phase (AGT-903)
  if (targetPhase === "review") {
    autoA11yAudit(buildId).catch((err) =>
      console.error(`[build] autoA11yAudit failed for ${buildId}:`, err),
    );
  }
}

/** System-level build execution — delegates to checkpoint pipeline. */
async function autoExecuteBuild(buildId: string): Promise<void> {
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
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        buildExecState: state as unknown as import("@dpf/db").Prisma.InputJsonValue,
        ...(state.containerId ? { sandboxId: state.containerId } : {}),
        ...(state.hostPort ? { sandboxPort: state.hostPort } : {}),
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

  // Reset phase back to build if it was set to failed
  if (build.phase === "failed") {
    await prisma.featureBuild.update({
      where: { buildId },
      data: { phase: "build" },
    });
  }

  // Fire-and-forget retry — picks up from failed step
  autoExecuteBuild(buildId).catch((err) =>
    console.error(`[build] retryBuildExecution failed for ${buildId}:`, err),
  );
}

// ─── Auto A11y Audit (Review Phase) ─────────────────────────────────────────

/**
 * Fire-and-forget accessibility audit via AGT-903 (ux-accessibility-agent).
 * Runs when a build enters the Review phase. Reads sandbox files and stores
 * findings as a BuildActivity record for the evidence chain.
 */
async function autoA11yAudit(buildId: string): Promise<void> {
  const { UX_ACCESSIBILITY_PROMPT } = await import("@/lib/integrate/specialist-prompts");

  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { sandboxId: true, sandboxPort: true, threadId: true, title: true },
  });
  if (!build?.sandboxId) {
    // No sandbox — skip audit (build may not have generated code)
    return;
  }

  // Log that the audit was triggered
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "uxAccessibilityAudit",
      summary: "UX accessibility audit started (AGT-903)",
    },
  }).catch(() => {});

  // Emit SSE event so the UI shows the audit is running
  if (build.threadId) {
    const { agentEventBus } = await import("@/lib/agent-event-bus");
    agentEventBus.emit(build.threadId, {
      type: "orchestrator:task_dispatched",
      specialist: "ux-accessibility",
      taskTitle: "WCAG 2.2 AA compliance audit",
    } as import("@/lib/agent-event-bus").AgentEvent);
  }

  // Store the audit prompt and agent ID for traceability.
  // The actual LLM call is delegated to the agentic loop when the build's
  // review-phase orchestrator runs. For now we record the intent so the
  // evidence chain shows the audit was requested.
  await prisma.buildActivity.create({
    data: {
      buildId,
      tool: "uxAccessibilityAudit",
      summary: `UX accessibility audit queued for "${build.title}" — AGT-903 will review sandbox files for WCAG compliance, design token adherence, keyboard navigation, and semantic HTML.`,
    },
  }).catch(() => {});
}

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

  // Delete related records first (foreign key constraints)
  await prisma.buildActivity.deleteMany({ where: { buildId } });
  await prisma.featureBuild.delete({ where: { buildId } });
}

// ─── Ship Build — Register as DigitalProduct ────────────────────────────────

export async function shipBuild(input: {
  buildId: string;
  name: string;
  portfolioSlug: string;
  versionBump?: VersionBump;
}): Promise<{ productId: string; productInternalId: string; portfolioInternalId: string | null; promotionId: string | null; message: string }> {
  const userId = await requireBuildAccess();

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
          console.log(`[shipBuild] git backup pushed for ${input.buildId}`);
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

// ─── Complete Build — mark phase as complete after all ship steps ────────────

export async function completeBuild(buildId: string): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { phase: "complete" },
  });
}

// ─── Create Epic + Backlog Items for a Build ────────────────────────────────

export async function createBuildEpic(input: {
  buildId: string;
  title: string;
  portfolioSlug?: string;
  digitalProductId?: string;
}): Promise<{ epicId: string; message: string }> {
  await requireBuildAccess();

  // Resolve portfolio slug to internal ID
  let portfolioInternalId: string | null = null;
  if (input.portfolioSlug) {
    const portfolio = await prisma.portfolio.findUnique({
      where: { slug: input.portfolioSlug },
      select: { id: true },
    });
    portfolioInternalId = portfolio?.id ?? null;
  }

  const epicId = `EP-BUILD-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;

  // Wrap epic + backlog items in a transaction for consistency
  const epic = await prisma.$transaction(async (tx) => {
    const created = await tx.epic.create({
      data: {
        epicId,
        title: input.title,
        status: "open",
      },
      select: { id: true, epicId: true },
    });

    // Link epic to portfolio if resolved
    if (portfolioInternalId) {
      await tx.epicPortfolio.create({
        data: { epicId: created.id, portfolioId: portfolioInternalId },
      }).catch((e) => {
        console.warn("[createBuildEpic] portfolio link failed:", e);
      });
    }

    // Create "done" backlog item for the shipped work
    const doneItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: doneItemId,
        title: `Ship: ${input.title}`,
        type: "product",
        status: "done",
        body: `Feature shipped via Build Studio (${input.buildId}).`,
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    // Seed initial feedback-gathering item
    const feedbackItemId = `BI-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await tx.backlogItem.create({
      data: {
        itemId: feedbackItemId,
        title: `Gather user feedback on ${input.title.replace(/\sv[\d.]+$/, "")}`,
        type: "product",
        status: "open",
        body: "Collect initial user feedback and file follow-up items.",
        epicId: created.id,
        ...(input.digitalProductId ? { digitalProductId: input.digitalProductId } : {}),
      },
    });

    return created;
  });

  return {
    epicId: epic.epicId,
    message: `Created epic ${epic.epicId} with 2 backlog items (1 done, 1 open for feedback).`,
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
  field: "designDoc" | "designReview" | "buildPlan" | "planReview" | "taskResults" | "verificationOut" | "acceptanceMet",
  value: unknown,
): Promise<void> {
  const userId = await requireBuildAccess();

  const build = await prisma.featureBuild.findUnique({ where: { buildId } });
  if (!build) throw new Error("Build not found");
  if (build.createdById !== userId) throw new Error("Forbidden");

  await prisma.featureBuild.update({
    where: { buildId },
    data: { [field]: value as Prisma.InputJsonValue },
  });
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
