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
});
