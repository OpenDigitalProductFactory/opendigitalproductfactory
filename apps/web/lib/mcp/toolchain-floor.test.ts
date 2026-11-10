// BI-DFC0270C — AC-FLOOR-READONLY, AC-FLOOR-SCOPE.
import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { getToolGrantMapping } from "@/lib/tak/agent-grants";
import type { PublishedToolchain } from "@/lib/agent-toolchain/toolchain-verdict";

import {
  isToolAllowedBelowToolchainFloor,
  TOOLCHAIN_FLOOR_REPAIR_TOOLS,
  toolchainFloorRefusalResult,
} from "./toolchain-floor";

const DIGEST = "ab".repeat(32);
const FLOOR = { minPackVersion: "0.3.0", graceStartsAt: "2026-10-10T00:00:00Z" };
const FLOORED: PublishedToolchain = { packVersion: "0.3.1", packDigest: DIGEST, floor: FLOOR };
const NO_FLOOR: PublishedToolchain = { ...FLOORED, floor: { minPackVersion: null, graceStartsAt: null } };
const HTTPS = "https://dpf.example/api/mcp/v1";
const LOOPBACK_HTTP = "http://127.0.0.1:3000/api/mcp/v1";
const MANIFEST = "https://dpf.example/api/agent-toolchain/manifest";
const IN_GRACE = new Date("2026-10-12T00:00:00Z");
const AFTER_GRACE = new Date("2026-10-18T00:00:00Z");
const OAUTH = { authSource: "oauth" as const, credentialKind: "oauth_access" };
const PAT = { authSource: "pat" as const, credentialKind: "operator" };

const tool = (name: string) => PLATFORM_TOOLS.find((candidate) => candidate.name === name);
const GRANTS = getToolGrantMapping();
const allowed = (name: string) => isToolAllowedBelowToolchainFloor(name, tool(name), GRANTS[name]);
const declared = (client: string, pack: string) => ({ pack, digest: DIGEST.slice(0, 16), client });

function refusal(overrides: Partial<Parameters<typeof toolchainFloorRefusalResult>[0]> = {}) {
  return toolchainFloorRefusalResult({
    method: "tools/call",
    params: { name: "start_build" },
    declaration: declared("claude-code", "0.2.9"),
    credential: OAUTH,
    mcpEndpoint: HTTPS,
    published: FLOORED,
    now: AFTER_GRACE,
    manifestUrl: MANIFEST,
    ...overrides,
  });
}

describe("isToolAllowedBelowToolchainFloor", () => {
  it.each(["start_build", "write_sandbox_file", "run_sandbox_command"])("refuses %s (ratchet)", (name) => {
    expect(tool(name)).toBeDefined();
    expect(allowed(name)).toBe(false);
  });

  it("allows read tools", () => {
    expect(allowed("get_fleet_readiness")).toBe(true);
    expect(allowed("list_backlog_items")).toBe(true);
  });

  it("allows the repair path", () => {
    expect([...TOOLCHAIN_FLOOR_REPAIR_TOOLS].sort()).toEqual(
      ["issue_grok_credentials_client", "load_tools", "record_surface_readiness"],
    );
    expect(isToolAllowedBelowToolchainFloor("load_tools", undefined, undefined)).toBe(true);
    expect(allowed("record_surface_readiness")).toBe(true);
    expect(allowed("issue_grok_credentials_client")).toBe(true);
  });

  it("refuses an unknown tool", () => {
    expect(isToolAllowedBelowToolchainFloor("no_such_tool", undefined, ["backlog_read"])).toBe(false);
  });

  it("allows no side-effecting tool outside the repair path", () => {
    const leaks = PLATFORM_TOOLS.filter(
      (candidate) => candidate.sideEffect !== false
        && !TOOLCHAIN_FLOOR_REPAIR_TOOLS.has(candidate.name)
        && allowed(candidate.name),
    ).map((candidate) => candidate.name);
    expect(leaks).toEqual([]);
  });

  it("allows no tool that needs a non-read grant unless it declares readOnlyHint", () => {
    const leaks = PLATFORM_TOOLS.filter(
      (candidate) => !TOOLCHAIN_FLOOR_REPAIR_TOOLS.has(candidate.name)
        && candidate.annotations?.readOnlyHint !== true
        && (GRANTS[candidate.name] ?? []).some((grant) => !grant.endsWith("_read"))
        && allowed(candidate.name),
    ).map((candidate) => candidate.name);
    expect(leaks).toEqual([]);
  });
});

