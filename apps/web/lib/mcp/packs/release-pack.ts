// Release & promotion tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "scheduling & release" domain out of the
// mcp-tools.ts executeTool switch: the seven tools that check deployment
// windows, schedule and execute promotions, assemble release bundles, run
// release-gate checks, schedule bundles, and report release status. Each
// handler reproduces the former switch case verbatim — same lazy imports,
// same branches, same return shapes — so behaviour is identical when a tool
// is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// two promotion tools share logBuildActivity with the Build Studio helpers,
// imported from the shared module rather than replicated here.

import { prisma } from "@dpf/db";

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import { logBuildActivity } from "@/lib/mcp/build-tool-helpers";

const definitions: ToolDefinition[] = [
  {
    name: "check_deployment_windows",
    description: "Check available deployment windows for promoting changes to production. Returns current window status, blackout periods, and next available window time.",
    inputSchema: {
      type: "object",
      properties: {
        change_type: { type: "string", description: "RFC type: standard, normal, or emergency. Default: normal." },
        risk_level: { type: "string", description: "Risk level: low, medium, high, or critical. Default: low." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["review", "ship"],
  },
  {
    name: "schedule_promotion",
    description: "Schedule an approved promotion for deployment during a specific window. Creates a calendar event for visibility.",
    inputSchema: {
      type: "object",
      properties: {
        promotion_id: { type: "string", description: "The promotion ID (CP-xxx) to schedule." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
    buildPhases: ["ship"],
  },
  {
    name: "execute_promotion",
    description: "Execute an approved promotion. Starts the autonomous promoter: backup DB, build new portal image from sandbox, swap containers, health check. Rolls back automatically on failure.",
    inputSchema: {
      type: "object" as const,
      properties: {
        promotion_id: { type: "string", description: "The promotion ID to execute (e.g. CP-xxxx)." },
        override_reason: { type: "string", description: "Reason for deploying outside a deployment window (optional, for emergency changes)." },
      },
      required: ["promotion_id"],
    },
    requiredCapability: "view_operations" as const,
    executionMode: "immediate" as const,
    sideEffect: true,
    consequence: "irreversible",
    buildPhases: ["ship"],
  },
  {
    name: "create_release_bundle",
    description: "Group multiple completed builds into a release bundle for coordinated deployment.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Release bundle title, e.g. 'March 2026 Feature Release'." },
        build_ids: { type: "array", items: { type: "string" }, description: "Array of buildId values to include in the bundle." },
      },
      required: ["title", "build_ids"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ship"],
  },
  {
    name: "run_release_gate",
    description: "Run gate checks on a release bundle: combine diffs from all builds, run destructive operation scan, validate all builds passed tests.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to check." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
  },
  {
    name: "schedule_release_bundle",
    description: "Schedule an approved release bundle for deployment during a deployment window. Creates an RFC, ChangePromotion, and CalendarEvent for operations calendar visibility.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "The release bundle ID (RB-xxx) to schedule." },
      },
      required: ["bundle_id"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: true,
    // destroys state → consult-gated (TAK §8.4.1).
    consequence: "irreversible",
  },
  {
    name: "get_release_status",
    description: "Get the current status of a release bundle or promotion, including deployment window availability and gate check results.",
    inputSchema: {
      type: "object",
      properties: {
        bundle_id: { type: "string", description: "Release bundle ID (RB-xxx) — optional if promotion_id is provided." },
        promotion_id: { type: "string", description: "Promotion ID (CP-xxx) — optional if bundle_id is provided." },
      },
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ship"],
  },
];

async function checkDeploymentWindows(params: Record<string, unknown>): Promise<ToolResult> {
  const changeType = String(params.change_type ?? "normal");
  const riskLevel = String(params.risk_level ?? "low");
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true, blackoutPeriods: true },
  });

  if (!profile) {
    return { success: true, message: "No business profile configured — deployment is unrestricted. Set up operating hours in Admin to enable deployment windows.", data: { available: true, unrestricted: true } };
  }

  const now = new Date();
  const activeBlackout = profile.blackoutPeriods.find(
    (bp) => bp.startAt <= now && bp.endAt >= now && !bp.exceptions.includes(changeType),
  );
  if (activeBlackout) {
    return {
      success: true,
      message: `Blackout period active until ${activeBlackout.endAt.toISOString()}. Reason: ${activeBlackout.reason ?? "Scheduled blackout"}. Emergency changes may override.`,
      data: { available: false, blackout: true, blackoutEnd: activeBlackout.endAt.toISOString(), reason: activeBlackout.reason },
    };
  }

  const { isNowInWindow } = await import("@/lib/sandbox-promotion");
  const matchingWindows = profile.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes(changeType) && w.allowedRiskLevels.includes(riskLevel),
  );

  if (matchingWindows.length === 0) {
    return { success: true, message: "No deployment windows configured for this change type and risk level — deployment is unrestricted.", data: { available: true, unrestricted: true } };
  }

  const windowOpen = isNowInWindow(matchingWindows);
  const windowSummary = matchingWindows.map((w) => ({
    name: w.name,
    days: w.dayOfWeek,
    startTime: w.startTime,
    endTime: w.endTime,
  }));

  return {
    success: true,
    message: windowOpen
      ? `Deployment window is OPEN now. ${matchingWindows.length} matching window(s) available.`
      : `Not in a deployment window. Available windows: ${matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")}`,
    data: { available: windowOpen, windows: windowSummary },
  };
}

async function schedulePromotion(params: Record<string, unknown>): Promise<ToolResult> {
  const promotionId = String(params.promotion_id ?? "");
  if (!promotionId) return { success: false, error: "promotion_id is required.", message: "Provide a promotion ID." };

  const promotion = await prisma.changePromotion.findUnique({
    where: { promotionId },
    include: {
      changeItem: { include: { changeRequest: true } },
      productVersion: { include: { featureBuild: { select: { buildId: true } } } },
    },
  });
  if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
  if (promotion.status !== "approved") return { success: false, error: "Promotion must be approved first.", message: `Current status: ${promotion.status}` };

  // Find next available window
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true },
  });

  if (!profile || profile.deploymentWindows.length === 0) {
    return { success: true, message: "No deployment windows configured. Promotion can be deployed anytime via Operations > Promotions.", data: { scheduled: false } };
  }

  const rfcType = promotion.changeItem?.changeRequest?.type ?? "normal";
  const riskLevel = promotion.changeItem?.changeRequest?.riskLevel ?? "low";
  const matchingWindows = profile.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes(rfcType) && w.allowedRiskLevels.includes(riskLevel),
  );

  if (matchingWindows.length === 0) {
    return { success: true, message: "No windows match this change type and risk level. Ask an admin to configure appropriate deployment windows.", data: { scheduled: false } };
  }

  // Update RFC with deployment window info
  const rfc = promotion.changeItem?.changeRequest;
  if (rfc) {
    await prisma.changeRequest.update({
      where: { id: rfc.id },
      data: {
        status: "scheduled",
        scheduledAt: new Date(),
        deploymentWindowId: matchingWindows[0]!.id,
      },
    });
  }

  const windowDesc = matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ");

  // Persist the scheduled state on the ChangePromotion so getBuildFlowState
  // reads it without peeking at ChangeRequest. deploymentLog carries the
  // window description so the fork can render "Scheduled for <window>".
  await prisma.changePromotion.update({
    where: { promotionId },
    data: { status: "scheduled", deploymentLog: `window: ${windowDesc}` },
  }).catch(() => {});

  logBuildActivity(promotionId, "schedule_promotion", `Scheduled for window: ${windowDesc}`);

  const scheduleBuildId = promotion.productVersion?.featureBuild?.buildId ?? null;
  if (scheduleBuildId) {
    const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
    await reconcileBuildCompletion(scheduleBuildId).catch(() => {});
  }

  return {
    success: true,
    message: `Promotion ${promotionId} scheduled. Deployment windows: ${windowDesc}. An operator can deploy via Operations > Promotions during an open window.`,
    data: { scheduled: true, windows: windowDesc },
  };
}

