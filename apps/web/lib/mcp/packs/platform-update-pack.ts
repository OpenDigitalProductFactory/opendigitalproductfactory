// Platform-update pack — preview and apply this install's pending platform update.
//
// Two tools that bracket the same operation: summarize_upgrade_impact renders an
// advisory "what's in this update?" preview (read-only, never queues or applies),
// and apply_platform_update merges the pending platform version into the install's
// customised source, returning a clean merge or the conflicts to resolve. Both are
// thin delegations — the preview to the upgrade-impact service, the apply to the
// shared platform-dev-config server action that also backs the in-portal Apply
// Update button, so both surfaces produce identical merge behavior.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tool-types";
import type { ToolPack } from "../tool-pack";
import { getErrorMessage } from "@/lib/shared/get-error-message";
import type { RuntimeReconciliationIntent } from "@/lib/platform-runtime/transition-protocol";
import { PLATFORM_UPDATE_TOOL_GRANTS } from "@/lib/tak/platform-update-tool-grants";

const definitions: ToolDefinition[] = [
  {
    name: "preview_runtime_capability_reconciliation",
    description: "Read this install's validated host capability snapshot and complete saved capability settings. Reports disagreement without selecting desired settings, reserving authority or changing services. Use the returned baseline to prepare an explicit reconciliation request.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    requiredCapability: "manage_platform", executionMode: "immediate", sideEffect: false,
  },
  {
    name: "reconcile_runtime_capabilities",
    description: "Apply explicitly chosen runtime settings using the original preview's separate host and saved-state baselines. Supply complete desired saved states, desired host keys and the keys whose saved state may change. Untouched settings are preserved. Changed baselines, incompatible packaged code or attributed active work refuse the apply. Retain the transition id for recovery; never create another request to bypass uncertainty.",
    inputSchema: { type: "object", additionalProperties: false, required: ["transitionId", "reconciliation"], properties: {
      transitionId: { type: "string", pattern: "^RCT-[A-Za-z0-9-]+$" },
      reconciliation: { type: "object", additionalProperties: false, required: ["observedHost", "observedDatabaseStates", "desiredHostEnabledKeys", "desiredDatabaseStates", "touchedKeys"], properties: {
        observedHost: { type: "object", description: "The complete validated host snapshot returned by the preview; preserve every field." },
        observedDatabaseStates: { type: "object", additionalProperties: { type: "string" } },
        desiredHostEnabledKeys: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^runtime:[a-z0-9-]+$" } },
        desiredDatabaseStates: { type: "object", additionalProperties: { type: "string" } },
        touchedKeys: { type: "array", uniqueItems: true, items: { type: "string", pattern: "^runtime:[a-z0-9-]+$" } },
      } },
    } },
    // Changing executable host capabilities changes the install's authority.
    requiredCapability: "manage_platform", executionMode: "immediate", sideEffect: true,
    consequence: "authority", consequenceScope: "platform",
  },
  {
    name: "apply_platform_update",
    description: "Merge the new platform version into your customised source. Returns a clean merge or a list of conflicts for the AI coworker to resolve with you.",
    inputSchema: { type: "object", properties: {} },
    requiredCapability: "manage_platform",
    executionMode: "immediate",
    sideEffect: true,
    consequence: "irreversible",
  },
  {
    name: "summarize_upgrade_impact",
    description:
      "On-demand, install-tailored \"What's in this update?\" summary. Compares the upstream lineage marker (latest succeeded SelfUpgradeRun.targetSha) to the resolved upstream HEAD, classifies the change set by Conventional Commit type, scores each commit's relevance to this install (archetype, industry, customization paths, open quality-issue themes), and returns a headline + ordered top-N items (most impactful first) plus the full list and a 'touches your customizations' callout that doubles as a §5.0 merge-conflict early warning. Advisory only — never queues or applies an upgrade. Cacheable per (currentLineageSha, targetSha); set refresh=true to bypass.",
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "Bypass the per-process cache and recompute. Default false.",
        },
        topN: {
          type: "number",
          description: "Cap on items in the headline list (default 8). The full list is always returned alongside.",
        },
        skipPhrasing: {
          type: "boolean",
          description: "Return only the deterministic shape (no LLM phrasing). Default false. Useful when an external client wants to render its own copy.",
        },
      },
      required: [],
    },
    requiredCapability: "view_operations",
    executionMode: "immediate",
    sideEffect: false,
  },
];

