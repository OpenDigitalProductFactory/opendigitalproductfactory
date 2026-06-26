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

vi.mock("./code-graph/graph-queries", () => ({
  findRelatedTests: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { summarizeCodeGraphCoverage } from "./code-graph-access";
import { findRelatedTests } from "./code-graph/graph-queries";
import {
  analyzeChangeImpact,
  changeImpactToSensitivity,
  deriveBlastRadiusSensitivity,
  formatImpactForChat,
  type ChangeImpactReport,
} from "./change-impact";
import { buildCodeGraphFreshnessTrust } from "@/lib/trust-vector/adapters/code-graph";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.platformRole.findMany).mockResolvedValue([
    { roleId: "HR-100", name: "Manager" },
  ] as never);
  vi.mocked(findRelatedTests).mockResolvedValue({
    graphKey: "source-code",
    available: true,
    indexStatus: "ready",
    warnings: [],
    summary: "No related tests are linked.",
    filePath: "apps/web/app/complaints/page.tsx",
    tests: [],
  });
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

  it("adds graph-linked related tests to the impact report", async () => {
    vi.mocked(summarizeCodeGraphCoverage).mockResolvedValue({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      indexedFiles: ["apps/web/lib/integrate/change-impact.ts"],
      unindexedFiles: [],
      warnings: [],
      summary: "Code graph covers 1/1 changed files at the current indexed commit.",
    });
    vi.mocked(findRelatedTests).mockResolvedValue({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      warnings: [],
      summary: "Found 1 related test for apps/web/lib/integrate/change-impact.ts.",
      filePath: "apps/web/lib/integrate/change-impact.ts",
      tests: [{
        path: "apps/web/lib/integrate/change-impact.test.ts",
        name: "change-impact.test.ts",
        confidence: "exact",
        startLine: 4,
        endLine: 4,
      }],
    });

    const result = await analyzeChangeImpact([
      "diff --git a/apps/web/lib/integrate/change-impact.ts b/apps/web/lib/integrate/change-impact.ts",
      "--- a/apps/web/lib/integrate/change-impact.ts",
      "+++ b/apps/web/lib/integrate/change-impact.ts",
      "@@ -1 +1 @@",
      "-old",
      "+new",
    ].join("\n"));

    expect(findRelatedTests).toHaveBeenCalledWith({
      filePath: "apps/web/lib/integrate/change-impact.ts",
    });
    expect(result.codeGraph).toEqual(expect.objectContaining({
      relatedTests: ["apps/web/lib/integrate/change-impact.test.ts"],
    }));
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
        relatedTests: ["apps/web/lib/integrate/change-impact.test.ts"],
      },
    });

    expect(chat).toContain("Code graph");
    expect(chat).toContain("1/2 changed files");
    expect(chat).toContain("Uncommitted local changes");
    expect(chat).toContain("change-impact.test.ts");
  });

  it("qualifies code-graph summaries with trust wording when trust metadata is present", () => {
    const trust = buildCodeGraphFreshnessTrust({
      graphKey: "source-code",
      available: true,
      indexStatus: "ready",
      lastIndexedAt: new Date("2026-05-10T12:00:00.000Z"),
      workspaceDirty: false,
      indexedFileCount: 42,
      lastError: null,
      asOf: new Date("2026-05-26T12:00:00.000Z"),
    });

    const chat = formatImpactForChat({
      routes: { new: [], modified: [], deleted: [] },
      schemaChanges: [],
      impactedRoles: [],
      blastRadius: {
        newRoutes: 0,
        modifiedRoutes: 0,
        deletedRoutes: 0,
        schemaChanges: 0,
        totalFilesChanged: 1,
      },
      riskLevel: "low",
      rollbackComplexity: "simple",
      summary: "Code-only changes",
      codeGraph: {
        graphKey: "source-code",
        available: true,
        indexStatus: "ready",
        indexedFiles: ["apps/web/lib/integrate/change-impact.ts"],
        unindexedFiles: [],
        warnings: [],
        summary: "Code graph covers 1/1 changed files at the current indexed commit.",
        trust,
      },
    });

    expect(chat).toContain("Code graph trust: **Low trust**");
    expect(chat).toContain("Code graph index is 16 days old.");
  });
});

// ─── EP-QUALITY-RIGHTSIZING P3: blast-radius sensitivity ─────────────────────

function reportWithRisk(riskLevel: ChangeImpactReport["riskLevel"]): ChangeImpactReport {
  return {
    routes: { new: [], modified: [], deleted: [] },
    schemaChanges: [],
    impactedRoles: [],
    blastRadius: { newRoutes: 0, modifiedRoutes: 0, deletedRoutes: 0, schemaChanges: 0, totalFilesChanged: 0 },
    riskLevel,
    rollbackComplexity: "simple",
    summary: "",
  };
}

describe("changeImpactToSensitivity", () => {
  it("maps blast-radius risk to deliverable sensitivity", () => {
    expect(changeImpactToSensitivity(reportWithRisk("critical"))).toBe("high");
    expect(changeImpactToSensitivity(reportWithRisk("high"))).toBe("high");
    expect(changeImpactToSensitivity(reportWithRisk("medium"))).toBe("elevated");
    expect(changeImpactToSensitivity(reportWithRisk("low"))).toBe("low");
  });
});

describe("deriveBlastRadiusSensitivity", () => {
  it("returns low for an empty diff (fail-open, no analysis)", async () => {
    expect(await deriveBlastRadiusSensitivity("")).toBe("low");
    expect(await deriveBlastRadiusSensitivity("   ")).toBe("low");
  });

  it("flags a schema-changing diff as HIGH sensitivity", async () => {
    vi.mocked(summarizeCodeGraphCoverage).mockResolvedValue({
      graphKey: "source-code",
      available: false,
      indexStatus: "unavailable",
      indexedFiles: [],
      warnings: [],
      summary: "",
    } as never);
    const schemaDiff = [
      "diff --git a/packages/db/prisma/schema.prisma b/packages/db/prisma/schema.prisma",
      "--- a/packages/db/prisma/schema.prisma",
      "+++ b/packages/db/prisma/schema.prisma",
      "@@ -1,2 +1,5 @@",
      "+model Invoice {",
      "+  id String @id",
      "+}",
    ].join("\n");
    expect(await deriveBlastRadiusSensitivity(schemaDiff)).toBe("high");
  });

  it("keeps a new-page-only diff at LOW sensitivity", async () => {
    vi.mocked(summarizeCodeGraphCoverage).mockResolvedValue({
      graphKey: "source-code",
      available: false,
      indexStatus: "unavailable",
      indexedFiles: [],
      warnings: [],
      summary: "",
    } as never);
    const newRouteDiff = [
      "diff --git a/apps/web/app/(shell)/foo/page.tsx b/apps/web/app/(shell)/foo/page.tsx",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/apps/web/app/(shell)/foo/page.tsx",
      "+export default function Foo() { return null; }",
    ].join("\n");
    expect(await deriveBlastRadiusSensitivity(newRouteDiff)).toBe("low");
  });
});
