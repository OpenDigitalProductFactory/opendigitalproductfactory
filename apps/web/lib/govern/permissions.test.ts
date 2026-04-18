import { describe, it, expect } from "vitest";
import {
  can,
  getShellNavSections,
  getWorkspaceSections,
  getWorkspaceTiles,
  type CapabilityKey,
} from "./permissions.js";

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

  it("HR-300 gets EA Modeler, Portfolio, Inventory", () => {
    const tiles = getWorkspaceTiles(hr300).map((t) => t.key);
    expect(tiles).toContain("ea_modeler");
    expect(tiles).toContain("portfolio");
    expect(tiles).toContain("inventory");
  });

  it("superuser gets all 13 tiles regardless of role", () => {
    expect(getWorkspaceTiles(superuser).length).toBe(13);
  });
});

describe("getShellNavSections()", () => {
  it("groups navigation into durable areas for admin users", () => {
    const sections = getShellNavSections(hr000);

    expect(sections.map((section) => section.key)).toEqual([
      "workspace",
      "business",
      "products",
      "platform",
      "knowledge",
    ]);
    expect(sections.find((section) => section.key === "products")?.items.map((item) => item.key)).toContain("portfolio");
    expect(sections.find((section) => section.key === "platform")?.items.map((item) => item.key)).toContain("ai_workforce");
  });

  it("omits empty sections for more limited roles", () => {
    const sections = getShellNavSections(hr500);

    expect(sections.map((section) => section.key)).toEqual([
      "workspace",
      "business",
      "products",
      "knowledge",
    ]);
    expect(sections.find((section) => section.key === "platform")).toBeUndefined();
  });
});

describe("getWorkspaceSections()", () => {
  it("prioritizes AI coworker oversight for admins", () => {
    const sections = getWorkspaceSections(hr000);

    expect(sections[0]?.key).toBe("ai-control");
    expect(sections[0]?.tiles.map((tile) => tile.key)).toContain("ai_workforce");
    expect(sections[0]?.tiles.map((tile) => tile.key)).toContain("build");
  });

  it("organizes workspace by jobs to be done instead of one flat launcher", () => {
    const sections = getWorkspaceSections(hr000);

    expect(sections.map((section) => section.key)).toEqual([
      "ai-control",
      "product-oversight",
      "business-operations",
    ]);
    expect(sections.find((section) => section.key === "business-operations")?.tiles.map((tile) => tile.key)).toContain("finance");
  });
});

describe("finance permissions", () => {
  it("grants view_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "view_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "view_finance")).toBe(true);
  });

  it("denies view_finance to HR-400", () => {
    expect(can({ platformRole: "HR-400", isSuperuser: false }, "view_finance")).toBe(false);
  });

  it("grants manage_finance to HR-000 and HR-200", () => {
    expect(can({ platformRole: "HR-000", isSuperuser: false }, "manage_finance")).toBe(true);
    expect(can({ platformRole: "HR-200", isSuperuser: false }, "manage_finance")).toBe(true);
  });

  it("includes Finance workspace tile for HR-200", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-200", isSuperuser: false });
    expect(tiles.some((t) => t.key === "finance")).toBe(true);
  });

  it("superuser gets finance access", () => {
    expect(can({ platformRole: null, isSuperuser: true }, "view_finance")).toBe(true);
    expect(can({ platformRole: null, isSuperuser: true }, "manage_finance")).toBe(true);
  });
});
