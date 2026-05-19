import { describe, expect, it } from "vitest";
import {
  buildSandboxStateFromRecord,
  extractExpectedPlanFiles,
  parseDiffstat,
} from "./sandbox-state";

describe("parseDiffstat", () => {
  it("separates source paths from generated and dependency paths", () => {
    const result = parseDiffstat(`diff --git a/apps/web/lib/build/progress.ts b/apps/web/lib/build/progress.ts
@@ -1,1 +1,2 @@
-old
+new
+newer
diff --git a/apps/web/.next/cache/file b/apps/web/.next/cache/file
@@ -1 +1 @@
-x
+y
diff --git a/node_modules/pkg/index.js b/node_modules/pkg/index.js
@@ -1 +1 @@
-x
+y
`);

    expect(result.sourceDiffstat).toEqual([
      { path: "apps/web/lib/build/progress.ts", additions: 2, deletions: 1 },
    ]);
    expect(result.ignoredDiffstat).toEqual([
      { path: "apps/web/.next/cache/file", reason: "generated" },
      { path: "node_modules/pkg/index.js", reason: "dependency" },
    ]);
  });
});

describe("extractExpectedPlanFiles", () => {
  it("extracts files from a markdown File Structure section", () => {
    expect(extractExpectedPlanFiles({
      planDocument: `## File Structure
- Create \`apps/web/components/build/BuildSandboxCard.tsx\`: sandbox card
- Modify \`apps/web/components/build/BuildStudio.tsx\`: default progress view

## Task 1
body`,
      description: null,
    })).toEqual([
      "apps/web/components/build/BuildSandboxCard.tsx",
      "apps/web/components/build/BuildStudio.tsx",
    ]);
  });

  it("falls back to file-like paths in the description", () => {
    expect(extractExpectedPlanFiles({
      planDocument: null,
      description: "Touch apps/web/lib/build/progress-visibility.ts and packages/db/prisma/schema.prisma.",
    })).toEqual([
      "apps/web/lib/build/progress-visibility.ts",
      "packages/db/prisma/schema.prisma",
    ]);
  });
});

describe("buildSandboxStateFromRecord", () => {
  it("uses DB-backed metadata and marks expected files by diff presence", () => {
    const state = buildSandboxStateFromRecord({
      buildBranch: "build/FB-123",
      gitCommitHashes: ["abc1234"],
      diffPatch: `diff --git a/apps/web/lib/build/progress-visibility.ts b/apps/web/lib/build/progress-visibility.ts
@@ -1 +1,2 @@
+new
`,
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
      planDocument: null,
      description: "Create apps/web/lib/build/progress-visibility.ts and apps/web/components/build/Missing.tsx",
    });

    expect(state.branch).toBe("build/FB-123");
    expect(state.headSha).toBe("abc1234");
    expect(state.commitsAhead).toBe(1);
    expect(state.expectedPlanFiles).toEqual([
      { path: "apps/web/lib/build/progress-visibility.ts", status: "exists" },
      { path: "apps/web/components/build/Missing.tsx", status: "missing" },
    ]);
  });
});
