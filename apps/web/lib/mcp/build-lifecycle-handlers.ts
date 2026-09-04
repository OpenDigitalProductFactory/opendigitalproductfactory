// Build-lifecycle tool handlers — BI-ARCH-TOOLPACKS.
//
// The ideate/plan/brief/verify handlers for build-lifecycle-pack.ts, split
// into a sibling module so the pack file stays under the module-size cap. Each
// function reproduces its former mcp-tools.ts executeTool case verbatim — same
// lazy imports, same branches, same return shapes — so behaviour is identical
// over MCP. The two large ship handlers live in build-ship-handlers.ts.

import { prisma } from "@dpf/db";

import type { ToolResult } from "@/lib/mcp-tools";
import type { ToolPackHandler } from "./tool-pack";
import {
  resolveActiveBuildId,
  extractBuildIdHint,
  logBuildActivity,
  updateBuildHappyPathState,
} from "@/lib/mcp/build-tool-helpers";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import { enforceBuildInitiativeReadiness } from "@/lib/build/build-entry-gate";
import { resolveIdeateBuildForToolPure } from "@/lib/build/ideate-build-resolution";
import { formatUpdateFeatureBriefError } from "./update-feature-brief-error";

export { formatUpdateFeatureBriefError } from "./update-feature-brief-error";

type HandlerContext = Parameters<ToolPackHandler>[2];

// Local wrapper mirroring the one still inline in mcp-tools.ts (which stays for
// its other callers). Injects the prisma queries into the pure resolver.
async function resolveIdeateBuildForTool(args: {
  contextBuildId?: string;
  toolName: string;
}) {
  return resolveIdeateBuildForToolPure(args, {
    findUniqueBuild: async (buildId) =>
      prisma.featureBuild.findUnique({
        where: { buildId },
        select: { buildId: true, phase: true },
      }),
    findIdeateBuilds: async () =>
      prisma.featureBuild.findMany({
        where: { phase: "ideate" },
        orderBy: { updatedAt: "desc" },
        select: { buildId: true },
        take: 2, // only need to distinguish 0 / 1 / 2+
      }),
  });
}

export async function updateFeatureBrief(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const { updateFeatureBrief } = await import("@/lib/actions/build");
  // Merge OVER the existing brief. updateFeatureBrief persists the whole
  // brief object, so rebuilding it from scratch would clobber any field the
  // caller omits — notably fixContext, which the fix-flow ideate phase fills
  // incrementally. A fix build is also promoted with title/description
  // pre-seeded on the FeatureBuild row; without merge + row fallback a
  // fixContext-only update blanked title/description, failed validation, and
  // was misreported as "past ideate" (BI-PIR-f8c1640b / BI-PIR-309fb74b).
  const row = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { brief: true, title: true, description: true, phase: true },
  });
  const prior = row?.brief as Partial<import("@/lib/feature-build-types").FeatureBrief> | null;
  const str = (key: string, fallback: string) =>
    params[key] != null ? String(params[key]) : fallback;
  const arr = (key: string, fallback: string[]) =>
    Array.isArray(params[key]) ? (params[key] as unknown[]).map(String) : fallback;
  const incomingFix = params["fixContext"] && typeof params["fixContext"] === "object" && !Array.isArray(params["fixContext"])
    ? (params["fixContext"] as Record<string, unknown>)
    : null;
  const mergedFix = (prior?.fixContext || incomingFix)
    ? { ...(prior?.fixContext ?? {}), ...(incomingFix ?? {}) }
    : undefined;
  const brief = {
    title: str("title", prior?.title ?? row?.title ?? ""),
    description: str("description", prior?.description ?? row?.description ?? ""),
    portfolioContext: str("portfolioContext", prior?.portfolioContext ?? ""),
    targetRoles: arr("targetRoles", prior?.targetRoles ?? []),
    inputs: arr("inputs", prior?.inputs ?? []),
    dataNeeds: str("dataNeeds", prior?.dataNeeds ?? ""),
    acceptanceCriteria: arr("acceptanceCriteria", prior?.acceptanceCriteria ?? []),
    ...(mergedFix ? { fixContext: mergedFix } : {}),
  };
  try {
    await updateFeatureBrief(
      buildId,
      brief as import("@/lib/feature-build-types").FeatureBrief,
      // The MCP server resolved this actor from the authenticated subject and
      // active build. Preserve it across the session-less action boundary;
      // updateFeatureBrief still enforces exact build ownership.
      { actorUserId: userId },
    );
    await updateBuildHappyPathState(userId, {
      intake: {
        constrainedGoal: brief.title || null,
      },
    }, buildId);
  } catch (err) {
    const formatted = formatUpdateFeatureBriefError(err);
    return { success: false, error: formatted.error, message: formatted.message };
  }
  return { success: true, entityId: buildId, message: `Updated Feature Brief for ${buildId}` };
}

