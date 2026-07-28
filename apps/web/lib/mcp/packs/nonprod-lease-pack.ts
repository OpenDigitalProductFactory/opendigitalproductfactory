// Shared nonproduction environment lease tool pack — BI-ARCH-TOOLPACKS.
//
// Drains the self-contained "nonproduction environment lease" domain out of the
// mcp-tools.ts executeTool switch: the four tools agents use to coordinate the
// governed shared localhost environments instead of spinning up unmanaged
// servers (list admitted/queued leases, request admission, release/cancel,
// heartbeat/renew a held lease). Each handler lazy-imports the lease service and
// reproduces the former switch case verbatim, so behaviour is identical when the
// tool is invoked over MCP.
//
// Definitions moved verbatim out of the inline PLATFORM_TOOLS array; grants
// mirror agent-grants.ts TOOL_TO_GRANTS, which stays the gating source.

import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

// Per-key trimmed string coercer — a copy of the inline helper the former switch
// cases used, so the pack owns its inputs without depending on mcp-tools.ts
// internals.
function stringValueFor(params: Record<string, unknown>) {
  return (key: string) => (typeof params[key] === "string" ? String(params[key]).trim() : "");
}

const definitions: ToolDefinition[] = [
  {
    name: "list_nonprod_environment_leases",
    description: "List admitted and queued nonproduction environment leases so agents can reuse governed shared localhost environments instead of starting unmanaged servers.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: false,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: "claim_nonprod_environment_lease",
    description: "Request admission to a governed shared nonproduction environment for preview, UX verification, or local integration. Reusing claimKey returns the same durable queue entry.",
    inputSchema: {
      type: "object",
      properties: {
        environmentKey: { type: "string", enum: ["active-candidate", "local-integration-ci"] },
        ownerProvider: {
          type: "string",
          enum: ["build-studio", "claude", "codex", "grok", "antigravity", "coworker"],
        },
        ownerSessionId: { type: "string" },
        claimKey: { type: "string", description: "Stable idempotency key reused while waiting for admission." },
        purpose: { type: "string" },
        url: { type: "string" },
        ports: { type: "array", items: { type: "number" } },
        expiresAt: { type: "string", description: "ISO timestamp when the lease expires" },
        worktreePath: { type: "string" },
        branchName: { type: "string" },
        buildId: { type: "string" },
        taskRunId: { type: "string" },
        cleanupCommand: { type: "string" },
      },
      required: ["environmentKey", "ownerProvider", "ownerSessionId", "purpose", "url", "ports", "expiresAt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "release_nonprod_environment_lease",
    description: "Release a governed shared nonproduction environment lease after verification is complete or blocked.",
    inputSchema: {
      type: "object",
      properties: {
        leaseId: { type: "string" },
      },
      required: ["leaseId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "renew_nonprod_environment_lease",
    description: "Heartbeat an active shared nonproduction environment lease to extend its hold window so a still-active session keeps it. Only the owning session can renew, and a lapsed lease is NOT revivable (re-claim instead). The window is capped — long-running work should run on an isolated runtime, not hold the single shared lease.",
    inputSchema: {
      type: "object",
      properties: {
        leaseId: { type: "string" },
        ownerSessionId: { type: "string" },
        ttlMinutes: { type: "number", description: "Optional renewal window in minutes; clamped to the max hold window." },
      },
      required: ["leaseId", "ownerSessionId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
];

async function listNonprodEnvironmentLeases(): Promise<ToolResult> {
  const {
    listActiveNonprodEnvironmentLeases,
    listQueuedNonprodEnvironmentLeases,
  } = await import("@/lib/nonprod/environment-lease");
  const [leases, queued] = await Promise.all([
    listActiveNonprodEnvironmentLeases({}),
    listQueuedNonprodEnvironmentLeases({}),
  ]);
  return {
    success: true,
    message: `Found ${leases.length} admitted and ${queued.length} queued nonproduction environment lease(s).`,
    data: { leases, queued },
  };
}

async function claimNonprodEnvironmentLeaseHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { claimNonprodEnvironmentLease } = await import("@/lib/nonprod/environment-lease");
  const stringValue = stringValueFor(params);
  const environmentKey = stringValue("environmentKey");
  const ownerProvider = stringValue("ownerProvider");
  const ownerSessionId = stringValue("ownerSessionId");
  const purpose = stringValue("purpose");
  const url = stringValue("url");
  const expiresAtText = stringValue("expiresAt");
  const ports = Array.isArray(params["ports"])
    ? (params["ports"] as unknown[])
      .map((value) => typeof value === "number" ? value : Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const missing = [
    ["environmentKey", environmentKey],
    ["ownerProvider", ownerProvider],
    ["ownerSessionId", ownerSessionId],
    ["purpose", purpose],
    ["url", url],
    ["expiresAt", expiresAtText],
  ].filter(([, value]) => !value).map(([key]) => key);
  if (ports.length === 0) missing.push("ports");
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing_required",
      message: `Missing required nonproduction lease field(s): ${missing.join(", ")}`,
    };
  }
  if (!["active-candidate", "local-integration-ci"].includes(environmentKey)) {
    return { success: false, error: "invalid_environment_key", message: `Unsupported environmentKey: ${environmentKey}` };
  }
  const { NONPROD_OWNER_PROVIDERS } = await import("@/lib/nonprod/environment-lease");
  if (!(NONPROD_OWNER_PROVIDERS as readonly string[]).includes(ownerProvider)) {
    return { success: false, error: "invalid_owner_provider", message: `Unsupported ownerProvider: ${ownerProvider}` };
  }
  const expiresAt = new Date(expiresAtText);
  if (Number.isNaN(expiresAt.getTime())) {
    return { success: false, error: "invalid_expires_at", message: "expiresAt must be a valid ISO timestamp" };
  }

  const result = await claimNonprodEnvironmentLease({
    environmentKey: environmentKey as "active-candidate" | "local-integration-ci",
    ownerProvider: ownerProvider as (typeof NONPROD_OWNER_PROVIDERS)[number],
    ownerSessionId,
    claimKey: stringValue("claimKey") || undefined,
    purpose,
    url,
    ports,
    expiresAt,
    worktreePath: stringValue("worktreePath") || undefined,
    branchName: stringValue("branchName") || undefined,
    buildId: stringValue("buildId") || undefined,
    taskRunId: stringValue("taskRunId") || undefined,
    cleanupCommand: stringValue("cleanupCommand") || undefined,
  });
  if (result.status === "terminal") {
    return {
      success: false,
      entityId: result.lease.leaseId,
      error: "lease_terminal",
      message: `Nonproduction lease request is already ${result.reason}; create a new claimKey to request admission again.`,
      data: { lease: result.lease, reason: result.reason },
    };
  }
  if (result.status === "queued") {
    return {
      success: true,
      entityId: result.lease.leaseId,
      message: `Queued nonproduction environment lease ${result.lease.leaseId} at position ${result.queuePosition}.`,
      data: {
        lease: result.lease,
        admission: {
          status: "queued",
          queuePosition: result.queuePosition,
          waitAgeMs: result.waitAgeMs,
        },
      },
    };
  }
  return {
    success: true,
    entityId: result.lease.leaseId,
    message: `Admitted nonproduction environment lease ${result.lease.leaseId} to ${result.slotKey}.`,
    data: {
      lease: result.lease,
      admission: {
        status: "admitted",
        slotKey: result.slotKey,
        waitAgeMs: result.waitAgeMs,
      },
    },
  };
}

async function releaseNonprodEnvironmentLeaseHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { releaseNonprodEnvironmentLease } = await import("@/lib/nonprod/environment-lease");
  const leaseId = typeof params["leaseId"] === "string" ? params["leaseId"].trim() : "";
  if (!leaseId) {
    return {
      success: false,
      error: "missing_required",
      message: "leaseId is required",
    };
  }
  const lease = await releaseNonprodEnvironmentLease({ leaseId });
  return {
    success: true,
    entityId: lease.leaseId,
    message: lease.status === "cancelled"
      ? `Cancelled queued nonproduction environment lease ${lease.leaseId}.`
      : `Released nonproduction environment lease ${lease.leaseId}.`,
    data: { lease },
  };
}

async function renewNonprodEnvironmentLeaseHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { renewNonprodEnvironmentLease } = await import("@/lib/nonprod/environment-lease");
  const leaseId = typeof params["leaseId"] === "string" ? params["leaseId"].trim() : "";
  const ownerSessionId = typeof params["ownerSessionId"] === "string" ? params["ownerSessionId"].trim() : "";
  if (!leaseId || !ownerSessionId) {
    return {
      success: false,
      error: "missing_required",
      message: "leaseId and ownerSessionId are required",
    };
  }
  const ttlMinutes =
    typeof params["ttlMinutes"] === "number" && params["ttlMinutes"] > 0
      ? params["ttlMinutes"]
      : undefined;
  const result = await renewNonprodEnvironmentLease({
    leaseId,
    ownerSessionId,
    ttlMs: ttlMinutes ? ttlMinutes * 60_000 : undefined,
  });
  if (result.status === "lost") {
    return {
      success: false,
      error: "lease_lost",
      message: `Lease cannot be renewed (${result.reason}); re-claim if you still need the environment.`,
      data: { reason: result.reason },
    };
  }
  return {
    success: true,
    entityId: result.lease.leaseId,
    message: `Renewed nonproduction environment lease ${result.lease.leaseId}.`,
    data: { lease: result.lease },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_nonprod_environment_leases: () => listNonprodEnvironmentLeases(),
  claim_nonprod_environment_lease: (params) => claimNonprodEnvironmentLeaseHandler(params),
  release_nonprod_environment_lease: (params) => releaseNonprodEnvironmentLeaseHandler(params),
  renew_nonprod_environment_lease: (params) => renewNonprodEnvironmentLeaseHandler(params),
};

export const nonprodLeasePack: ToolPack = {
  packId: "nonprod-lease",
  definitions,
  handlers,
  grants: {
    list_nonprod_environment_leases: ["work_capsule_read"],
    claim_nonprod_environment_lease: ["work_capsule_write"],
    release_nonprod_environment_lease: ["work_capsule_write"],
    renew_nonprod_environment_lease: ["work_capsule_write"],
  },
};
