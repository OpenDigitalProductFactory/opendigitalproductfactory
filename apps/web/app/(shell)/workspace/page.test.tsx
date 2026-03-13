import { describe, it, expect } from "vitest";
import { getWorkspaceTiles } from "@/lib/permissions";

describe("workspace tile derivation", () => {
  it("HR-500 sees Operations tile", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-500", isSuperuser: false });
    expect(tiles.some((t) => t.key === "backlog")).toBe(true);
  });

  it("HR-500 does not see EA Modeler tile", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-500", isSuperuser: false });
    expect(tiles.some((t) => t.key === "agents")).toBe(false);
  });

  it("Admin tile only appears for HR-000", () => {
    const hr000 = getWorkspaceTiles({ platformRole: "HR-000", isSuperuser: false });
    const hr300 = getWorkspaceTiles({ platformRole: "HR-300", isSuperuser: false });
    expect(hr000.some((t) => t.key === "admin")).toBe(true);
    expect(hr300.some((t) => t.key === "admin")).toBe(false);
  });
});
