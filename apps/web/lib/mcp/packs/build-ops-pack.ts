// Build-ops tool pack — scoped ToolPack extraction.
//
// Drains a set of self-contained build/lifecycle operations out of the
// mcp-tools.ts executeTool switch:
//   - propose_file_change            propose + auto-commit a project file change
//   - run_tool_script                governed read-only programmatic tool calling
//   - run_endpoint_tests             agent test harness against a scoped endpoint
//   - verify_live_install_readiness  preflight a feature against the live install
//   - update_lifecycle               update a digital product's lifecycle stage
//   - promote_to_build_studio        promote a triaged backlog item to a build
//   - generate_code                  removed tool; dispatch-only removed guard
//
// Each handler reproduces the former switch case verbatim (dynamic imports
// retargeted to absolute @/lib paths), so behaviour is identical when a tool is
// invoked over MCP. Definitions moved verbatim out of the inline PLATFORM_TOOLS
// array; grants mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating
// source.
//
// generate_code is a removed tool: the switch keeps only a shared removed-guard
// return (it fell through with iterate_sandbox, which stays inline). Here it
// registers a handler but no definition, matching how it was never advertised.
//
// The endpoint-test handler used two local helpers in mcp-tools.ts
// (buildEndpointTestRunRequest + a non-exported model resolver); they are
// replicated here so the pack is self-contained without a runtime import cycle.

import { prisma } from "@dpf/db";
import { inferProviderIdFromRouteContext } from "@/lib/ai-provider-route-context";
import { promoteBacklogItemToBuildDraft } from "@/lib/governed-backlog-tee-up";

import type { EndpointTestRunRequest, ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";
import type { UnifiedWipDb } from "@/lib/build/unified-wip-query";

const definitions: ToolDefinition[] = [
  {
    name: "promote_to_build_studio",
    description:
      "Promote a triaged backlog item (status=open, triageOutcome=build) to a FeatureBuild in Build Studio. Runs the Definition of Ready capacity check under an advisory-lock transaction. Refuses core-platform / architecturally-heavy items (schema, datastore, cross-cutting substrate, BET refactors) unless force=true — those route to a direct expert build. Authority-gated via the build_promote grant category.",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string", description: "The item ID to promote" },
        force: {
          type: "boolean",
          description:
            "Override the Build Studio suitability boundary for a core-platform item after explicit human confirmation (default false).",
        },
      },
      required: ["itemId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "abandon_stalled_build",
    description:
      "Abandon a build YOU own that has stalled or been superseded, freeing its Build Studio WIP slot. Restricted to builds created by the calling agent; refuses a build with an active task run in progress, an epic-decomposed child, or one that has had recent activity (unless it carries an explicit supersession marker). Requires a reason citing evidence (e.g. \"shipped elsewhere in PR #X\" or \"superseded by FB-Y\") — recorded as the audited abandon reason. Authority-gated via the build_lifecycle grant, the same grant that gates promoting a build into Build Studio.",
    inputSchema: {
      type: "object",
      properties: {
        buildId: { type: "string", description: "The FB-* build to abandon. Must be owned by the calling agent." },
        reason: {
          type: "string",
          description:
            "Evidence for why this build is stalled or superseded, e.g. \"shipped elsewhere in PR #1981\" or \"superseded by FB-...\". Required — becomes the audited abandon reason.",
        },
      },
      required: ["buildId", "reason"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
  },
  {
    name: "update_lifecycle",
    description: "Update a digital product's lifecycle stage and status",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product identifier" },
        lifecycleStage: { type: "string", enum: ["plan", "design", "build", "production", "retirement"] },
        lifecycleStatus: { type: "string", enum: ["draft", "active", "inactive"] },
      },
      required: ["productId"],
    },
    requiredCapability: "manage_backlog",
    sideEffect: true,
  },
  {
    name: "verify_live_install_readiness",
    description:
      "Preflight a feature against the live install before driving its happy path. Returns the same deterministic verdict as `pnpm verify:preflight` — CAN-TEST (served bytes contain the feature commit), MUST-ADVANCE (behind/unprovable → advance via the governed self-upgrade path), or BLOCKED (no testable runtime → file a BI and stop) — plus one next action. Surface-agnostic: identical verdict logic for CLI and in-portal/Build Studio. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        featureSha: {
          type: "string",
          description:
            "The commit the feature under test requires — a PR/BI merge SHA or a build's commit. Compared against the live install's served image identity.",
        },
      },
      required: ["featureSha"],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
  {
    name: "run_tool_script",
    description:
      "Run a short script that calls several READ-only tools and filters their results inside an isolated sandbox, returning only the small filtered result. Use instead of calling many read tools individually when results are large — e.g. scan N records and keep the few that match. The code is the body of an async run: call `await callTool(name, args)` for each tool, then `emit(value)` once with your final small result. Read-only: the script cannot call side-effecting tools. Disabled unless an operator has enabled it.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "Script body. You have `callTool(name, args)` (returns the tool's data) and `emit(value)` (return your final small result). Example: const r = await callTool('query_backlog', { status: 'open' }); emit(r.items.filter(i => i.priority === 'high').map(i => i.itemId));",
        },
        purpose: { type: "string", description: "One line describing what the script does (recorded for audit)." },
      },
      required: ["code"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false, // sandbox-isolated; inner calls are read-only + governed per call
  },
  {
    name: "propose_file_change",
    description: "Propose a change to a project file. Shows a diff for human review. Requires approval before the change is applied.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative file path to modify or create" },
        description: { type: "string", description: "Human-readable description of the change" },
        newContent: { type: "string", description: "The complete new file contents" },
      },
      required: ["path", "description", "newContent"],
    },
    requiredCapability: "manage_capabilities",
    sideEffect: true,
    buildPhases: ["build"],
  },
  {
    name: "run_endpoint_tests",
    description: "Run the agent test harness against a scoped endpoint. On provider detail routes, omit endpointId to use the current provider and default to quick probes. Set allEndpoints=true or allModels=true only when the user explicitly asks for exhaustive diagnostics.",
    inputSchema: {
      type: "object",
      properties: {
        endpointId: { type: "string", description: "Provider endpoint to test. Defaults to the current /platform/ai/providers/:providerId route when available." },
        modelId: { type: "string", description: "Optional model profile to test. Defaults to a representative active model for the endpoint." },
        taskType: { type: "string", description: "Run only scenarios for this task type (default: all)" },
        probesOnly: { type: "boolean", description: "Run only capability probes, skip scenarios (default: true for coworker calls)" },
        allEndpoints: { type: "boolean", description: "Explicitly test every active LLM endpoint. Use only when the user asks for all endpoints." },
        allModels: { type: "boolean", description: "Test every active model profile for the endpoint. Use only for exhaustive diagnostics." },
      },
    },
    requiredCapability: "manage_capabilities",
    executionMode: "immediate",
    sideEffect: true,
  },
];

