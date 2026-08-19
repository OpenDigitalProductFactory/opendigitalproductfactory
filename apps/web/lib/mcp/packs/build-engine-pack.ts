// Build-engine tool pack — scoped ToolPack extraction.
//
// Drains the build-dispatch engine domain out of the mcp-tools.ts executeTool
// switch: provisioning a build engine (claude/codex/grok/opencode) into the
// running sandbox, reconciling engines that went missing after a sandbox
// rebuild, and reporting per-engine readiness. Each handler lazy-imports its
// single backing service and reproduces the former switch case verbatim, so
// behaviour is identical when the tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source. The
// provision handler shares one local param-coercion helper (optionalString)
// with the rest of the switch; it is replicated here so the pack is
// self-contained (the original stays inline for its other consumers).

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

/** Coerce an optional string param, trimming and nulling empties. */
function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const definitions: ToolDefinition[] = [
  {
    name: "reconcile_build_engines",
    description: "Re-provision build engines that were provisioned on demand and are now missing from the sandbox (e.g. after a sandbox rebuild). Idempotent and narrow: only restores engines with desired=present AND a prior successful provision that a fresh probe reports absent — a no-op for fresh or baked-only sandboxes. Side-effecting (may run installs). Also fires automatically when start_sandbox brings a recreated sandbox to ready. Returns { checked, restored[], skipped }.",
    inputSchema: {
      type: "object",
      properties: {
        offline: {
          type: "boolean",
          description: "When true, only use no-egress (prestaged-binary) recipes. Default false.",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "provision_build_engine",
    description: "Install a build-dispatch engine (claude, codex, grok, opencode) into the running sandbox from its registry recipe, then verify by re-probing. Idempotent — a no-op if the engine is already present. Side-effecting: runs the install command (e.g. `npm install -g`, the grok curl-installer, or the opencode prestaged-binary/tarball) inside the sandbox, so it requires sandbox_execute. Pass offline:true to use only no-egress (prestaged-binary) recipes for air-gapped installs. Returns { kind, version, recipe }.",
    inputSchema: {
      type: "object",
      properties: {
        engineId: { type: "string", description: "Engine to provision: 'claude' | 'codex' | 'grok' | 'opencode'." },
        offline: {
          type: "boolean",
          description: "When true, only run no-egress (prestaged-binary) recipes (air-gapped install). Default false.",
        },
      },
      required: ["engineId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  {
    name: "get_build_engine_readiness",
    description: "Report whether each build-dispatch engine (claude, codex, grok, opencode) is present and healthy in the build sandbox. Returns per-engine { present, version, lastProbedAt, bakeInDefault } from the last probe (BuildEngineState). Pass refresh:true to live re-probe each engine (docker exec <verifyCommand>) and persist the fresh result. Use this to see engine readiness before selecting a build dispatch engine — e.g. an engine that is selectable but shows present:false would fail at runtime with 'not found'.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "When true, live re-probe each engine in the sandbox and persist the result before returning. Default false (return last known state).",
        },
      },
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
];

async function reconcileBuildEnginesHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const offline = params["offline"] === true;
  const { reconcileBuildEngines } = await import("@/lib/build/build-engine-reconcile");
  const summary = await reconcileBuildEngines({ offline, actorUserId: userId });
  return {
    success: true,
    message:
      summary.restored.length === 0
        ? `No engines needed restoring (checked ${summary.checked}, skipped ${summary.skipped}).`
        : `Restored ${summary.restored.length} engine(s): ${summary.restored
            .map((r) => `${r.engineId} (${r.outcome})`)
            .join(", ")}.`,
    data: summary,
  };
}

async function provisionBuildEngineHandler(params: Record<string, unknown>, userId: string): Promise<ToolResult> {
  const engineId = optionalString(params["engineId"]);
  if (!engineId) {
    return {
      success: false,
      error: "engineId is required.",
      message: "Provide engineId — one of 'claude', 'codex', 'grok'.",
    };
  }
  const offline = params["offline"] === true;
  const { provisionBuildEngine } = await import("@/lib/build/build-engine-provision");
  const outcome = await provisionBuildEngine(engineId, { offline, actorUserId: userId });
  const ok = outcome.kind === "provisioned" || outcome.kind === "already-present";
  const message =
    outcome.kind === "provisioned"
      ? `Provisioned ${engineId}${outcome.version ? ` v${outcome.version}` : ""} via ${outcome.recipe}; verified present in the sandbox.`
      : outcome.kind === "already-present"
        ? `${engineId} is already installed in the sandbox${outcome.version ? ` (v${outcome.version})` : ""}.`
        : outcome.kind === "no-recipe"
          ? `Cannot provision ${engineId}: ${outcome.reason}.`
          : outcome.kind === "verify-failed"
            ? `Ran the ${outcome.recipe} recipe for ${engineId} but it is still not present: ${outcome.error}`
            : `Failed to provision ${engineId}: ${outcome.error}`;
  return { success: ok, message, data: outcome };
}

async function getBuildEngineReadinessHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const refresh = params["refresh"] === true;
  // Shared with the /platform/ai/build-studio config page's proactive probe
  // + "Probe all engines" action: one implementation of
  // load-vs-live-probe. Live rows carry the per-engine failure reason.
  const { loadBuildEngineReadiness, probeBuildEngineReadiness } = await import(
    "@/lib/build/build-engine-readiness"
  );
  const readiness = refresh
    ? await probeBuildEngineReadiness()
    : await loadBuildEngineReadiness();

  const present = readiness.filter((r) => r.present === true).map((r) => r.engineId);
  const absent = readiness.filter((r) => r.present === false).map((r) => r.engineId);
  const unknown = readiness.filter((r) => r.present === null).map((r) => r.engineId);

  return {
    success: true,
    message:
      readiness.length === 0
        ? "No build engines registered yet. Run sync-engine-registry to populate the BuildEngine catalog from build-engines.json."
        : `Build engines — present: ${present.join(", ") || "none"}; not installed: ${absent.join(", ") || "none"}; never probed: ${unknown.join(", ") || "none"}.${refresh ? " (live re-probe)" : " (last known state — pass refresh:true to re-probe)"}`,
    data: { engines: readiness, refreshed: refresh },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  reconcile_build_engines: (params, userId) => reconcileBuildEnginesHandler(params, userId),
  provision_build_engine: (params, userId) => provisionBuildEngineHandler(params, userId),
  get_build_engine_readiness: (params) => getBuildEngineReadinessHandler(params),
};

export const buildEnginePack: ToolPack = {
  packId: "build-engine",
  definitions,
  handlers,
  grants: {
    reconcile_build_engines: ["sandbox_execute"],
    provision_build_engine: ["sandbox_execute"],
    get_build_engine_readiness: ["work_capsule_read"],
  },
};