export async function registerDigitalProductFromBuild(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  // Pre-flight: deploy_feature must have run first to extract the diff.
  const diffCheck = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { diffPatch: true },
  });
  if (!diffCheck?.diffPatch) {
    return {
      success: false,
      error: "deploy_feature must be called first",
      message: "The sandbox diff has not been extracted yet. Call deploy_feature first to extract the diff, then call register_digital_product_from_build.",
    };
  }
  const { shipBuild } = await import("@/lib/actions/build");
  try {
    const result = await shipBuild({
      buildId,
      name: String(params["name"]),
      portfolioSlug: String(params["portfolioSlug"]),
      versionBump: (params["versionBump"] as "major" | "minor" | "patch") ?? "minor",
      // Thread the MCP actor through so this works in a session-less context
      // (autonomous ship from the reconciler). UI callers go through the
      // session as before; shipBuild falls back to requireBuildAccess().
      actorUserId: userId,
    });
    return {
      success: true,
      entityId: result.productId,
      message: result.message,
      data: {
        productInternalId: result.productInternalId,
        portfolioInternalId: result.portfolioInternalId,
        promotionId: result.promotionId,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ship failed";
    return { success: false, error: msg, message: `Product registration failed: ${msg}` };
  }
}

export async function createBuildEpic(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const epicBuildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!epicBuildId) return { success: false, error: "No active build", message: "No active build found" };
  // Auto-resolve digitalProductId and portfolioSlug from the build's linked product
  const epicBuild = await prisma.featureBuild.findUnique({
    where: { buildId: epicBuildId },
    select: {
      digitalProductId: true,
      portfolioId: true,
      digitalProduct: { select: { portfolio: { select: { slug: true } } } },
    },
  });
  const resolvedProductId = epicBuild?.digitalProductId ?? undefined;
  const resolvedPortfolioSlug = typeof params["portfolioSlug"] === "string"
    ? params["portfolioSlug"]
    : epicBuild?.digitalProduct?.portfolio?.slug ?? undefined;

  const { createBuildEpic } = await import("@/lib/actions/build");
  const epicInput: { buildId: string; title: string; portfolioSlug?: string; digitalProductId?: string } = {
    buildId: epicBuildId,
    title: String(params["title"]),
  };
  if (resolvedPortfolioSlug) epicInput.portfolioSlug = resolvedPortfolioSlug;
  if (resolvedProductId) epicInput.digitalProductId = resolvedProductId;
  try {
    const result = await createBuildEpic(epicInput);
    await updateBuildHappyPathState(userId, {
      intake: {
        epicId: result.epicId,
      },
    }, epicBuildId);
    return { success: true, entityId: result.epicId, message: result.message };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Epic creation failed";
    return { success: false, error: msg, message: `Could not create epic: ${msg}` };
  }
}

export async function verificationPreflight(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build", message: "No active build found" };
  const build = await prisma.featureBuild.findUnique({
    where: { buildId },
    select: { phase: true, acceptanceMet: true, verificationOut: true, buildExecState: true },
  });
  if (!build) return { success: false, error: "Build not found", message: `Build ${buildId} was not found.` };
  const { verificationPreflight, gatherPreflightSignals, preflightDirective } = await import(
    "@/lib/build/verification-preflight"
  );
  // The portal serving this tool is up (installHealthy) and its DB is reachable
  // (this row just loaded). Sandbox/quiescence probes are a follow-up refinement;
  // for now they default healthy so the verdict turns on evidence + artifact.
  const signals = gatherPreflightSignals(build, {
    installHealthy: true,
    requiredServicesHealthy: true,
    explicitBlocker: null,
  });
  const result = verificationPreflight(signals);
  return {
    success: true,
    entityId: buildId,
    message: preflightDirective(result),
    data: { verdict: result.verdict, reason: result.reason, blocker: result.blocker },
  };
}

