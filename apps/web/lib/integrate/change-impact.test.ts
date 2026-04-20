import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./code-graph-access", () => ({
  summarizeCodeGraphCoverage: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { summarizeCodeGraphCoverage } from "./code-graph-access";
import { analyzeChangeImpact, formatImpactForChat } from "./change-impact";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.platformRole.findMany).mockResolvedValue([
    { roleId: "HR-100", name: "Manager" },
  ] as never);
});

describe("analyzeChangeImpact", () => {
  it("adds code-graph coverage details to the report", async () => {
    vi.mocked(summarizeCodeGraphCoverage).mockResolvedValue({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      indexedFiles: ["apps/web/app/complaints/page.tsx"],
      unindexedFiles: ["packages/db/prisma/schema.prisma"],
      warnings: [],
      summary: "Code graph covers 1/2 changed files at the current indexed commit.",
    });

    const diff = [
      "diff --git a/apps/web/app/complaints/page.tsx b/apps/web/app/complaints/page.tsx",
      "--- a/apps/web/app/complaints/page.tsx",
      "+++ b/apps/web/app/complaints/page.tsx",
      "@@ -1 +1 @@",
      "-old",
      "+new",
      "diff --git a/packages/db/prisma/schema.prisma b/packages/db/prisma/schema.prisma",
      "--- a/packages/db/prisma/schema.prisma",
      "+++ b/packages/db/prisma/schema.prisma",
      "@@ -1 +1 @@",
      "-model Old {",
      "+model New {",
    ].join("\n");

    const result = await analyzeChangeImpact(diff);

    expect(result.codeGraph?.indexedFiles).toEqual(["apps/web/app/complaints/page.tsx"]);
    expect(result.codeGraph?.unindexedFiles).toEqual(["packages/db/prisma/schema.prisma"]);
    expect(result.summary).toContain("Code graph covers 1/2 changed files");
  });
});

describe("formatImpactForChat", () => {
  it("includes code-graph coverage in the chat summary when present", () => {
    const chat = formatImpactForChat({
      routes: { new: [], modified: [], deleted: [] },
      schemaChanges: [],
      impactedRoles: [],
      blastRadius: {
        newRoutes: 0,
        modifiedRoutes: 0,
        deletedRoutes: 0,
        schemaChanges: 0,
        totalFilesChanged: 2,
      },
      riskLevel: "low",
      rollbackComplexity: "simple",
      summary: "Code-only changes",
      codeGraph: {
        graphKey: "source-code",
        available: true,
        indexStatus: "ready",
        indexedFiles: ["apps/web/app/complaints/page.tsx"],
        unindexedFiles: ["packages/db/prisma/schema.prisma"],
        warnings: ["Uncommitted local changes may not be reflected in graph-backed analysis."],
        summary: "Code graph covers 1/2 changed files at the current indexed commit.",
      },
    });

    expect(chat).toContain("Code graph");
    expect(chat).toContain("1/2 changed files");
    expect(chat).toContain("Uncommitted local changes");
  });
});