async function executePromotion(params: Record<string, unknown>): Promise<ToolResult> {
  const promotionId = String(params.promotion_id ?? "");
  const overrideReason = params.override_reason ? String(params.override_reason) : undefined;
  if (!promotionId || !/^[a-zA-Z0-9_-]+$/.test(promotionId)) {
    return { success: false, error: "Invalid promotion_id", message: "Provide a valid promotion ID." };
  }

  // Validate promotion exists and is approved
  const promo = await prisma.changePromotion.findFirst({ where: { promotionId } });
  if (!promo) return { success: false, error: "Not found", message: `Promotion ${promotionId} not found.` };
  if (promo.status === "deployed") return { success: true, message: "Already deployed.", data: { status: "deployed" } };
  if (promo.status !== "approved") return { success: false, error: `Status is ${promo.status}`, message: "Must be approved first." };

  // Enforce deployment window — block execution outside windows unless emergency override
  if (!overrideReason) {
    const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
    const windowStatus = await getPromotionWindowStatus(promotionId);
    if (!windowStatus.available) {
      return {
        success: false,
        error: "Outside deployment window",
        message: `${windowStatus.message} Use schedule_promotion to queue for the next window, or provide override_reason for emergency deployment.`,
      };
    }
  }

  // Resolve the originating build (for activity logging + fork reconciliation).
  const promoDetail = await prisma.changePromotion.findFirst({
    where: { promotionId },
    include: { productVersion: { include: { featureBuild: { select: { buildId: true } } } } },
  });
  const promoBuildId = promoDetail?.productVersion?.featureBuild?.buildId;

  // Deploy through the in-portal ChangePromotion pipeline: backup production
  // DB → scan destructive migrations → apply patch → post-deploy health check →
  // mark deployed, or roll back (restore DB + revert code) with a recorded
  // rollbackReason. This is the deployer that actually services a change
  // promotion. The `dpf-promoter` image is a SELF-UPGRADE-ONLY contract:
  // its promote.sh hard-requires the `--self-upgrade` flag and the
  // PROMOTE_SOURCE/PROMOTE_TARGET_SHA/… env, so launching it for a
  // ChangePromotion (PROMOTION_ID env, no flag) made promote.sh exit 1 at its
  // guard — the container died non-zero, the promotion never reached
  // "deployed", and no rollbackReason was ever set, so this tool logged the
  // bare "Rolled back: unknown". BI-B8A6E80B routes change promotions to the
  // deployer whose contract matches the operation.
  const { executePromotion: runInPortalPromotion } = await import("@/lib/sandbox-promotion");
  const result = await runInPortalPromotion(promotionId, overrideReason);

  const finalPromo = await prisma.changePromotion.findFirst({ where: { promotionId } });
  const rolledBack = finalPromo?.status === "rolled_back";

  logBuildActivity(
    promoBuildId ?? promotionId,
    "execute_promotion",
    result.success
      ? "Deployed successfully"
      : rolledBack
        ? `Rolled back: ${finalPromo?.rollbackReason ?? result.message ?? "see deployment log"}`
        : `Not deployed: ${result.message}`,
  );

  if (promoBuildId) {
    const { reconcileBuildCompletion } = await import("@/lib/build-flow-state");
    await reconcileBuildCompletion(promoBuildId).catch(() => {});
  }

  return {
    success: result.success,
    message: result.success
      ? `Promotion ${promotionId} deployed. Health check passed.`
      : result.message,
    data: { promotionId, status: finalPromo?.status, deploymentLog: finalPromo?.deploymentLog?.slice(0, 1000) },
  };
}