export async function startBuild(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const readiness = await enforceBuildInitiativeReadiness({
    buildId, target: "implementation", targetPhase: "build", expectedPhase: "plan",
  });
  if (!readiness.allowed) {
    return { success: false, error: "initiative_not_ready", message: readiness.message, data: { readiness: readiness.decision } };
  }

  try {
    const { assertFeatureBuildDependenciesSatisfied } = await import("@/lib/build/feature-build-dependencies");
    await assertFeatureBuildDependenciesSatisfied({ db: prisma, buildId });
  } catch (err) {
    return {
      success: false,
      error: "Dependency gate blocked.",
      message: getErrorMessage(err),
    };
  }

  const { isSandboxAvailable, startBuildBranch } = await import("@/lib/build/sandbox/build-branch");

  const available = await isSandboxAvailable();
  if (!available) {
    return {
      success: false,
      error: "Sandbox container is not running.",
      message: "The sandbox is not running. Call check_sandbox to see the status, then start_sandbox if it is stopped.",
    };
  }

  await startBuildBranch(buildId);

  try {
    const { startSandboxDevServer } = await import("@/lib/sandbox");
    await startSandboxDevServer(process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1");
  } catch (devErr) {
    console.log(`[start_build] preview server start failed (non-fatal): ${(devErr as Error).message?.slice(0, 100)}`);
  }

  const { agentEventBus } = await import("@/lib/agent-event-bus");
  if (context?.threadId) agentEventBus.emit(context.threadId, { type: "phase:change", buildId, phase: "build" });
  logBuildActivity(buildId, "start_build", `Build branch ready for ${buildId}.`);
  return {
    success: true,
    message: `Build workspace ready. Sandbox is running on port ${process.env.SANDBOX_PORT ?? "3035"}. Start writing files.`,
    entityId: buildId,
    data: { containerId: process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1", port: Number(process.env.SANDBOX_PORT ?? "3035") },
  };
}


export async function runUxTest(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  const buildId = await resolveActiveBuildId(userId, extractBuildIdHint(params));
  if (!buildId) return { success: false, error: "No active build.", message: "No active build." };
  const build = await prisma.featureBuild.findUnique({ where: { buildId }, select: { sandboxId: true, sandboxPort: true, brief: true, kind: true } });
  if (!build?.sandboxPort || !build.sandboxId || !build.brief) return { success: false, error: "Sandbox or brief not ready.", message: "Launch sandbox and save brief first." };

  const { deriveFixUxTestCases } = await import("@/lib/explore/feature-build-types");
  const brief = build.brief as {
    acceptanceCriteria?: string[];
    fixContext?: import("@/lib/explore/feature-build-types").FixContext;
  };
  // Explicit `tests` always win. Otherwise, for a fix build derive the
  // assertion from the structured fix diagnosis (defect-gone on its route)
  // rather than the polluted feature acceptanceCriteria. (BI-AC5CFDB0)
  const testCases =
    (params.tests as string[] | undefined) ??
    (build.kind === "fix"
      ? deriveFixUxTestCases(brief.fixContext)
      : brief.acceptanceCriteria ?? []);
  if (testCases.length === 0) return { success: false, error: "No test cases.", message: build.kind === "fix" ? "No fix context (route/expected) or test cases to verify." : "No acceptance criteria or test cases to run." };

  try {
    const BROWSER_USE_URL = process.env.BROWSER_USE_URL || "http://browser-use:8500/mcp";
    // browser-use runs inside the docker compose network — use the
    // internal service URL (http://sandbox:3000), not the host port,
    // so assets and API calls resolve correctly.
    const { resolveSandboxUrl } = await import("@/lib/build/sandbox/resolve-sandbox-url");
    const sandboxUrl = resolveSandboxUrl(build.sandboxId, build.sandboxPort).internal;

    const testRes = await fetch(BROWSER_USE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "browse_run_tests",
          arguments: {
            url: sandboxUrl,
            tests: testCases,
            // Scope per-step screenshots to a build-specific subdir on
            // the shared /evidence volume. Portal serves them through
            // /api/build/<buildId>/evidence/<file>.png.
            evidence_dir: `build_${buildId}`,
          },
        },
      }),
      signal: AbortSignal.timeout(300000), // 5 min for full test suite
    });
    const testResult = await testRes.json();
    const testContent = JSON.parse(testResult?.result?.content?.[0]?.text ?? "{}");

    // BI-1BAA177C: a degraded run means the agent could not drive the browser
    // at all — it is NOT-RUN evidence, never pass/fail. Do not persist steps
    // (uxVerificationStatus stays unset, so the ship gate keeps blocking) and
    // say so plainly instead of surfacing 0/N "failures".
    if (testContent.degraded === true) {
      const reason = typeof testContent.reason === "string" ? testContent.reason : "browser agent could not run";
      logBuildActivity(buildId, "run_ux_test", `UX tests DEGRADED (not run): ${reason}`);
      return {
        success: false,
        error: `UX verification DEGRADED — tests did not run: ${reason}`,
        message: `UX verification did not run: the browser-use agent could not drive its browser (${reason}). This is a NOT-RUN, not a failure of the UI. Check 'docker logs dpf-browser-use-1' and GET /health/capability on the sidecar; re-run once the probe reports capable.`,
      };
    }

    // Convert to UxTestStep format for storage. screenshot_path (when
    // present) is a filename inside the evidence_dir — turn it into a
    // portal-served URL the ReviewPanel can render.
    const steps = (testContent.results ?? []).map((r: Record<string, unknown>, i: number) => ({
      step: (r.test as string) ?? `Test ${i + 1}`,
      passed: r.status === "pass",
      screenshotUrl: typeof r.screenshot_path === "string"
        ? `/api/build/${encodeURIComponent(buildId)}/evidence/${encodeURIComponent(r.screenshot_path)}`
        : null,
      error: r.status !== "pass" ? ((r.detail as string) ?? null) : null,
    }));

    const { agentEventBus } = await import("@/lib/agent-event-bus");
    for (let i = 0; i < steps.length; i++) {
      if (context?.threadId) {
        agentEventBus.emit(context.threadId, {
          type: "test:step",
          stepIndex: i,
          description: steps[i]!.step,
          passed: steps[i]!.passed,
        });
      }
    }
    const { saveBuildArtifactRevision } = await import("@/lib/build/build-artifact-provenance");
    await saveBuildArtifactRevision({
      buildId,
      field: "uxTestResults",
      savedByAgentId: context?.agentId ?? null,
      savedByUserId: userId,
      threadId: context?.threadId ?? null,
      value: steps,
    });
    if (context?.threadId) agentEventBus.emit(context.threadId, { type: "evidence:update", buildId, field: "uxTestResults" });
    const passed = steps.filter((s: { passed: boolean }) => s.passed).length;
    logBuildActivity(buildId, "run_ux_test", `UX tests: ${passed}/${steps.length} passed (browser-use).`);
    return {
      success: true,
      message: `UX tests: ${passed}/${steps.length} passed.`,
      data: { buildId, steps, browserUseResults: testContent },
    };
  } catch (err) {
    const msg = (err as Error).message?.slice(0, 200) ?? "Unknown error";
    return { success: false, error: `UX test run failed: ${msg}`, message: `UX verification service (browser-use) is unreachable. Run 'docker compose up -d browser-use' or check the browser-use container logs. You can skip UX tests and proceed with the review if you have to.` };
  }
}

