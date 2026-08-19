import { describe, it, expect } from "vitest";
import { inferCommitType, inferModule, formatCommitMessage } from "./git-utils";

describe("inferCommitType", () => {
  it("detects fix from description", () => {
    expect(inferCommitType("fix the null check in router")).toBe("fix");
  });
  it("detects refactor", () => {
    expect(inferCommitType("refactor the agent panel layout")).toBe("refactor");
  });
  it("detects docs", () => {
    expect(inferCommitType("update docs for the API")).toBe("docs");
  });
  it("defaults to feat", () => {
    expect(inferCommitType("add a new button to the toolbar")).toBe("feat");
  });
});

describe("inferModule", () => {
  it("infers web-lib from apps/web/lib path", () => {
    expect(inferModule("apps/web/lib/mcp-tools.ts")).toBe("web-lib");
  });
  it("infers db from packages/db path", () => {
    expect(inferModule("packages/db/prisma/schema.prisma")).toBe("db");
  });
  it("infers web-app from apps/web/app path", () => {
    expect(inferModule("apps/web/app/(protected)/admin/page.tsx")).toBe("web-app");
  });
  it("infers web-components from component path", () => {
    expect(inferModule("apps/web/components/agent/Panel.tsx")).toBe("web-components");
  });
  it("returns root for top-level files", () => {
    expect(inferModule("package.json")).toBe("root");
  });
});

describe("formatCommitMessage", () => {
  it("formats with build ID", () => {
    const msg = formatCommitMessage({
      description: "add tooltip to button",
      filePath: "apps/web/lib/ui.ts",
      buildId: "FB-ABC12345",
      approvedBy: "user-123",
    });
    expect(msg).toContain("feat(web-lib): add tooltip to button");
    expect(msg).toContain("Build: FB-ABC12345");
    expect(msg).toContain("Approved-By: user-123");
    expect(msg).toContain("Change-Type: ai-proposed");
  });
  it("formats standalone (no build)", () => {
    const msg = formatCommitMessage({
      description: "fix typo in readme",
      filePath: "README.md",
      approvedBy: "user-456",
    });
    expect(msg).toContain("fix(root): fix typo in readme");
    expect(msg).toContain("Build: standalone");
  });
});