async function promoteToBuildStudioHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const itemId = String(params["itemId"] ?? "");
  const force = params["force"] === true;
  const governedConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { governedBacklogEnabled: true },
  });
  const governedBacklogEnabled = governedConfig?.governedBacklogEnabled === true;

  // Build Studio suitability boundary (BI-4A30D8AC): refuse core-platform /
  // architecturally-heavy items unless force=true after human confirmation.
  {
    const item = await prisma.backlogItem.findFirst({
      where: { itemId },
      select: { title: true, body: true, workType: true },
    });
    if (item) {
      const { classifyArchitectureAltitude } = await import("@/lib/explore/architecture-altitude");
      const verdict = classifyArchitectureAltitude({
        title: item.title,
        body: item.body,
        workType: item.workType,
      });
      if (verdict.altitude === "core-platform" && !force) {
        return {
          success: false,
          error: "unsuitable_for_build_studio",
          message: verdict.reason ?? "Unsuitable for Build Studio",
          data: {
            architectureAltitude: verdict.altitude,
            signals: verdict.signals,
            route: "direct-expert-build",
          },
        };
      }
    }
  }

  // WIP cap (BI-937128F6; shared with the createFeatureBuild start path): refuse
  // to promote another build into Build Studio while the shared BS sandbox pool
  // is saturated. Pressure is now the unified, pool-aware count across ALL
  // surfaces' active WIP — a promote contends on the bs-sandbox pool, so it gates
  // on that pool (capacity BUILD_WIP_CAP, unchanged), not a BS-only build count.
  {
    const { decideUnifiedWip, BuildWipCapError } = await import("@/lib/build/wip-cap");
    const { loadActiveUnifiedWip, poolPressure } = await import(
      "@/lib/build/unified-wip-query"
    );
    const wip = await loadActiveUnifiedWip(prisma as unknown as UnifiedWipDb);
    const decision = decideUnifiedWip("bs-sandbox", poolPressure(wip, "bs-sandbox"));
    if (!decision.admitted) {
      const err = new BuildWipCapError(decision.pressure, decision.capacity);
      return { success: false, error: "wip_cap_reached", message: err.message };
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    return promoteBacklogItemToBuildDraft({
      tx,
      itemId,
      userId,
      governedBacklogEnabled,
    });
  });

  if (result.kind === "error") {
    return { success: false, error: result.error, message: result.message };
  }

  // Auto-dispatch Ideate after governed promotion.
  // The transaction inside promoteBacklogItemToBuildDraft set
  // draftApprovedAt for governed + non-empty-body promotions; that closes
  // the "Record Approve Start" gate but does NOT fire the Ideate research.
  // Mirror the approveBuildStart action's fire-and-forget pattern here so
  // the BS pipeline actually starts work without a second operator click.
  // Fire-and-forget on purpose: the operator's MCP call returns immediately
  // with the FB-* id, and the ~3-min Codex research runs async, exactly
  // like the manual UI button path. Errors are logged + written to
  // BuildActivity by the helper itself — never thrown out here.
  if (result.autoApprovedDispatchEligible) {
    void (async () => {
      try {
        const { dispatchIdeateForApprovedBuild } = await import("@/lib/integrate/ideate-on-approval");
        await dispatchIdeateForApprovedBuild({ buildId: result.build.buildId, userId });
      } catch (err) {
        console.error(
          "[promote_to_build_studio] auto-dispatch Ideate failed (handler swallowed by ideate-on-approval but the dynamic import or top-level invocation rejected):",
          { buildId: result.build.buildId },
          err,
        );
      }
    })();
  }

  return {
    success: true,
    entityId: result.build.buildId,
    message: result.autoApprovedDispatchEligible
      ? `Promoted ${itemId} to Build Studio (auto-approved under governed flow — Ideate research dispatched)`
      : `Promoted ${itemId} to Build Studio`,
    data: {
      buildId: result.build.buildId,
      backlogItemId: itemId,
      autoApprovedDispatchEligible: result.autoApprovedDispatchEligible,
    },
  };
}