async function createReleaseBundle(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const title = String(params.title ?? "");
  const buildIds = Array.isArray(params.build_ids) ? params.build_ids.map(String) : [];
  if (!title) return { success: false, error: "title is required.", message: "Provide a release bundle title." };
  if (buildIds.length === 0) return { success: false, error: "build_ids is required.", message: "Provide at least one build ID." };

  // Validate all builds exist and are in review/complete phase
  const builds = await prisma.featureBuild.findMany({
    where: { buildId: { in: buildIds } },
    select: { buildId: true, title: true, phase: true, releaseBundleId: true },
  });
  const missing = buildIds.filter((id) => !builds.some((b) => b.buildId === id));
  if (missing.length > 0) return { success: false, error: `Builds not found: ${missing.join(", ")}`, message: `Could not find builds: ${missing.join(", ")}` };

  const notReady = builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
  if (notReady.length > 0) {
    return { success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`, message: `All builds must be in review or complete phase.` };
  }

  const alreadyBundled = builds.filter((b) => b.releaseBundleId);
  if (alreadyBundled.length > 0) {
    return { success: false, error: `Builds already in a bundle: ${alreadyBundled.map((b) => b.buildId).join(", ")}`, message: `Remove from existing bundle first.` };
  }

  // Create the bundle
  const bundleId = `RB-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const bundle = await prisma.releaseBundle.create({
    data: {
      bundleId,
      title,
      status: "assembling",
      createdBy: userId,
    },
  });

  // Link builds to the bundle
  await prisma.featureBuild.updateMany({
    where: { buildId: { in: buildIds } },
    data: { releaseBundleId: bundle.id },
  });

  return {
    success: true,
    message: `Release bundle ${bundleId} created with ${buildIds.length} build(s): ${builds.map((b) => b.title).join(", ")}. Run gate checks before scheduling deployment.`,
    data: { bundleId, title, buildCount: buildIds.length, builds: builds.map((b) => ({ buildId: b.buildId, title: b.title })) },
  };
}

async function runReleaseGate(params: Record<string, unknown>): Promise<ToolResult> {
  const bundleId = String(params.bundle_id ?? "");
  if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

  const bundle = await prisma.releaseBundle.findUnique({
    where: { bundleId },
    include: {
      builds: {
        select: {
          buildId: true, title: true, phase: true, diffPatch: true,
          verificationOut: true, sandboxId: true,
        },
      },
    },
  });
  if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
  if (bundle.status !== "assembling") {
    return { success: false, error: `Gate check already run. Bundle status: ${bundle.status}`, message: `Bundle is in ${bundle.status} state.` };
  }
  if (bundle.builds.length === 0) {
    return { success: false, error: "Bundle has no builds.", message: "Add builds to the bundle first." };
  }

  // Check all builds are in review/complete/ship phase
  const notReady = bundle.builds.filter((b) => !["review", "complete", "ship"].includes(b.phase));
  if (notReady.length > 0) {
    return {
      success: false, error: `Builds not ready: ${notReady.map((b) => `${b.buildId} (${b.phase})`).join(", ")}`,
      message: "All builds must be in review or complete phase.",
    };
  }

  // Check all builds have passing tests
  const failedTests = bundle.builds.filter((b) => {
    const v = b.verificationOut as Record<string, unknown> | null;
    return v && (v.testsPassed === false || v.testsPassed === 0);
  });

  // Combine diffs from all builds
  const diffs: string[] = [];
  for (const build of bundle.builds) {
    if (build.diffPatch) {
      diffs.push(build.diffPatch as string);
    } else if (build.sandboxId) {
      try {
        const { extractDiff } = await import("@/lib/sandbox");
        const diff = await extractDiff(build.sandboxId);
        diffs.push(diff);
      } catch {
        // Build has no extractable diff — may be fine if it's code-only
      }
    }
  }

  const combinedDiff = diffs.join("\n");

  // Scan for destructive operations
  const { scanForDestructiveOps, categorizeDiffFiles } = await import("@/lib/sandbox-promotion");
  const allFileMatches = [...combinedDiff.matchAll(/^diff --git a\/(.+) b\/.+$/gm)].map((m) => m[1]);
  const { migrationFiles } = categorizeDiffFiles(allFileMatches);
  const destructiveWarnings = migrationFiles.length > 0 ? scanForDestructiveOps(combinedDiff) : [];

  // Build gate check result
  const gateResult = {
    buildsChecked: bundle.builds.length,
    allTestsPass: failedTests.length === 0,
    failedTestBuilds: failedTests.map((b) => b.buildId),
    totalFilesChanged: allFileMatches.length,
    migrationFiles: migrationFiles.length,
    destructiveWarnings,
    combinedDiffLength: combinedDiff.length,
  };

  const passed = failedTests.length === 0 && destructiveWarnings.length === 0;

  // Update bundle
  await prisma.releaseBundle.update({
    where: { bundleId },
    data: {
      status: passed ? "approved" : "gate_check",
      combinedDiffPatch: combinedDiff,
      gateCheckResult: gateResult as unknown as import("@dpf/db").Prisma.InputJsonValue,
    },
  });

  const messageParts = [
    `Gate check ${passed ? "PASSED" : "FAILED"} for ${bundleId}.`,
    `${bundle.builds.length} build(s), ${allFileMatches.length} file(s) changed, ${migrationFiles.length} migration(s).`,
  ];
  if (failedTests.length > 0) messageParts.push(`Failing tests in: ${failedTests.map((b) => b.buildId).join(", ")}.`);
  if (destructiveWarnings.length > 0) messageParts.push(`Destructive ops: ${destructiveWarnings.join("; ")}`);
  if (passed) messageParts.push("Bundle is approved and ready to schedule for deployment.");

  return { success: true, message: messageParts.join(" "), data: gateResult };
}

async function scheduleReleaseBundle(params: Record<string, unknown>): Promise<ToolResult> {
  const bundleId = String(params.bundle_id ?? "");
  if (!bundleId) return { success: false, error: "bundle_id is required.", message: "Provide a release bundle ID." };

  const bundle = await prisma.releaseBundle.findUnique({
    where: { bundleId },
    include: { builds: { select: { buildId: true, title: true, createdById: true } } },
  });
  if (!bundle) return { success: false, error: "Bundle not found.", message: `No bundle ${bundleId}.` };
  if (bundle.status !== "approved") {
    return { success: false, error: `Bundle must be approved first. Current: ${bundle.status}`, message: `Run gate checks first.` };
  }

  // Find next available deployment window
  const profile = await prisma.businessProfile.findFirst({
    where: { isActive: true },
    include: { deploymentWindows: true },
  });

  const matchingWindows = profile?.deploymentWindows.filter(
    (w) => w.allowedChangeTypes.includes("normal") && w.allowedRiskLevels.includes("low"),
  ) ?? [];

  // Create RFC for the bundle
  const rfcId = `RFC-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const rfc = await prisma.changeRequest.create({
    data: {
      rfcId,
      title: `Release: ${bundle.title}`,
      description: `Release bundle ${bundleId} with ${bundle.builds.length} build(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
      type: "normal",
      scope: "platform",
      riskLevel: "low",
      status: "scheduled",
      scheduledAt: new Date(),
      requestedById: bundle.createdBy,
      ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
    },
  });

  // Create CalendarEvent for visibility
  const employee = await prisma.employeeProfile.findFirst({
    where: { userId: bundle.createdBy },
    select: { id: true },
  });

  let calendarEventId: string | undefined;
  if (employee) {
    const eventId = `RELEASE-${bundleId}`;
    await prisma.calendarEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        title: `Deployment: ${bundle.title}`,
        description: `${bundle.builds.length} feature(s): ${bundle.builds.map((b) => b.title).join(", ")}`,
        startAt: new Date(),
        eventType: "action",
        category: "platform",
        ownerEmployeeId: employee.id,
        visibility: "team",
        color: "#f59e0b", // style-drift-allow -- persisted calendar color, not CSS
      },
      update: { title: `Deployment: ${bundle.title}`, startAt: new Date() },
    });
    calendarEventId = eventId;
  }

  // Update bundle
  await prisma.releaseBundle.update({
    where: { bundleId },
    data: {
      status: "scheduled",
      rfcId: rfc.rfcId,
      calendarEventId,
      scheduledAt: new Date(),
      ...(matchingWindows.length > 0 ? { deploymentWindowId: matchingWindows[0]!.id } : {}),
    },
  });

  const windowDesc = matchingWindows.length > 0
    ? matchingWindows.map((w) => `${w.name}: days ${w.dayOfWeek.join(",")}, ${w.startTime}-${w.endTime}`).join("; ")
    : "No windows configured — deployment unrestricted";

  return {
    success: true,
    message: `Release ${bundleId} scheduled. RFC: ${rfcId}. Added to operations calendar. Windows: ${windowDesc}. An operator can deploy via Operations > Promotions.`,
    data: { bundleId, rfcId, calendarEventId, windows: windowDesc },
  };
}

