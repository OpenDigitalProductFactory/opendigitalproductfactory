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
import type { LocalCiHostPressure } from "@/lib/nonprod/local-ci-pool-policy";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

// Per-key trimmed string coercer — a copy of the inline helper the former switch
// cases used, so the pack owns its inputs without depending on mcp-tools.ts
// internals.
function stringValueFor(params: Record<string, unknown>) {
  return (key: string) => (typeof params[key] === "string" ? String(params[key]).trim() : "");
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positivePorts(value: unknown): number[] {
  return Array.isArray(value)
    ? value
      .map((entry) => typeof entry === "number" ? entry : Number(entry))
      .filter((entry) => Number.isInteger(entry) && entry > 0)
    : [];
}

function normalizedSlotBinding(value: unknown): {
  manifestVersion: 1;
  slotKey: "slot-0" | "slot-1";
  url: string;
  ports: number[];
  cleanupCommand: string;
} | undefined {
  const binding = objectValue(value);
  if (!binding) return undefined;
  const ports = positivePorts(binding.ports);
  if (
    binding.manifestVersion !== 1
    || (binding.slotKey !== "slot-0" && binding.slotKey !== "slot-1")
    || typeof binding.url !== "string"
    || binding.url.trim().length === 0
    || ports.length === 0
    || typeof binding.cleanupCommand !== "string"
    || binding.cleanupCommand.trim().length === 0
  ) {
    return undefined;
  }
  return {
    manifestVersion: 1,
    slotKey: binding.slotKey,
    url: binding.url.trim(),
    ports,
    cleanupCommand: binding.cleanupCommand.trim(),
  };
}

const hostPressureSchema = {
  type: "object",
  properties: {
    observedAt: { type: "string" },
    availableMemoryBytes: { type: "number" },
    sustainedCpuPercent: { type: "number" },
    diskFreeBytes: { type: "number" },
    dockerHealthy: { type: "boolean" },
    convergenceActive: { type: "boolean" },
    fencesHealthy: { type: "boolean" },
    evidenceIsolationHealthy: { type: "boolean" },
  },
  required: [
    "observedAt",
    "availableMemoryBytes",
    "sustainedCpuPercent",
    "diskFreeBytes",
    "dockerHealthy",
    "convergenceActive",
    "fencesHealthy",
    "evidenceIsolationHealthy",
  ],
} as const;

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
    name: "lookup_change_origin",
    description:
      "Resolve which agent client and which client thread produced a change, from the governed pregate records this install already writes. Match by commit SHA (pass every SHA a PR contains — head plus commits) and optionally branch; SHA matches are exact and survive branch deletion, branch matches are a fallback. Read-only. Returns no origin for work this install never gated (e.g. an outside contributor), which is the correct answer rather than a guess.",
    inputSchema: {
      type: "object",
      properties: {
        shas: {
          type: "array",
          items: { type: "string" },
          description: "Commit SHAs (40-hex) to match. Non-SHA values are ignored.",
        },
        branchName: { type: "string", description: "Fallback match when no SHA matches." },
        limit: { type: "number", description: "Max matches to return (default 20, max 100)." },
      },
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
        slotManifestVersion: {
          type: "number",
          enum: [1],
          description: "Versioned local-CI slot capability. Omit for legacy singleton-only admission.",
        },
        hostPressure: {
          ...hostPressureSchema,
          description: "Recent fail-closed host observation used only to decide whether slot-1 may admit.",
        },
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
    description: "Heartbeat an active shared nonproduction environment lease, optionally binding its assigned slot before host mutation. Only the owning session can renew, and a lapsed lease is not revivable.",
    inputSchema: {
      type: "object",
      properties: {
        leaseId: { type: "string" },
        ownerSessionId: { type: "string" },
        ttlMinutes: { type: "number", description: "Optional renewal window in minutes; clamped to the max hold window." },
        slotBinding: {
          type: "object",
          description: "Bind the server-assigned slot manifest before the runner mutates host state.",
          properties: {
            manifestVersion: { type: "number", enum: [1] },
            slotKey: { type: "string", enum: ["slot-0", "slot-1"] },
            url: { type: "string" },
            ports: { type: "array", items: { type: "number" } },
            cleanupCommand: { type: "string" },
          },
          required: ["manifestVersion", "slotKey", "url", "ports", "cleanupCommand"],
        },
        hostPressure: {
          ...hostPressureSchema,
          description: "Optional fresh host observation recorded with the renewal for capacity contraction evidence.",
        },
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

async function lookupChangeOriginHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { lookupChangeOrigin } = await import("@/lib/contributor-change-lanes/origin-lookup");
  const rawShas = params["shas"];
  const shas = Array.isArray(rawShas)
    ? rawShas.filter((s): s is string => typeof s === "string")
    : [];
  const branchName = typeof params["branchName"] === "string" ? params["branchName"] : null;
  const limitRaw = params["limit"];
  const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw) ? limitRaw : undefined;

  if (shas.length === 0 && !branchName) {
    return {
      success: false,
      error: "missing_required",
      message: "Provide at least one commit SHA or a branchName to look up.",
    };
  }

  const result = await lookupChangeOrigin({ shas, branchName, limit });
  const message = result.origin
    ? result.unattributed
      ? `Matched a governed gate record, but its caller was not identifiable (session ${result.origin.sessionId}).`
      : `Origin: ${result.origin.provider ?? "unknown client"} / thread ${result.origin.sessionId} (matched on ${result.origin.matchedOn}).`
    : "No governed gate record on this install matches that change.";
  return { success: true, message, data: result };
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
  const ports = positivePorts(params["ports"]);
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
  const slotManifestVersion = params["slotManifestVersion"];
  if (
    slotManifestVersion !== undefined
    && slotManifestVersion !== 1
  ) {
    return {
      success: false,
      error: "invalid_slot_manifest_version",
      message: "slotManifestVersion must be 1 when supplied",
    };
  }
  const hostPressure = objectValue(params["hostPressure"]);
  if (params["hostPressure"] !== undefined && !hostPressure) {
    return {
      success: false,
      error: "invalid_host_pressure",
      message: "hostPressure must be an object",
    };
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
    slotManifestVersion: slotManifestVersion as 1 | undefined,
    hostPressure: hostPressure as LocalCiHostPressure | undefined,
  });
  if (result.status === "terminal") {
    return {
      success: false,
      entityId: result.lease.leaseId,
      error: "lease_terminal",
      message: `Nonproduction lease request is already ${result.reason}; create a new claimKey to request admission again.`,
      data: { lease: result.lease, reason: result.reason, poolPolicy: result.poolPolicy },
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
        poolPolicy: result.poolPolicy,
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
      poolPolicy: result.poolPolicy,
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
  const slotBinding = normalizedSlotBinding(params["slotBinding"]);
  if (params["slotBinding"] !== undefined && !slotBinding) {
    return {
      success: false,
      error: "invalid_slot_binding",
      message: "slotBinding must be an object",
    };
  }
  const hostPressure = objectValue(params["hostPressure"]);
  if (params["hostPressure"] !== undefined && !hostPressure) {
    return {
      success: false,
      error: "invalid_host_pressure",
      message: "hostPressure must be an object",
    };
  }
  const result = await renewNonprodEnvironmentLease({
    leaseId,
    ownerSessionId,
    ttlMs: ttlMinutes ? ttlMinutes * 60_000 : undefined,
    slotBinding,
    hostPressure: hostPressure as LocalCiHostPressure | undefined,
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
    data: { lease: result.lease, poolPolicy: result.poolPolicy },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_nonprod_environment_leases: () => listNonprodEnvironmentLeases(),
  lookup_change_origin: (params) => lookupChangeOriginHandler(params),
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
    lookup_change_origin: ["work_capsule_read"],
    claim_nonprod_environment_lease: ["work_capsule_write"],
    release_nonprod_environment_lease: ["work_capsule_write"],
    renew_nonprod_environment_lease: ["work_capsule_write"],
  },
};