async function abandonStalledBuildHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const buildId = String(params["buildId"] ?? "").trim();
  const reason = String(params["reason"] ?? "").trim();
  if (!buildId) {
    return { success: false, error: "missing_build_id", message: "buildId is required." };
  }
  if (!reason) {
    return {
      success: false,
      error: "missing_reason",
      message:
        "reason is required — cite evidence (e.g. \"shipped elsewhere in PR #X\" or \"superseded by FB-Y\").",
    };
  }

  const { abandonOwnStalledBuild } = await import("@/lib/build/self-abandon-eligibility");
  const result = await abandonOwnStalledBuild({ buildId, callerId: userId, reason });

  if (result.kind === "not_found") {
    return { success: false, error: "build_not_found", message: `Build ${buildId} not found.` };
  }
  if (result.kind === "ineligible") {
    return { success: false, error: `self_abandon_${result.reason}`, message: result.detail };
  }
  return {
    success: true,
    entityId: result.buildId,
    message: `Abandoned ${result.buildId} — freed its Build Studio WIP slot.`,
    data: { buildId: result.buildId, reason },
  };
}

async function updateLifecycleHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const prod = await prisma.digitalProduct.findUnique({ where: { productId: String(params["productId"]) } });
  if (!prod) return { success: false, error: "Product not found", message: `Product ${String(params["productId"])} not found` };
  const updates: Record<string, unknown> = {};
  if (typeof params["lifecycleStage"] === "string") updates["lifecycleStage"] = params["lifecycleStage"];
  if (typeof params["lifecycleStatus"] === "string") updates["lifecycleStatus"] = params["lifecycleStatus"];
  await prisma.digitalProduct.update({ where: { productId: String(params["productId"]) }, data: updates });
  return { success: true, entityId: String(params["productId"]), message: `Updated lifecycle for ${String(params["productId"])}` };
}

async function verifyLiveInstallReadinessHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const featureSha = String(params["featureSha"] ?? "").trim();
  if (!featureSha)
    return {
      success: false,
      error: "missing_feature_sha",
      message: "featureSha is required (a PR/BI merge SHA or a build's commit).",
    };
  const { resolveLiveInstallReadiness } = await import("@/lib/verify/preflight-service");
  const verdict = await resolveLiveInstallReadiness({ featureSha });
  return {
    success: true,
    message: `${verdict.verdict}: ${verdict.reason}`,
    data: verdict,
  };
}

