import { NONPROD_ENVIRONMENT_KEYS } from "@/lib/nonprod/environment-lease-lock";
import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { HEAVY_RESOURCE_CLASSES } from "@/lib/nonprod/host-resource-policy";

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

export const nonprodLeaseDefinitions: ToolDefinition[] = [
  {
    name: "list_nonprod_environment_leases",
    description:
      "List admitted and queued nonproduction environment leases so agents can reuse governed shared localhost environments instead of starting unmanaged servers. " +
      "Call once before claim/release decisions; do not poll this tool in a tight loop. " +
      "Cache the result for the current decision step. Pass leaseId to read one exact persisted reservation, including terminal state; this does not release it or prove process cleanup.",
    inputSchema: {
      type: "object",
      properties: { leaseId: { type: "string", description: "Optional exact lease ID for persisted reservation readback, including terminal rows." } },
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
      "Do not poll this tool. When queued, stop and resume from the returned TaskRun — do not renew or open a second claim. " +
      "lease_terminal means this claimKey is finished (released, cancelled, or expired): do not retry it (retryable: false). A new admission needs a new claimKey, and only when the work is still wanted.",
    inputSchema: {
      type: "object",
      properties: {
        environmentKey: { type: "string", enum: [...NONPROD_ENVIRONMENT_KEYS] },
        ownerProvider: {
          type: "string",
          enum: ["build-studio", "claude", "codex", "grok", "antigravity", "coworker"],
        },
        ownerSessionId: { type: "string" },
        claimKey: { type: "string", description: "Stable idempotency key reused while waiting for admission." },
        resumeLeaseId: { type: "string", description: "The lease a resumed local-CI gate waits on. A cancelled one stays cancelled; this owner's obsolete queued wait is superseded." },
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
        expiresAt: { type: "string", description: "Absolute request expiry for legacy callers; compatibility fallback when requestedTtlMs is explicit. Never rebased after approval." },
        requestedTtlMs: { type: "integer", minimum: 1, maximum: 1_200_000,
          description: "Explicit bounded lease duration starting at admission. Requires an independent future waitDeadlineAt. Does not change old approved arguments." },
        waitDeadlineAt: {
          type: "string",
          description: "Optional ISO deadline for a server-owned durable wait. Defaults to expiresAt. Queued clients should stop polling and resume from the returned TaskRun.",
        },
        worktreePath: { type: "string" },
        gateClientRevision: {
          type: "number",
          description:
            "Revision of the local-CI gate client making this claim. A client below the server's floor is refused " +
            "with gate_client_upgrade_required: rebase the branch onto main and re-run; do not retry the same client.",
        },
        branchName: { type: "string" },
        buildId: { type: "string" },
        taskRunId: { type: "string" },
        cleanupCommand: { type: "string" },
        slotManifestVersion: {
          type: "number",
          enum: [1],
          description: "Versioned local-CI slot capability. Omit for legacy singleton-only admission.",
        },
        productionBuild: { type: "string", enum: ["local", "delegated"], description: "\"delegated\": the merge queue's required build owns the production build, so admission reserves no builder memory (BI-3A14308C). Omit for \"local\"." },
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
        qualificationAdmissionToken: {
          type: "string",
          description: "Opaque server-issued verify-phase qualification binding used only by the canonical host runner.",
        },
        qualificationPlatform: { type: "string", enum: ["linux", "win32"] },
        qualificationCommand: { type: "string" },
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
    consequenceForCall: async (call) =>
      (await import("@/lib/nonprod/lease-cleanup-consequence")).leaseCleanupConsequenceForCall(call),
    buildPhases: ["ideate", "plan", "build", "review", "ship"],
  },
  {
    name: "renew_nonprod_environment_lease",
    description:
      "Heartbeat an active shared nonproduction environment lease, optionally binding its assigned slot before host mutation. " +
      "Only the owning session can renew, and a lapsed lease is not revivable. " +
      "Renew on a human-scale cadence (on gate stages / ~minutes), not every few seconds. " +
      "On owner mismatch, not_found or lease_terminal: stop; never automatically re-claim or scan replacement keys. A new explicitly wanted admission needs a new claimKey; queued claims resume through their durable TaskRun.",
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

