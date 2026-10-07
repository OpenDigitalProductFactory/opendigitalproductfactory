// Effective authorization policy for dynamically discovered external MCP tools
// (BI-8B7B2FE9; spec 2026-08-30 §11; decision DI-F6D4C0132024, hybrid explicit
// policy). ONE resolver, used at listing (getAvailableTools), at governed
// execution (mcp-governed-execute) and immediately before the remote call
// (executeMcpServerTool), so a stale model-visible list can never authorize.
//
// Pure and DB-free: callers load the McpServerTool row and pass it in.
//
// Fail closed. A discovered tool is usable only when:
//   - its row is `approved` (never inferred from isEnabled, health, text or
//     remote annotations), its server is active and the row is enabled; and
//   - its policy is complete and current. For the release's bundled tools the
//     grant comes from TOOL_TO_GRANTS and the effect from BUNDLED_MCP_TOOL_EFFECTS
//     (code-owned). For every other tool the persisted grant key must be in the
//     closed grant vocabulary, effect and modes must be set, the policy version
//     current, the approved identity equal the namespaced name (rename denies),
//     and the sanitized description + inputSchema must hash to the approved
//     content digest (a changed tool is a different tool: the MCP "rug pull").
//
// Remote annotations (readOnlyHint, destructiveHint, ...) are stored as
// untrusted discovery hints and are never read here.

import { createHash } from "node:crypto";
import type { McpToolEffect, McpToolExecutionMode, McpToolPolicyStatus } from "@dpf/db";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { sanitizeUntrustedValue } from "@dpf/validators";
import { TOOL_TO_GRANTS, grantsSatisfyRequirement, knownGrantKeys } from "./agent-grants";

/** Bump when the meaning of a persisted approval changes; older approvals then deny. */
export const MCP_TOOL_POLICY_VERSION = 1;

export const MCP_TOOL_POLICY_STATUSES = ["quarantined", "approved", "denied"] as const satisfies readonly McpToolPolicyStatus[];
export const MCP_TOOL_EFFECTS = ["read_only", "side_effecting"] as const satisfies readonly McpToolEffect[];
export const MCP_TOOL_EXECUTION_MODES = ["advise", "act"] as const satisfies readonly McpToolExecutionMode[];

const NAMESPACE_SEP = "__";

export function namespacedMcpToolName(serverSlug: string, toolName: string): string {
  return `${serverSlug}${NAMESPACE_SEP}${toolName}`;
}

/**
 * Effect posture of the release's bundled discovered tools, keyed by the
 * namespaced name. Grants for these names live in TOOL_TO_GRANTS (single
 * source); this table only adds what TOOL_TO_GRANTS cannot say. A bundled tool
 * needs an entry in BOTH to resolve.
 */
export const BUNDLED_MCP_TOOL_EFFECTS: Readonly<Record<string, McpToolEffect>> = {
  "mcp-browser-use__browse_open": "read_only",
  "mcp-browser-use__browse_extract": "read_only",
  "mcp-browser-use__browse_screenshot": "read_only",
  "mcp-browser-use__browse_close": "read_only",
  "mcp-browser-use__browse_run_tests": "read_only",
  "mcp-browser-use__browse_act": "side_effecting",
};

export function isBundledMcpTool(namespacedName: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUNDLED_MCP_TOOL_EFFECTS, namespacedName)
    && Array.isArray(TOOL_TO_GRANTS[namespacedName]);
}

export type DiscoveredToolPolicyRow = {
  toolName: string;
  description: string | null;
  inputSchema: unknown;
  isEnabled: boolean;
  policyStatus: string;
  policyEffect: string | null;
  policyExecutionModes: readonly string[];
  policyGrantKey: string | null;
  policyVersion: number | null;
  approvedToolIdentity: string | null;
  approvedContentDigest: string | null;
  approvedDescription: string | null;
  approvedInputSchema: unknown;
  server: { serverId: string; status: string };
};

export type DiscoveredToolDenyReason =
  | "tool-disabled"
  | "server-inactive"
  | "quarantined"
  | "denied"
  | "unknown-status"
  | "incomplete-policy"
  | "unknown-grant"
  | "policy-version-stale"
  | "identity-mismatch"
  | "content-changed";

export type DiscoveredToolAccessDenyReason =
  | "external-access-disabled"
  | "mode-not-permitted"
  | "agent-grant-missing"
  | "room-grant-missing";

