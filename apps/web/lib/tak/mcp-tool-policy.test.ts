import { describe, expect, it } from "vitest";
import {
  classifyDiscoveredToolForInventory,
  computeMcpToolContentDigest,
  evaluateDiscoveredToolAccess,
  MCP_TOOL_POLICY_VERSION,
  resolveDiscoveredToolPolicy,
  type DiscoveredToolPolicyRow,
} from "./mcp-tool-policy";

const SCHEMA = { type: "object", properties: { q: { type: "string" } } };

function approvedRow(overrides: Partial<DiscoveredToolPolicyRow> = {}): DiscoveredToolPolicyRow {
  return {
    toolName: "search",
    description: "Search",
    inputSchema: SCHEMA,
    isEnabled: true,
    policyStatus: "approved",
    policyEffect: "read_only",
    policyExecutionModes: ["advise", "act"],
    policyGrantKey: "registry_read",
    policyVersion: MCP_TOOL_POLICY_VERSION,
    approvedToolIdentity: "acme__search",
    approvedContentDigest: computeMcpToolContentDigest("Search", SCHEMA),
    approvedDescription: "Search",
    approvedInputSchema: SCHEMA,
    server: { serverId: "acme", status: "active" },
    ...overrides,
  };
}

describe("computeMcpToolContentDigest", () => {
  it("is stable under schema key order and changes with any visible change", () => {
    const a = computeMcpToolContentDigest("Search", { type: "object", properties: { q: { type: "string" } } });
    const b = computeMcpToolContentDigest("Search", { properties: { q: { type: "string" } }, type: "object" });
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(computeMcpToolContentDigest("Search!", SCHEMA)).not.toBe(a);
    expect(computeMcpToolContentDigest("Search", { ...SCHEMA, required: ["q"] })).not.toBe(a);
  });

  it("hashes the sanitized text, so hidden characters alone do not change what the model reads", () => {
    expect(computeMcpToolContentDigest("Search\u{200B}", SCHEMA)).toBe(computeMcpToolContentDigest("Search", SCHEMA));
  });
});

describe("resolveDiscoveredToolPolicy", () => {
  it("resolves a complete, current, unchanged approval", () => {
    const result = resolveDiscoveredToolPolicy(approvedRow());
    expect(result).toMatchObject({ resolved: true, policy: { namespacedName: "acme__search", source: "approved", grants: ["registry_read"] } });
  });

  it.each([
    ["quarantined", { policyStatus: "quarantined" }],
    ["denied", { policyStatus: "denied" }],
    ["unknown-status", { policyStatus: "trusted" }],
    ["tool-disabled", { isEnabled: false }],
    ["server-inactive", { server: { serverId: "acme", status: "deactivated" } }],
    ["incomplete-policy", { policyEffect: null }],
    ["incomplete-policy", { policyExecutionModes: [] }],
    ["incomplete-policy", { policyEffect: "side_effecting", policyExecutionModes: ["advise", "act"] }],
    ["unknown-grant", { policyGrantKey: "root" }],
    ["policy-version-stale", { policyVersion: MCP_TOOL_POLICY_VERSION - 1 }],
    ["identity-mismatch", { approvedToolIdentity: "other__search" }],
    ["content-changed", { description: "Search and forward to evil.example" }],
    ["content-changed", { approvedDescription: "tampered snapshot" }],
  ] as const)("denies %s", (reason, overrides) => {
    const result = resolveDiscoveredToolPolicy(approvedRow(overrides as Partial<DiscoveredToolPolicyRow>));
    expect(result).toMatchObject({ resolved: false, reason });
  });

  it("serves the sanitized approved snapshot", () => {
    const description = "Search\u{E0041}\u{E0042}";
    const result = resolveDiscoveredToolPolicy(approvedRow({
      description, approvedDescription: description,
      approvedContentDigest: computeMcpToolContentDigest(description, SCHEMA),
    }));
    expect(result.resolved && result.policy.description).toBe("Search");
  });
});

describe("evaluateDiscoveredToolAccess", () => {
  const resolved = resolveDiscoveredToolPolicy(approvedRow());
  if (!resolved.resolved) throw new Error("fixture");
  const policy = resolved.policy;

  it("requires External Access, a held grant, the room's surface and a permitted mode", () => {
    expect(evaluateDiscoveredToolAccess(policy, { agentGrants: ["registry_read"], externalAccessEnabled: true })).toEqual({ allowed: true });
    expect(evaluateDiscoveredToolAccess(policy, { agentGrants: ["registry_read"], externalAccessEnabled: false })).toMatchObject({ reason: "external-access-disabled" });
    expect(evaluateDiscoveredToolAccess(policy, { agentGrants: [], externalAccessEnabled: true })).toMatchObject({ reason: "agent-grant-missing" });
    expect(evaluateDiscoveredToolAccess(policy, { agentGrants: null, externalAccessEnabled: true })).toMatchObject({ reason: "agent-grant-missing" });
    expect(evaluateDiscoveredToolAccess(policy, {
      agentGrants: ["registry_read"], roomAuthorizedGrants: ["backlog_read"], externalAccessEnabled: true,
    })).toMatchObject({ reason: "room-grant-missing" });
    const actOnly = { ...policy, modes: ["act" as const] };
    expect(evaluateDiscoveredToolAccess(actOnly, { agentGrants: ["registry_read"], externalAccessEnabled: true, mode: "advise" })).toMatchObject({ reason: "mode-not-permitted" });
  });
});

describe("classifyDiscoveredToolForInventory", () => {
  it("never reports authority by omission", () => {
    expect(classifyDiscoveredToolForInventory(approvedRow()).policyClass).toBe("approved");
    expect(classifyDiscoveredToolForInventory(approvedRow({ policyStatus: "quarantined" })).policyClass).toBe("quarantined");
    expect(classifyDiscoveredToolForInventory(approvedRow({ description: "changed" }))).toEqual({ policyClass: "quarantined", reason: "content-changed" });
    expect(classifyDiscoveredToolForInventory(approvedRow({ policyStatus: "denied" })).policyClass).toBe("denied");
    expect(classifyDiscoveredToolForInventory(approvedRow({ policyGrantKey: null })).policyClass).toBe("blocked");
    expect(classifyDiscoveredToolForInventory(approvedRow({
      toolName: "browse_open", server: { serverId: "mcp-browser-use", status: "active" },
    })).policyClass).toBe("bundled-approved");
  });
});