export async function startIdeateResearch(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  // This tool is a signal — the actual research dispatch happens in
  // agent-coworker.ts after the agentic loop returns. We just persist
  // the user context so the dispatch knows what to research.
  const scope = String(params.reusabilityScope ?? "parameterizable");
  const userCtx = String(params.userContext ?? "");

  // BI-F4A30FCB (Dale dogfood 2026-05-24): resolve the target build
  // from agent context first. The previous "findFirst by phase=ideate
  // ordered by updatedAt" silently mis-targeted whenever multiple
  // builds were in ideate concurrently — the user's request landed on
  // an unrelated build whose updatedAt happened to be newer.
  // An explicit buildId param wins over the ambient conversation context:
  // it lets an operator/agent drive a chosen build's research even when
  // several builds are in-flight (autonomous batch). When omitted, the
  // exact prior ambient-resolution behavior is preserved.
  const activeBuild = await resolveIdeateBuildForTool({
    contextBuildId: extractBuildIdHint(params) ?? (context as { featureBuildId?: string } | undefined)?.featureBuildId,
    toolName: "start_ideate_research",
  });
  if (!activeBuild.build) {
    return activeBuild.refusal;
  }

  await prisma.featureBuild.update({
    where: { buildId: activeBuild.build.buildId },
    data: {
      buildExecState: {
        ideateResearchRequested: true,
        reusabilityScope: scope,
        userContext: userCtx,
        requestedAt: new Date().toISOString(),
      },
    },
  });

  return {
    success: true,
    message: "Research started. Searching the codebase and drafting the design document — this takes about 1-2 minutes. Tell the user you're researching now. IMPORTANT: Do NOT call saveBuildEvidence with field 'designDoc' — the research system saves the design document and runs the review automatically when research completes. Just wait and tell the user.",
    data: { reusabilityScope: scope, userContext: userCtx, buildId: activeBuild.build.buildId },
  };
}