async function getReleaseStatus(params: Record<string, unknown>): Promise<ToolResult> {
  const bundleId = params.bundle_id ? String(params.bundle_id) : null;
  const promotionId = params.promotion_id ? String(params.promotion_id) : null;

  if (bundleId) {
    const bundle = await prisma.releaseBundle.findUnique({
      where: { bundleId },
      include: { builds: { select: { buildId: true, title: true, phase: true } } },
    });
    if (!bundle) return { success: false, error: "Bundle not found.", message: `No release bundle with ID ${bundleId}.` };
    return {
      success: true,
      message: `Release ${bundle.bundleId}: ${bundle.status}. ${bundle.builds.length} build(s).`,
      data: {
        bundleId: bundle.bundleId,
        title: bundle.title,
        status: bundle.status,
        builds: bundle.builds,
        scheduledAt: bundle.scheduledAt?.toISOString() ?? null,
        deployedAt: bundle.deployedAt?.toISOString() ?? null,
      },
    };
  }

  if (promotionId) {
    const { getPromotionWindowStatus } = await import("@/lib/actions/promotions");
    const windowStatus = await getPromotionWindowStatus(promotionId).catch(() => ({ available: false, message: "Could not check window status" }));
    const promotion = await prisma.changePromotion.findUnique({
      where: { promotionId },
      select: { status: true, deployedAt: true, rationale: true, rollbackReason: true },
    });
    if (!promotion) return { success: false, error: "Promotion not found.", message: `No promotion with ID ${promotionId}.` };
    return {
      success: true,
      message: `Promotion ${promotionId}: ${promotion.status}. Window: ${windowStatus.message}`,
      data: { promotionId, ...promotion, windowStatus },
    };
  }

  return { success: false, error: "Provide bundle_id or promotion_id.", message: "Specify which release or promotion to check." };
}

const handlers: Record<string, ToolPackHandler> = {
  check_deployment_windows: (params) => checkDeploymentWindows(params),
  schedule_promotion: (params) => schedulePromotion(params),
  execute_promotion: (params) => executePromotion(params),
  create_release_bundle: (params, userId) => createReleaseBundle(params, userId),
  run_release_gate: (params) => runReleaseGate(params),
  schedule_release_bundle: (params) => scheduleReleaseBundle(params),
  get_release_status: (params) => getReleaseStatus(params),
};

export const releasePack: ToolPack = {
  packId: "release",
  definitions,
  handlers,
  grants: {
    check_deployment_windows: ["deployment_plan_create"],
    schedule_promotion: ["deployment_plan_create"],
    execute_promotion: ["iac_execute"],
    create_release_bundle: ["release_gate_create"],
    run_release_gate: ["release_gate_create"],
    schedule_release_bundle: ["release_plan_create"],
    get_release_status: ["release_plan_read"],
  },
};