export type ResolvedDiscoveredToolPolicy = {
  namespacedName: string;
  source: "bundled" | "approved";
  grants: readonly string[];
  effect: McpToolEffect;
  modes: readonly McpToolExecutionMode[];
  /** Sanitized, model-visible text: the approved snapshot (or bundled current text). */
  description: string;
  inputSchema: Record<string, unknown>;
  contentDigest: string;
};

export type DiscoveredToolPolicyResult =
  | { resolved: true; policy: ResolvedDiscoveredToolPolicy }
  | { resolved: false; namespacedName: string; reason: DiscoveredToolDenyReason };

/** Operator-facing explanation for each refusal. Connectivity is never authority. */
export const DISCOVERED_TOOL_REASON_TEXT: Readonly<Record<DiscoveredToolDenyReason | DiscoveredToolAccessDenyReason, string>> = {
  "tool-disabled": "The tool is turned off.",
  "server-inactive": "The service is not active.",
  quarantined: "Waiting for review. A discovered tool is not available to coworkers until someone approves it.",
  denied: "Deliberately blocked.",
  "unknown-status": "The tool has an unrecognized review state, so it is blocked.",
  "incomplete-policy": "The approval is missing its grant, effect or modes, so it is blocked.",
  "unknown-grant": "The approval names a grant the platform does not know, so it is blocked.",
  "policy-version-stale": "The approval predates the current policy rules and must be reviewed again.",
  "identity-mismatch": "The service or tool was renamed since approval and must be reviewed again.",
  "content-changed": "The service changed this tool's description or inputs since approval and must be reviewed again.",
  "external-access-disabled": "External access is off for this conversation.",
  "mode-not-permitted": "This tool is not approved for the coworker's current mode.",
  "agent-grant-missing": "The coworker does not hold the grant this tool requires.",
  "room-grant-missing": "The workroom does not authorize the grant this tool requires.",
};

/** Hidden-Unicode-sanitized model-visible text (packages/validators untrusted-text). */
export function sanitizeModelVisibleToolText(
  description: string | null | undefined,
  inputSchema: unknown,
): { description: string; inputSchema: Record<string, unknown> } {
  const schema = inputSchema && typeof inputSchema === "object" && !Array.isArray(inputSchema)
    ? inputSchema as Record<string, unknown>
    : {};
  return {
    description: sanitizeUntrustedValue(description ?? "").value,
    inputSchema: sanitizeUntrustedValue(schema).value,
  };
}

/**
 * sha256 over the canonical JSON of the sanitized description + inputSchema —
 * exactly the text a model would read. Key order does not change the digest;
 * any visible change, and any hidden-character payload change that survives
 * sanitizing, does.
 */
export function computeMcpToolContentDigest(description: string | null | undefined, inputSchema: unknown): string {
  const text = sanitizeModelVisibleToolText(description, inputSchema);
  return `sha256:${createHash("sha256").update(canonicalJson(text)).digest("hex")}`;
}

function deny(namespacedName: string, reason: DiscoveredToolDenyReason): DiscoveredToolPolicyResult {
  return { resolved: false, namespacedName, reason };
}

