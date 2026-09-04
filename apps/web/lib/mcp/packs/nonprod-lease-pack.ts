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
import type { HostResourceLeaseEvidence } from "@/lib/nonprod/environment-lease-pool-policy";
import { HEAVY_RESOURCE_CLASSES, isHeavyResourceClass } from "@/lib/nonprod/host-resource-policy";
import { getErrorMessage } from "@/lib/shared/get-error-message";
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

function positiveNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function nonnegativeNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function toolSafeLease(lease: Record<string, unknown>): Record<string, unknown> {
  const { ownerProcessIdentity: _sensitiveProcessIdentity, ...visibleLease } = lease;
  return {
    ...visibleLease,
    expectedMemoryBytes: typeof lease.expectedMemoryBytes === "bigint"
      ? Number(lease.expectedMemoryBytes)
      : lease.expectedMemoryBytes,
  };
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
    description:
      "List admitted and queued nonproduction environment leases so agents can reuse governed shared localhost environments instead of starting unmanaged servers. " +
      "Call once before claim/release decisions; do not poll this tool in a tight loop. " +
      "Cache the result for the current decision step; re-list only after a claim/release/renew you initiated.",
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
    // Kept deliberately short: /platform/audit/authority renders every tool
    // description, and that route's word budget only ratchets down. The full
    // usage guidance lives in the dpf-local-merge-ci-before-push skill.
    description:
      "Resolve which agent client and thread produced a change, from this install's governed gate records. Match by commit SHA, else branch. Read-only.",
    inputSchema: {
      type: "object",
      properties: {
        shas: {
          type: "array",
          items: { type: "string" },
          description: "Commit SHAs to match.",
        },
        branchName: { type: "string", description: "Fallback when no SHA matches." },
        limit: { type: "number", description: "Max matches (default 20)." },
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
    description:
      "Request admission to a governed shared nonproduction environment for preview, UX verification, or local integration. " +
      "Reusing claimKey returns the same durable queue entry (idempotent wait). " +
      "Do not claim in a tight loop without a stable claimKey. " +
      "When queued, terminate the polling runner and resume from the returned TaskRun — do not renew or open a second claim.",
    inputSchema: {
      type: "object",
      properties: {
        environmentKey: { type: "string", enum: ["active-candidate", "local-integration-ci", "host-heavy-resource"] },
        ownerProvider: {
          type: "string",
          enum: ["build-studio", "claude", "codex", "grok", "antigravity", "coworker"],
        },
        ownerSessionId: { type: "string" },
        claimKey: { type: "string", description: "Stable idempotency key reused while waiting for admission." },
        gateIdentity: {
          type: "object",
          description: "Immutable local-CI identity components. The server derives the claim key and ignores caller claimKey.",
          properties: {
            repository: { type: "string" },
            integrationTreeSha: { type: "string" },
            evidencePlanDigest: { type: "string" },
            toolchainFingerprint: { type: "string" },
            gateKind: { type: "string", enum: ["local-integration-ci"] },
          },
          required: [
            "repository",
            "integrationTreeSha",
            "evidencePlanDigest",
            "toolchainFingerprint",
            "gateKind",
          ],
        },
        purpose: { type: "string" },
        url: { type: "string" },
        ports: { type: "array", items: { type: "number" } },
        expiresAt: { type: "string", description: "ISO timestamp when the lease expires" },
        waitDeadlineAt: {
          type: "string",
          description: "Optional ISO deadline for a server-owned durable wait. Defaults to expiresAt. Queued clients should stop polling and resume from the returned TaskRun.",
        },
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
        resourceClass: { type: "string", enum: [...HEAVY_RESOURCE_CLASSES] },
        expectedMemoryBytes: { type: "number" },
        ownerProcessId: { type: "number" },
        ownerProcessIdentity: { type: "string" },
        hostResource: {
          type: "object",
          description: "Host memory and resident-inference evidence for host-heavy-resource admission.",
          properties: {
            totalMemoryBytes: { type: "number" },
            availableMemoryBytes: { type: "number" },
            inferenceResident: { type: "boolean" },
            ungovernedProcesses: { type: "array", items: { type: "object" } },
          },
          required: ["totalMemoryBytes", "availableMemoryBytes", "inferenceResident"],
        },
      },
      required: ["environmentKey", "ownerProvider", "ownerSessionId", "purpose", "expiresAt"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "release_nonprod_environment_lease",
    description:
      "Release a governed shared nonproduction environment lease after verification is complete or blocked. " +
      "Requires the exact leaseId returned by claim_nonprod_environment_lease (not environmentKey alone). " +
      "Idempotent on already-released/cancelled leases — do not thrash release after success. " +
      "On nonprod_lease_not_found: do NOT retry — list_nonprod_environment_leases and use a live leaseId (retryable: false).",
    inputSchema: {
      type: "object",
      properties: {
        leaseId: {
          type: "string",
          description: "Lease id from claim_nonprod_environment_lease (e.g. NPEL-…), not the environmentKey.",
        },
        ownerSessionId: {
          type: "string",
          description: "Owning session identity; required by immutable gate leases.",
        },
      },
      required: ["leaseId"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    // changes identity or authority → consult-gated (TAK §8.4.1).
    consequence: "authority",
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "renew_nonprod_environment_lease",
    description:
      "Heartbeat an active shared nonproduction environment lease, optionally binding its assigned slot before host mutation. " +
      "Only the owning session can renew, and a lapsed lease is not revivable. " +
      "Renew on a human-scale cadence (on gate stages / ~minutes), not every few seconds. " +
      "On owner mismatch or not_found: stop retrying; re-claim with claimKey if work continues.",
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
    data: {
      leases: leases.map((lease) => toolSafeLease(lease as Record<string, unknown>)),
      queued: queued.map((lease) => toolSafeLease(lease as Record<string, unknown>)),
    },
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

async function claimNonprodEnvironmentLeaseHandler(
  params: Record<string, unknown>,
  userId: string,
): Promise<ToolResult> {
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
    ["expiresAt", expiresAtText],
  ].filter(([, value]) => !value).map(([key]) => key);
  const hostResourceClaim = environmentKey === "host-heavy-resource";
  if (!hostResourceClaim && !url) missing.push("url");
  if (!hostResourceClaim && ports.length === 0) missing.push("ports");
  if (missing.length > 0) {
    return {
      success: false,
      error: "missing_required",
      message: `Missing required nonproduction lease field(s): ${missing.join(", ")}`,
    };
  }
  if (!["active-candidate", "local-integration-ci", "host-heavy-resource"].includes(environmentKey)) {
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
  const waitDeadlineText = stringValue("waitDeadlineAt") || expiresAtText;
  const waitDeadlineAt = new Date(waitDeadlineText);
  if (Number.isNaN(waitDeadlineAt.getTime())) {
    return {
      success: false,
      error: "invalid_wait_deadline",
      message: "waitDeadlineAt must be a future ISO timestamp when supplied",
    };
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

  const resourceClass = stringValue("resourceClass");
  const expectedMemoryBytes = positiveNumber(params["expectedMemoryBytes"]);
  const ownerProcessId = positiveNumber(params["ownerProcessId"]);
  const ownerProcessIdentity = stringValue("ownerProcessIdentity");
  const hostResourceValue = objectValue(params["hostResource"]);
  let hostResource: HostResourceLeaseEvidence | undefined;
  if (hostResourceClaim) {
    const totalMemoryBytes = positiveNumber(hostResourceValue?.totalMemoryBytes);
    const availableMemoryBytes = nonnegativeNumber(hostResourceValue?.availableMemoryBytes);
    const inferenceResident = hostResourceValue?.inferenceResident;
    if (
      !isHeavyResourceClass(resourceClass)
      || !expectedMemoryBytes
      || !ownerProcessId
      || !ownerProcessIdentity
      || !totalMemoryBytes
      || availableMemoryBytes === undefined
      || typeof inferenceResident !== "boolean"
    ) {
      return {
        success: false,
        error: "invalid_host_resource_contract",
        message: "host-heavy-resource requires a declared resource class, positive memory/PID values, process identity, and measurable host evidence.",
      };
    }
    hostResource = {
      totalMemoryBytes,
      availableMemoryBytes,
      inferenceResident,
      ungovernedProcesses: Array.isArray(hostResourceValue?.ungovernedProcesses)
        ? hostResourceValue.ungovernedProcesses as HostResourceLeaseEvidence["ungovernedProcesses"]
        : undefined,
    };
  } else if (
    params["resourceClass"] !== undefined
    || params["hostResource"] !== undefined
    || params["ownerProcessIdentity"] !== undefined
  ) {
    return {
      success: false,
      error: "invalid_host_resource_contract",
      message: "Host resource fields are valid only for host-heavy-resource claims.",
    };
  }

  const gateIdentityValue = objectValue(params["gateIdentity"]);
  let gateKey: string | undefined;
  if (params["gateIdentity"] !== undefined) {
    if (!gateIdentityValue || environmentKey !== "local-integration-ci") {
      return {
        success: false,
        error: "invalid_gate_identity",
        message: "gateIdentity is valid only for local-integration-ci claims.",
      };
    }
    try {
      const { deriveGateKey } = await import("@/lib/gates/gate-run-identity");
      gateKey = deriveGateKey({
        repository: String(gateIdentityValue.repository ?? ""),
        integrationTreeSha: String(gateIdentityValue.integrationTreeSha ?? ""),
        evidencePlanDigest: String(gateIdentityValue.evidencePlanDigest ?? ""),
        toolchainFingerprint: String(gateIdentityValue.toolchainFingerprint ?? ""),
        gateKind: gateIdentityValue.gateKind as "local-integration-ci",
      });
    } catch (error) {
      return {
        success: false,
        error: "invalid_gate_identity",
        message: getErrorMessage(error),
      };
    }
  }

  const result = await claimNonprodEnvironmentLease({
    environmentKey: environmentKey as "active-candidate" | "local-integration-ci" | "host-heavy-resource",
    ownerProvider: ownerProvider as (typeof NONPROD_OWNER_PROVIDERS)[number],
    ownerSessionId,
    claimKey: gateKey ? `gate:${gateKey}` : stringValue("claimKey") || undefined,
    purpose,
    url: url || "host://localhost",
    ports,
    expiresAt,
    worktreePath: stringValue("worktreePath") || undefined,
    branchName: stringValue("branchName") || undefined,
    buildId: stringValue("buildId") || undefined,
    taskRunId: stringValue("taskRunId") || undefined,
    cleanupCommand: stringValue("cleanupCommand") || undefined,
    slotManifestVersion: slotManifestVersion as 1 | undefined,
    hostPressure: hostPressure as LocalCiHostPressure | undefined,
    resourceClass: isHeavyResourceClass(resourceClass) ? resourceClass : undefined,
    expectedMemoryBytes,
    ownerProcessId,
    ownerProcessIdentity: ownerProcessIdentity || undefined,
    hostResource,
  });
  const toolLease = toolSafeLease(result.lease as unknown as Record<string, unknown>);
  if (result.status === "reused") {
    return {
      success: true,
      entityId: result.evidenceRecordId,
      message: `Reused terminal local-CI evidence ${result.evidenceRecordId}.`,
      data: {
        lease: toolLease,
        admission: {
          status: "reused",
          evidenceRecordId: result.evidenceRecordId,
          resultClass: result.resultClass,
        },
        poolPolicy: result.poolPolicy,
        gateKey,
      },
    };
  }
  if (result.status === "blocked") {
    return {
      success: false,
      entityId: result.lease.leaseId,
      error: "gate_evidence_blocked",
      message: `Canonical local-CI evidence cannot be reused (${result.reason}).`,
      data: {
        lease: toolLease,
        admission: { status: "blocked", reason: result.reason },
        poolPolicy: result.poolPolicy,
        gateKey,
      },
    };
  }
  if (result.status === "terminal") {
    if (result.lease.taskRunId) {
      const { settleNonprodLeaseWait } = await import("@/lib/nonprod/durable-wait");
      await settleNonprodLeaseWait({
        db: (await import("@dpf/db")).prisma,
        taskRunId: result.lease.taskRunId,
        leaseId: result.lease.leaseId,
        state: "terminal",
      });
    }
    return {
      success: false,
      entityId: result.lease.leaseId,
      error: "lease_terminal",
      message: `Nonproduction lease request is already ${result.reason}; create a new claimKey to request admission again.`,
      data: { lease: toolLease, reason: result.reason, poolPolicy: result.poolPolicy, gateKey },
    };
  }
  if (result.status === "subscribed") {
    return {
      success: true,
      entityId: result.lease.leaseId,
      message: `Subscribed to canonical nonproduction environment lease ${result.lease.leaseId}.`,
      data: {
        lease: toolLease,
        admission: {
          status: "subscribed",
          executionStatus: result.executionStatus,
        },
        poolPolicy: result.poolPolicy,
        gateKey,
      },
    };
  }
  if (result.status === "queued") {
    const { checkpointNonprodLeaseWait } = await import("@/lib/nonprod/durable-wait");
    const durableWait = await checkpointNonprodLeaseWait({
      db: (await import("@dpf/db")).prisma,
      userId,
      lease: result.lease,
      queuePosition: result.queuePosition,
      waitDeadlineAt,
    });
    return {
      success: true,
      entityId: result.lease.leaseId,
      message: `Queued nonproduction environment lease ${result.lease.leaseId} at position ${result.queuePosition}.`,
      data: {
        lease: toolLease,
        admission: {
          status: "queued",
          queuePosition: result.queuePosition,
          waitAgeMs: result.waitAgeMs,
          resumeMode: "durable-task",
          taskRunId: durableWait.taskRunId,
        },
        poolPolicy: result.poolPolicy,
        gateKey,
      },
    };
  }
  if (result.lease.taskRunId) {
    const { settleNonprodLeaseWait } = await import("@/lib/nonprod/durable-wait");
    await settleNonprodLeaseWait({
      db: (await import("@dpf/db")).prisma,
      taskRunId: result.lease.taskRunId,
      leaseId: result.lease.leaseId,
      state: "admitted",
    });
  }
  return {
    success: true,
    entityId: result.lease.leaseId,
    message: `Admitted nonproduction environment lease ${result.lease.leaseId} to ${result.slotKey}.`,
    data: {
      lease: toolLease,
      admission: {
        status: "admitted",
        slotKey: result.slotKey,
        waitAgeMs: result.waitAgeMs,
      },
      poolPolicy: result.poolPolicy,
      gateKey,
    },
  };
}

async function releaseNonprodEnvironmentLeaseHandler(params: Record<string, unknown>): Promise<ToolResult> {
  const { releaseNonprodEnvironmentLease } = await import("@/lib/nonprod/environment-lease");
  const leaseId = typeof params["leaseId"] === "string" ? params["leaseId"].trim() : "";
  const ownerSessionId = typeof params["ownerSessionId"] === "string"
    ? params["ownerSessionId"].trim()
    : "";
  if (!leaseId) {
    return {
      success: false,
      error: "missing_required",
      // BI-MCP-EFF-85398F73: stop blind retries without a real leaseId.
      message:
        "leaseId is required (the id returned by claim_nonprod_environment_lease). " +
        "Do NOT pass environmentKey alone. Do NOT retry without a leaseId (retryable: false).",
      data: { retryable: false },
    };
  }
  try {
    const lease = await releaseNonprodEnvironmentLease({
      leaseId,
      ...(ownerSessionId ? { ownerSessionId } : {}),
    });
    return {
      success: true,
      entityId: lease.leaseId,
      message: lease.status === "cancelled"
        ? `Cancelled queued nonproduction environment lease ${lease.leaseId}.`
        : `Released nonproduction environment lease ${lease.leaseId}.`,
      data: { lease: toolSafeLease(lease as unknown as Record<string, unknown>) },
    };
  } catch (error) {
    const detail = getErrorMessage(error);
    if (detail === "nonprod_lease_not_found") {
      return {
        success: false,
        error: "not_found",
        message:
          `No nonprod lease ${leaseId}. Call list_nonprod_environment_leases for live ids; ` +
          "do NOT retry the same leaseId (retryable: false).",
        data: { retryable: false, leaseId },
      };
    }
    return {
      success: false,
      error: "release_failed",
      message: `Could not release lease ${leaseId}: ${detail}. Do not blind-retry (retryable: false).`,
      data: { retryable: false, leaseId },
    };
  }
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
    data: {
      lease: toolSafeLease(result.lease as unknown as Record<string, unknown>),
      poolPolicy: result.poolPolicy,
    },
  };
}

const handlers: Record<string, ToolPackHandler> = {
  list_nonprod_environment_leases: () => listNonprodEnvironmentLeases(),
  lookup_change_origin: (params) => lookupChangeOriginHandler(params),
  claim_nonprod_environment_lease: (params, userId) => claimNonprodEnvironmentLeaseHandler(params, userId),
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