async function runToolScriptHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { agentId?: string; threadId?: string; routeContext?: string },
): Promise<ToolResult> {
  // Programmatic tool calling: governed read-only code execution.
  // Standalone case — the handler mints a scoped read-only JWT and runs the
  // model's script in the sandbox; each inner callTool reenters
  // /api/mcp/v1 → governedExecuteTool (kernel gate + grants per call). Gated
  // by the tool_script_exec grant (default-deny) AND the
  // programmatic_tool_calling flag (default-off).
  const { runToolScript } = await import("@/lib/tak/tool-script");
  return runToolScript(params, {
    userId,
    agentId: context?.agentId,
    threadId: context?.threadId,
    routeContext: context?.routeContext,
  });
}

async function proposeFileChangeHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { threadId?: string },
): Promise<ToolResult> {
  const { readProjectFile, writeProjectFile, generateSimpleDiff } = await import("@/lib/integrate/codebase-tools");
  const path = String(params.path ?? "");
  const newContent = String(params.newContent ?? "");
  const description = String(params.description ?? "");

  const current = await readProjectFile(path);
  const currentContent = "content" in current ? current.content : "";
  const diff = generateSimpleDiff(currentContent, newContent, path);

  const writeResult = await writeProjectFile(path, newContent);
  if ("error" in writeResult) return { success: false, error: writeResult.error, message: writeResult.error };

  // Auto-commit the approved change
  let commitHash: string | undefined;
  try {
    const { commitFile, formatCommitMessage, isGitAvailable } = await import("@/lib/git-utils");
    if (await isGitAvailable()) {
      // Resolve buildId from thread context (best-effort)
      let buildId: string | undefined;
      if (context?.threadId) {
        const build = await prisma.featureBuild.findFirst({
          where: { threadId: context.threadId, phase: { in: ["build", "review"] } },
          select: { buildId: true, id: true },
        });
        if (build) buildId = build.buildId;
      }

      const message = formatCommitMessage({ description, filePath: path, ...(buildId ? { buildId } : {}), approvedBy: userId });
      const result = await commitFile({ filePath: path, message });

      if ("hash" in result) {
        commitHash = result.hash;

        // Update AgentActionProposal with commit hash (best-effort)
        if (context?.threadId) {
          await prisma.agentActionProposal.updateMany({
            where: { threadId: context.threadId, actionType: "propose_file_change", status: "approved", gitCommitHash: null },
            data: { gitCommitHash: commitHash },
          }).catch(() => {});
        }

        // Append commit hash to FeatureBuild (best-effort)
        if (buildId) {
          await prisma.featureBuild.update({
            where: { buildId },
            data: { gitCommitHashes: { push: commitHash } },
          }).catch(() => {});
        }
      } else {
        console.warn("[propose_file_change] git commit failed: %s", JSON.stringify(result.error));
      }
    }
  } catch (err) {
    console.warn("[propose_file_change] auto-commit error:", err);
  }

  return {
    success: true,
    entityId: path,
    message: commitHash ? `Applied and committed: ${path}` : `Applied change to ${path}`,
    data: { path, diff, description, ...(commitHash ? { commitHash } : {}) },
  };
}

function cleanEndpointTestString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferEndpointIdFromRouteContext(routeContext?: string): string | null {
  return inferProviderIdFromRouteContext(routeContext);
}

