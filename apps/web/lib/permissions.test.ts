import { describe, it, expect } from "vitest";
import { can, getWorkspaceTiles, type CapabilityKey } from "./permissions.js";

const hr000 = { platformRole: "HR-000", isSuperuser: false };
const hr300 = { platformRole: "HR-300", isSuperuser: false };
const hr500 = { platformRole: "HR-500", isSuperuser: false };
const noRole = { platformRole: null, isSuperuser: false };
const superuser = { platformRole: null, isSuperuser: true };

describe("can()", () => {
  it("HR-000 can access everything", () => {
    const keys: CapabilityKey[] = ["view_ea_modeler", "view_admin", "view_portfolio", "view_operations"];
    keys.forEach((k) => expect(can(hr000, k)).toBe(true));
  });

  it("HR-300 can view EA Modeler but not admin", () => {
    expect(can(hr300, "view_ea_modeler")).toBe(true);
    expect(can(hr300, "view_admin")).toBe(false);
  });

  it("HR-500 can view operations but not portfolio", () => {
    expect(can(hr500, "view_operations")).toBe(true);
    expect(can(hr500, "view_portfolio")).toBe(false);
  });

  it("HR-500 can manage_backlog", () => {
    expect(can(hr500, "manage_backlog")).toBe(true);
  });

  it("HR-300 cannot manage_backlog", () => {
    expect(can(hr300, "manage_backlog")).toBe(false);
  });

  it("user with no role cannot view admin", () => {
    expect(can(noRole, "view_admin")).toBe(false);
  });

  it("superuser with no role can access any capability", () => {
    expect(can(superuser, "view_admin")).toBe(true);
    expect(can(superuser, "manage_provider_connections")).toBe(true);
  });
});

describe("getWorkspaceTiles()", () => {
  it("HR-000 gets all tiles", () => {
    expect(getWorkspaceTiles(hr000).length).toBeGreaterThanOrEqual(6);
  });

  it("HR-500 only gets tiles they can access", () => {
    const tiles = getWorkspaceTiles(hr500).map((t) => t.key);
    expect(tiles).toContain("backlog");
    expect(tiles).not.toContain("agents");
    expect(tiles).not.toContain("admin");
  });

  it("HR-300 gets Agents, Portfolio, Inventory", () => {
    const tiles = getWorkspaceTiles(hr300).map((t) => t.key);
    expect(tiles).toContain("agents");
    expect(tiles).toContain("portfolio");
    expect(tiles).toContain("inventory");
  });

  it("superuser gets all 8 tiles regardless of role", () => {
    expect(getWorkspaceTiles(superuser).length).toBe(8);
  });
});