/** Resolve the DPF-owned policy of one discovered tool row. Never consults remote hints. */
export function resolveDiscoveredToolPolicy(row: DiscoveredToolPolicyRow): DiscoveredToolPolicyResult {
  const namespacedName = namespacedMcpToolName(row.server.serverId, row.toolName);
  if (!(MCP_TOOL_POLICY_STATUSES as readonly string[]).includes(row.policyStatus)) {
    return deny(namespacedName, "unknown-status");
  }
  if (row.policyStatus === "denied") return deny(namespacedName, "denied");
  if (row.policyStatus === "quarantined") return deny(namespacedName, "quarantined");
  if (!row.isEnabled) return deny(namespacedName, "tool-disabled");
  if (row.server.status !== "active") return deny(namespacedName, "server-inactive");

  if (isBundledMcpTool(namespacedName)) {
    const effect = BUNDLED_MCP_TOOL_EFFECTS[namespacedName]!;
    const text = sanitizeModelVisibleToolText(row.description, row.inputSchema);
    return {
      resolved: true,
      policy: {
        namespacedName,
        source: "bundled",
        grants: [...TOOL_TO_GRANTS[namespacedName]!],
        effect,
        modes: effect === "read_only" ? ["advise", "act"] : ["act"],
        description: text.description,
        inputSchema: text.inputSchema,
        contentDigest: computeMcpToolContentDigest(row.description, row.inputSchema),
      },
    };
  }

  const effect = row.policyEffect;
  const modes = row.policyExecutionModes;
  if (
    !effect
    || !(MCP_TOOL_EFFECTS as readonly string[]).includes(effect)
    || modes.length === 0
    || !modes.every((mode) => (MCP_TOOL_EXECUTION_MODES as readonly string[]).includes(mode))
    || (effect === "side_effecting" && modes.includes("advise"))
    || !row.policyGrantKey
    || !row.approvedContentDigest
    || row.approvedInputSchema === null
    || row.approvedInputSchema === undefined
  ) {
    return deny(namespacedName, "incomplete-policy");
  }
  if (!knownGrantKeys().includes(row.policyGrantKey)) return deny(namespacedName, "unknown-grant");
  if (row.policyVersion !== MCP_TOOL_POLICY_VERSION) return deny(namespacedName, "policy-version-stale");
  if (row.approvedToolIdentity !== namespacedName) return deny(namespacedName, "identity-mismatch");

  const currentDigest = computeMcpToolContentDigest(row.description, row.inputSchema);
  const snapshotDigest = computeMcpToolContentDigest(row.approvedDescription, row.approvedInputSchema);
  if (currentDigest !== row.approvedContentDigest || snapshotDigest !== row.approvedContentDigest) {
    return deny(namespacedName, "content-changed");
  }

  const text = sanitizeModelVisibleToolText(row.approvedDescription, row.approvedInputSchema);
  return {
    resolved: true,
    policy: {
      namespacedName,
      source: "approved",
      grants: [row.policyGrantKey],
      effect: effect as McpToolEffect,
      modes: [...modes] as McpToolExecutionMode[],
      description: text.description,
      inputSchema: text.inputSchema,
      contentDigest: row.approvedContentDigest,
    },
  };
}

export type DiscoveredToolAccessContext = {
  /** The acting coworker's grants (own + any baseline). Null/empty = no grants: deny. */
  agentGrants: readonly string[] | null | undefined;
  /** The Workroom's authorized surface, when the turn runs in a narrowing room. */
  roomAuthorizedGrants?: readonly string[] | null;
  /** Coworker mode. Execution without a mode signal is treated as `act`. */
  mode?: McpToolExecutionMode;
  /** Server-resolved External Access for the turn. */
  externalAccessEnabled: boolean;
};

/** Intersect a resolved policy with the acting context (agent grant × room × mode × external access). */
export function evaluateDiscoveredToolAccess(
  policy: ResolvedDiscoveredToolPolicy,
  ctx: DiscoveredToolAccessContext,
): { allowed: true } | { allowed: false; reason: DiscoveredToolAccessDenyReason } {
  if (ctx.externalAccessEnabled !== true) return { allowed: false, reason: "external-access-disabled" };
  const mode = ctx.mode ?? "act";
  if (!policy.modes.includes(mode) || (mode === "advise" && policy.effect !== "read_only")) {
    return { allowed: false, reason: "mode-not-permitted" };
  }
  if (!grantsSatisfyRequirement(policy.grants, ctx.agentGrants ?? [])) {
    return { allowed: false, reason: "agent-grant-missing" };
  }
  if (ctx.roomAuthorizedGrants && !grantsSatisfyRequirement(policy.grants, ctx.roomAuthorizedGrants)) {
    return { allowed: false, reason: "room-grant-missing" };
  }
  return { allowed: true };
}

/**
 * Inventory class for one discovered tool row: what an operator sees. Never
 * reports authority by omission.
 */
export type DiscoveredToolInventoryClass = "bundled-approved" | "approved" | "denied" | "quarantined" | "blocked";

export function classifyDiscoveredToolForInventory(row: DiscoveredToolPolicyRow): {
  policyClass: DiscoveredToolInventoryClass;
  reason: DiscoveredToolDenyReason | null;
} {
  const resolved = resolveDiscoveredToolPolicy(row);
  if (resolved.resolved) {
    return { policyClass: resolved.policy.source === "bundled" ? "bundled-approved" : "approved", reason: null };
  }
  if (resolved.reason === "denied") return { policyClass: "denied", reason: "denied" };
  if (resolved.reason === "quarantined" || resolved.reason === "content-changed" || resolved.reason === "identity-mismatch" || resolved.reason === "policy-version-stale") {
    return { policyClass: "quarantined", reason: resolved.reason };
  }
  return { policyClass: "blocked", reason: resolved.reason };
}
