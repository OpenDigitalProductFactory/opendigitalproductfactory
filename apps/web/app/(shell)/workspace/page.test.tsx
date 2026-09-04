import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getWorkspaceTiles } from "@/lib/permissions";
import { buildWorkspaceCommandCenterView } from "@/lib/workspace-home/command-center";
import { loadPlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";

describe("workspace tile derivation", () => {
  it("HR-500 sees Backlog tile", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-500", isSuperuser: false });
    expect(tiles.some((t) => t.key === "backlog")).toBe(true);
  });

  it("HR-500 does not see Agents tile", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-500", isSuperuser: false });
    expect(tiles.some((t) => t.key === "agents")).toBe(false);
  });

  it("Admin tile only appears for HR-000", () => {
    const hr000 = getWorkspaceTiles({ platformRole: "HR-000", isSuperuser: false });
    const hr300 = getWorkspaceTiles({ platformRole: "HR-300", isSuperuser: false });
    expect(hr000.some((t) => t.key === "admin")).toBe(true);
    expect(hr300.some((t) => t.key === "admin")).toBe(false);
  });

  it("surfaces the document library from Workspace for platform operators", () => {
    const tiles = getWorkspaceTiles({ platformRole: "HR-000", isSuperuser: false });
    expect(tiles).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "documents", route: "/workspace/documents" }),
    ]));
  });

  it("keeps the command center projection importable from the workspace page package", () => {
    expect(typeof buildWorkspaceCommandCenterView).toBe("function");
  });

  it("loads platform workspace data through the workspace-home substrate boundary", () => {
    expect(typeof loadPlatformWorkspaceHomeData).toBe("function");
  });

  // BI-7626A660 inverted this pair. The panel used to open the workspace home
  // and cost roughly the top third of the first viewport; it now lives at
  // /ops/installation and the arrival-time signal is the header badge.
  it("no longer opens the workspace home with the installation identity panel", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

    expect(source).not.toContain("<InstallationIdentityPanel");
    expect(source).not.toContain("loadInstallationIdentityView");
  });

  it("keeps the identity panel behind the same platform authority on its new route", () => {
    const source = readFileSync(
      new URL("../ops/installation/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("<InstallationIdentityPanel");
    expect(source).toContain('"manage_platform"');
  });

  it("feeds the identity panel from the composed view, not a raw intent read", () => {
    const source = readFileSync(
      new URL("../ops/installation/page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("loadInstallationIdentityView");
    expect(source).not.toContain("loadInstallationOperatingIntent");
  });
});