describe("toolchainFloorRefusalResult", () => {
  it.each([
    ["tools/call", { name: "start_build" }],
    ["tools/call", { name: "write_sandbox_file" }],
    ["tools/call", { name: "run_sandbox_command" }],
    ["tasks/submit", {}],
    ["tasks/cancel", { taskId: "TR-1" }],
  ])("refuses %s %j below the floor after grace, with the repair link", (method, params) => {
    const result = refusal({ method, params });
    expect(result).not.toBeNull();
    expect(result!.data).toMatchObject({
      error: "agent_toolchain_below_floor",
      writesRefused: true,
      readOperationsAllowed: true,
      repair: { manifestUrl: MANIFEST },
    });
    expect(result!.data.repair.reason).toContain("0.2.9");
    expect(result!.message).toContain(MANIFEST);
    expect(result!.message).toMatch(/restart/);
  });

  it("allows reads and the repair path below the floor", () => {
    expect(refusal({ params: { name: "get_fleet_readiness" } })).toBeNull();
    expect(refusal({ params: { name: "load_tools" } })).toBeNull();
    expect(refusal({ params: { name: "record_surface_readiness" } })).toBeNull();
    expect(refusal({ params: { name: "issue_grok_credentials_client" } })).toBeNull();
  });

  it("never touches other methods", () => {
    expect(refusal({ method: "tools/list", params: {} })).toBeNull();
    expect(refusal({ method: "tasks/get", params: {} })).toBeNull();
    expect(refusal({ method: "initialize", params: {} })).toBeNull();
  });

  it("refuses nothing during grace or before grace starts", () => {
    expect(refusal({ now: IN_GRACE })).toBeNull();
    expect(refusal({ published: { ...FLOORED, floor: { ...FLOOR, graceStartsAt: null } } })).toBeNull();
  });

  it("refuses nothing while the release sets no floor", () => {
    expect(refusal({ published: NO_FLOOR })).toBeNull();
    expect(refusal({ published: null })).toBeNull();
  });

  it("never refuses an undeclared caller", () => {
    expect(refusal({ declaration: null, credential: PAT })).toBeNull();
  });

  it("never refuses a portal session", () => {
    expect(refusal({ credential: { authSource: "session-jwt" } })).toBeNull();
  });

  it("allows a declared client at the floor", () => {
    expect(refusal({ declaration: declared("claude-code", "0.3.0") })).toBeNull();
  });

  it("a bearer where the endpoint requires one is not below the floor", () => {
    expect(refusal({ declaration: declared("claude-code", "0.3.0"), credential: PAT, mcpEndpoint: LOOPBACK_HTTP })).toBeNull();
  });

  it("a bearer where OAuth is available is below the floor", () => {
    const result = refusal({ declaration: declared("claude-code", "0.3.0"), credential: PAT, mcpEndpoint: HTTPS });
    expect(result?.data.error).toBe("agent_toolchain_below_floor");
  });

  it("Grok on an operator token is refused only after grace", () => {
    const grokOnPat = { declaration: declared("grok", "0.3.0"), credential: PAT, mcpEndpoint: LOOPBACK_HTTP };
    expect(refusal({ ...grokOnPat, now: IN_GRACE })).toBeNull();
    expect(refusal(grokOnPat)?.data.error).toBe("agent_toolchain_below_floor");
  });
});
