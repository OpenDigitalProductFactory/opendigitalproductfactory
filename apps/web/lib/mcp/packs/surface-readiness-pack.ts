// Surface-readiness pack — BI-D6DFC0E7 (EP-COMPETENCE-FLYWHEEL, host-agent scope).
//
// Makes agent-surface readiness fleet-OBSERVABLE. The bootstrap already computes
// each surface's readiness locally; nothing reported it, so no one could know
// which surfaces × instances are wired to durable memory. This pack is the
// report + read door:
//   • record_surface_readiness — a build surface heartbeats its own computed state
//   • get_fleet_readiness       — read the rolled-up fleet view (for the digest / an operator)
//
// Ungated: reporting your OWN toolchain readiness (like propose_improvement /
// report_quality_issue) cannot exceed the caller's authority or affect anyone
// else; the read returns readiness telemetry only (no secrets). Inputs are
// validated against the closed vocabularies.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack } from "../tool-pack";
import {
  SURFACE_READINESS_STATES,
  SURFACE_CLIENT_KINDS,
  isSurfaceReadinessState,
  isSurfaceClientKind,
  DEFAULT_SURFACE_STALE_AFTER_MS,
} from "@/lib/agent-toolchain/fleet-readiness";

const definitions: ToolDefinition[] = [
  {
    name: "record_surface_readiness",
    description:
      "Report THIS build surface's toolchain readiness so the fleet can be observed centrally. Call after the bootstrap computes your readiness state (e.g. at session start or after a client update). Heartbeats upsert on surfaceKey — one row per surface. Lets the daily digest raise a surface that is not wired to durable memory or has gone silent.",
    inputSchema: {
      type: "object",
      properties: {
        surfaceKey: {
          type: "string",
          description: "Stable identity of this surface + machine, e.g. \"claude-code@<machineId>\". Reusing it updates this surface's heartbeat.",
        },
        clientKind: {
          type: "string",
          enum: [...SURFACE_CLIENT_KINDS],
          description: "Which client this surface is (claude-code | codex | grok | antigravity | build-studio).",
        },
        readinessState: {
          type: "string",
          enum: [...SURFACE_READINESS_STATES],
          description: "The computed readiness state (ready | partial | missing_cli | missing_token | needs_refresh | portal-unavailable | mcp-unavailable | failed_smoke).",
        },
        dpfPlatformVersion: {
          type: "string",
          description: "The platform version this surface converged to (for drift detection after a client update).",
        },
        mcpOk: { type: "boolean", description: "Whether the DPF MCP reachability probe passed." },
        mcpReason: { type: "string", description: "The probe failure reason when mcpOk is false (e.g. no_token, endpoint_unreachable)." },
      },
      required: ["surfaceKey", "clientKind", "readinessState", "mcpOk"],
    },
    requiredCapability: null,
    sideEffect: true,
  },
  {
    name: "get_fleet_readiness",
    description:
      "Read the rolled-up readiness of every build surface known to this instance: which are ready, not-ready, or stale (heartbeat gone silent). Feeds the daily digest and answers 'is every AI surface wired to durable memory right now?'.",
    inputSchema: {
      type: "object",
      properties: {
        staleAfterDays: {
          type: "number",
          description: "A surface silent longer than this is 'stale' (unknown). Default 7.",
        },
        expectedPlatformVersion: {
          type: "string",
          description: "Optional: flag surfaces behind this platform version (updated/reset but not re-converged).",
        },
      },
      required: [],
    },
    requiredCapability: null,
    sideEffect: false,
  },
];

async function recordSurfaceReadinessHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const surfaceKey = typeof params.surfaceKey === "string" ? params.surfaceKey.trim() : "";
  const clientKind = params.clientKind;
  const readinessState = params.readinessState;
  const mcpOk = params.mcpOk;

  if (!surfaceKey) {
    return { success: false, error: "invalid_surface_key", message: "surfaceKey is required." };
  }
  if (!isSurfaceClientKind(clientKind)) {
    return { success: false, error: "invalid_client_kind", message: `clientKind must be one of ${SURFACE_CLIENT_KINDS.join(", ")}.` };
  }
  if (!isSurfaceReadinessState(readinessState)) {
    return { success: false, error: "invalid_readiness_state", message: `readinessState must be one of ${SURFACE_READINESS_STATES.join(", ")}.` };
  }
  if (typeof mcpOk !== "boolean") {
    return { success: false, error: "invalid_mcp_ok", message: "mcpOk (boolean) is required." };
  }

  const { prisma } = await import("@dpf/db");
  const { recordSurfaceReadiness } = await import("@/lib/agent-toolchain/fleet-readiness");
  await recordSurfaceReadiness(prisma as never, {
    surfaceKey,
    clientKind,
    readinessState,
    dpfPlatformVersion: typeof params.dpfPlatformVersion === "string" ? params.dpfPlatformVersion : null,
    mcpOk,
    mcpReason: typeof params.mcpReason === "string" ? params.mcpReason : null,
  });

  return {
    success: true,
    message:
      readinessState === "ready"
        ? `Recorded: ${surfaceKey} is ready.`
        : `Recorded: ${surfaceKey} is not ready (${readinessState}) — it will surface in the fleet digest.`,
    data: { surfaceKey, readinessState },
  };
}

async function getFleetReadinessHandler(
  params: Record<string, unknown>,
): Promise<ToolResult> {
  const staleDays = typeof params.staleAfterDays === "number" && params.staleAfterDays > 0 ? params.staleAfterDays : null;
  const staleAfterMs = staleDays ? staleDays * 24 * 60 * 60 * 1000 : DEFAULT_SURFACE_STALE_AFTER_MS;
  const expectedPlatformVersion = typeof params.expectedPlatformVersion === "string" ? params.expectedPlatformVersion : null;

  const { prisma } = await import("@dpf/db");
  const { getFleetReadiness } = await import("@/lib/agent-toolchain/fleet-readiness");
  const summary = await getFleetReadiness(prisma as never, {
    now: new Date(),
    staleAfterMs,
    expectedPlatformVersion,
  });

  const msg = summary.counts.total === 0
    ? "No build surfaces have reported readiness yet."
    : summary.allReady
      ? `All ${summary.counts.total} surface(s) are ready.`
      : `${summary.counts.notReady} not-ready, ${summary.counts.stale} stale of ${summary.counts.total} surface(s).`;

  return { success: true, message: msg, data: summary as unknown as Record<string, unknown> };
}

export const surfaceReadinessPack: ToolPack = {
  packId: "surface-readiness",
  definitions,
  handlers: {
    record_surface_readiness: (params) => recordSurfaceReadinessHandler(params),
    get_fleet_readiness: (params) => getFleetReadinessHandler(params),
  },
  // Ungated: self-report of the caller's own toolchain state + read-only telemetry.
  grants: {},
};