function buildEndpointTestRunRequest(
  params: Record<string, unknown>,
  context?: { routeContext?: string },
): EndpointTestRunRequest {
  const explicitEndpointId = cleanEndpointTestString(params["endpointId"]);
  const inferredEndpointId = inferEndpointIdFromRouteContext(context?.routeContext) ?? undefined;
  const endpointId = explicitEndpointId ?? inferredEndpointId;
  const modelId = cleanEndpointTestString(params["modelId"]);
  const taskType = cleanEndpointTestString(params["taskType"]);
  const allEndpoints = endpointId ? false : params["allEndpoints"] === true;

  const base: EndpointTestRunRequest = {
    probesOnly: params["probesOnly"] === false ? false : true,
    allEndpoints,
    allModels: params["allModels"] === true,
    ...(endpointId ? { endpointId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(taskType ? { taskType } : {}),
  };

  if (!endpointId && !allEndpoints) {
    return {
      ...base,
      error: "run_endpoint_tests requires endpointId or allEndpoints=true when it is not used from a provider detail route.",
    };
  }

  return base;
}

async function resolveRepresentativeEndpointModelId(endpointId: string): Promise<string | undefined> {
  const orderBy = [
    { toolFidelity: "desc" as const },
    { reasoning: "desc" as const },
    { conversational: "desc" as const },
    { modelId: "asc" as const },
  ];

  const toolCapable = await prisma.modelProfile.findFirst({
    where: { providerId: endpointId, modelStatus: "active", supportsToolUse: true },
    orderBy,
    select: { modelId: true },
  });
  if (toolCapable?.modelId) return toolCapable.modelId;

  const active = await prisma.modelProfile.findFirst({
    where: { providerId: endpointId, modelStatus: "active" },
    orderBy,
    select: { modelId: true },
  });
  return active?.modelId;
}

async function runEndpointTestsHandler(
  params: Record<string, unknown>,
  userId: string,
  context?: { routeContext?: string },
): Promise<ToolResult> {
  const { runEndpointTests } = await import("@/lib/endpoint-test-runner");
  const request = buildEndpointTestRunRequest(params, context);

  if (request.error) {
    return { success: false, message: request.error };
  }

  const modelId = request.modelId ?? (
    request.endpointId && !request.allModels
      ? await resolveRepresentativeEndpointModelId(request.endpointId)
      : undefined
  );

  const results = await runEndpointTests({
    ...(request.endpointId ? { endpointId: request.endpointId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(request.taskType ? { taskType: request.taskType } : {}),
    probesOnly: request.probesOnly,
    triggeredBy: userId,
  });

  const summary = results.map((r) => {
    const probesPassed = r.probes.filter((p) => p.pass).length;
    const probesFailed = r.probes.filter((p) => !p.pass).length;
    const scenariosPassed = r.scenarios.filter((s) => s.passed).length;
    const scenariosFailed = r.scenarios.filter((s) => !s.passed).length;
    const lines = [
      `**${r.endpointId}**: Probes ${probesPassed}/${probesPassed + probesFailed} passed`,
    ];
    if (r.scenarios.length > 0) {
      lines.push(`Scenarios ${scenariosPassed}/${scenariosPassed + scenariosFailed} passed`);
    }
    lines.push(`Instruction following: ${r.instructionFollowing ?? "unknown"}`);
    if (r.codingCapability) lines.push(`Coding: ${r.codingCapability}`);
    // List failures
    for (const p of r.probes.filter((p) => !p.pass)) {
      lines.push(`  FAIL probe: ${p.name} — ${p.reason}`);
    }
    for (const s of r.scenarios.filter((s) => !s.passed)) {
      lines.push(`  FAIL scenario: ${s.name}`);
    }
    return lines.join("\n");
  }).join("\n\n");

  return { success: true, message: summary || "No endpoints to test.", data: { results, scope: { ...request, ...(modelId ? { modelId } : {}) } } };
}

async function generateCodeHandler(): Promise<ToolResult> {
  // Removed: this tool caused runaway loops by spawning nested LLM calls.
  // Use write_sandbox_file / edit_sandbox_file / run_sandbox_command directly.
  return { success: false, error: "Tool removed.", message: "generate_code and iterate_sandbox have been removed. Use write_sandbox_file, edit_sandbox_file, and run_sandbox_command directly to build the feature." };
}

const handlers: Record<string, ToolPackHandler> = {
  promote_to_build_studio: (params, userId) => promoteToBuildStudioHandler(params, userId),
  abandon_stalled_build: (params, userId) => abandonStalledBuildHandler(params, userId),
  update_lifecycle: (params) => updateLifecycleHandler(params),
  verify_live_install_readiness: (params) => verifyLiveInstallReadinessHandler(params),
  run_tool_script: (params, userId, context) => runToolScriptHandler(params, userId, context),
  propose_file_change: (params, userId, context) => proposeFileChangeHandler(params, userId, context),
  run_endpoint_tests: (params, userId, context) => runEndpointTestsHandler(params, userId, context),
  generate_code: () => generateCodeHandler(),
};

export const buildOpsPack: ToolPack = {
  packId: "build-ops",
  definitions,
  handlers,
  grants: {
    promote_to_build_studio: ["build_lifecycle"],
    abandon_stalled_build: ["build_lifecycle"],
    update_lifecycle: ["backlog_write"],
    verify_live_install_readiness: ["release_plan_read"],
    run_tool_script: ["tool_script_exec"],
    propose_file_change: ["file_read"],
    run_endpoint_tests: ["agent_control_read"],
    generate_code: ["sandbox_execute"],
  },
};
