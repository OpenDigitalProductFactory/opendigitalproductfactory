import { describe, it, expect } from "vitest";
import { isToolAllowedByGrants, TOOL_TO_GRANTS } from "./agent-grants";

// BI-6AC65187: surface-readiness tools had no TOOL_TO_GRANTS entry, so every
// client surface's G9 readiness heartbeat was denied by default.
describe("TOOL_TO_GRANTS — surface readiness (G9)", () => {
  it("record_surface_readiness is a heartbeat on work_capsule_write", () => {
    expect(TOOL_TO_GRANTS.record_surface_readiness).toEqual(["work_capsule_write"]);
    expect(isToolAllowedByGrants("record_surface_readiness", ["work_capsule_write"])).toBe(true);
    expect(isToolAllowedByGrants("record_surface_readiness", ["work_room_write"])).toBe(false);
    expect(isToolAllowedByGrants("record_surface_readiness", [])).toBe(false);
  });

  it("get_fleet_readiness is an ops read on work_capsule_read", () => {
    expect(TOOL_TO_GRANTS.get_fleet_readiness).toEqual(["work_capsule_read"]);
    expect(isToolAllowedByGrants("get_fleet_readiness", ["work_capsule_read"])).toBe(true);
    expect(isToolAllowedByGrants("get_fleet_readiness", ["work_room_read"])).toBe(false);
  });

  // BI-84C1F526: Grok's own credential carries dpf.build, so issuing it needs a build grant.
  it("issue_grok_credentials_client needs sandbox_execute, and its secret never reaches the audit row", async () => {
    expect(TOOL_TO_GRANTS.issue_grok_credentials_client).toEqual(["sandbox_execute"]);
    expect(isToolAllowedByGrants("issue_grok_credentials_client", ["sandbox_execute"])).toBe(true);
    expect(isToolAllowedByGrants("issue_grok_credentials_client", ["work_capsule_write"])).toBe(false);
    const { surfaceReadinessPack } = await import("@/lib/mcp/packs/surface-readiness-pack");
    const tool = surfaceReadinessPack.definitions.find((d) => d.name === "issue_grok_credentials_client")!;
    expect(tool).toMatchObject({ sideEffect: true, consequence: "authority", secretResultKeys: ["credentialsClient"] });
    expect(surfaceReadinessPack.grants.issue_grok_credentials_client).toEqual(TOOL_TO_GRANTS.issue_grok_credentials_client);
  });
});