async function applyPlatformUpdateTool(): Promise<ToolResult> {
  // Delegates to the shared server action in lib/actions/platform-dev-config.ts.
  // The same code path backs the in-portal Apply Update UI, so both surfaces
  // produce identical merge behavior and identical structured results — single
  // source of truth.
  const { applyPlatformUpdate } = await import("@/lib/actions/platform-dev-config");
  const result = await applyPlatformUpdate();

  switch (result.kind) {
    case "engine-retired":
      // The /workspace merge engine is retired; the install advances only via
      // the Self-Upgrade pipeline (governed-upgrade §5.0).
      return { success: false, message: result.message, error: "Engine retired — use Self-Upgrade" };
    case "no-update-pending":
      return { success: false, message: result.message, error: "No update pending" };
    case "invalid-version":
      return { success: false, message: result.message, error: "Invalid version" };
    case "conflicts":
      return {
        success: true,
        message: result.message,
        data: {
          clean: false,
          resumedMerge: result.resumedMerge,
          conflicts: result.conflicts,
          version: result.version,
        } as unknown as Record<string, unknown>,
      };
    case "clean-merge":
      return {
        success: true,
        message: result.message,
        data: {
          clean: true,
          filesUpdated: result.filesUpdated,
          version: result.version,
        },
      };
    case "error":
      return { success: false, message: result.message, error: result.message };
  }
}

async function summarizeUpgradeImpactTool(params: Record<string, unknown>): Promise<ToolResult> {
  // Read-only, advisory; does not queue or apply anything.
  const refresh = params["refresh"] === true;
  const skipPhrasing = params["skipPhrasing"] === true;
  const topNRaw = params["topN"];
  const topN =
    typeof topNRaw === "number" && Number.isFinite(topNRaw) && topNRaw > 0
      ? Math.floor(topNRaw)
      : undefined;
  try {
    const { summarizeUpgradeImpact } = await import("@/lib/self-upgrade/impact");
    const result = await summarizeUpgradeImpact({ refresh, skipPhrasing, topN });
    if (!result.ok) {
      return {
        success: true,
        message: result.detail,
        data: { ok: false, reason: result.reason, detail: result.detail },
      };
    }
    return {
      success: true,
      message: result.summary.phrased?.headline
        ?? `Upgrade impact summary: ${result.summary.counts.total} commit(s) since the last lineage marker.`,
      data: result.summary as unknown as Record<string, unknown>,
    };
  } catch (err) {
    const msg = getErrorMessage(err);
    return {
      success: false,
      error: msg,
      message: `summarize_upgrade_impact failed: ${msg}`,
    };
  }
}

export const platformUpdatePack: ToolPack = {
  packId: "platform-update",
  definitions,
  handlers: {
    preview_runtime_capability_reconciliation: async () => {
      try {
        const { previewRuntimeCapabilityReconciliation } = await import("@/lib/actions/runtime-capabilities");
        return { success: true, message: "Runtime capability baselines observed; no settings changed.", data: await previewRuntimeCapabilityReconciliation() };
      } catch (error) { return { success: false, message: "Runtime capability preview is unavailable.", error: getErrorMessage(error) }; }
    },
    reconcile_runtime_capabilities: async (params) => {
      try {
        const { requestRuntimeCapabilityTransition } = await import("@/lib/actions/runtime-capabilities");
        const intent = structuredClone(params.reconciliation) as RuntimeReconciliationIntent;
        const result = await requestRuntimeCapabilityTransition({ transitionId: params.transitionId as string, desiredKeys: [...intent.desiredHostEnabledKeys], mode: "reconciliation", reconciliation: intent });
        return { success: result.status === "succeeded", message: result.status === "succeeded" ? "Runtime capability reconciliation completed." : "Runtime capability reconciliation is not complete; retain this request for recovery.", data: result };
      } catch (error) { return { success: false, message: "Runtime capability reconciliation refused or requires recovery.", error: getErrorMessage(error) }; }
    },
    apply_platform_update: applyPlatformUpdateTool,
    summarize_upgrade_impact: summarizeUpgradeImpactTool,
  },
  grants: PLATFORM_UPDATE_TOOL_GRANTS,
};