export async function startScoutResearch(params: Record<string, unknown>, userId: string, context?: HandlerContext): Promise<ToolResult> {
  // Scout dispatch: similar to ideate research, but runs a fast parallel search + URL fetch
  const externalUrls = (params.externalUrls as string[] | undefined) ?? [];

  // BI-F4A30FCB (Dale dogfood 2026-05-24): resolve the target build
  // from agent context first; see start_ideate_research comment above.
  // BI-7FEAFD9A (2026-07-05): prefer the FB- hint from params.buildId
  // (set by the executeTool preamble from the context cuid) — passing the
  // raw context.featureBuildId cuid here made the resolver's
  // where:{buildId} lookup a guaranteed miss, so scout always refused.
  const resolved = await resolveIdeateBuildForTool({
    contextBuildId: extractBuildIdHint(params) ?? (context as { featureBuildId?: string } | undefined)?.featureBuildId,
    toolName: "start_scout_research",
  });
  if (!resolved.build) {
    return resolved.refusal;
  }
  const activeBuild = await prisma.featureBuild.findUnique({
    where: { buildId: resolved.build.buildId },
    select: { buildId: true, buildExecState: true, scoutFindings: true },
  });
  if (!activeBuild) {
    return { success: false, message: "Active ideate build vanished between resolve and read — try again." };
  }

  const current = activeBuild.buildExecState as Record<string, unknown> | null;

  // Idempotency: if scout has already delivered findings, do NOT re-run.
  // The agentic loop otherwise re-calls this tool every iteration because
  // the initial response says "results will appear on the next turn" and
  // the model doesn't see the findings in its prompt context. The stuck-
  // detector eventually bails, but not before burning 4-5 iterations and
  // preventing phase advance. Tell the agent plainly the work is done.
  if (activeBuild.scoutFindings !== null && activeBuild.scoutFindings !== undefined) {
    return {
      success: true,
      message:
        "Scout already ran for this build. Findings are saved to Build Studio Context — proceed with ideate using the existing scout results; do NOT call start_scout_research again.",
      data: { alreadyComplete: true },
    };
  }

  // Idempotency: if a scout request is already pending dispatch (flag set
  // by a prior call but not yet cleared by the coworker post-turn hook),
  // don't stack up another request. Same guidance.
  if (current?.scoutResearchRequested === true) {
    return {
      success: true,
      message:
        "Scout already requested and is running now. Wait for the next turn to see findings — do NOT call start_scout_research again.",
      data: { alreadyRequested: true },
    };
  }

  await prisma.featureBuild.update({
    where: { buildId: activeBuild.buildId },
    data: {
      buildExecState: {
        ...(current ?? {}),
        scoutResearchRequested: true,
        scoutUrls: externalUrls,
        scoutRequestedAt: new Date().toISOString(),
      },
    },
  });

  return {
    success: true,
    message: "Scout started. Codebase search and URL parsing running in background — takes about 30 seconds. Results will appear in your Build Studio Context on the next turn. Do NOT call start_scout_research again; wait for the results.",
    data: { urlCount: externalUrls.length },
  };
}
