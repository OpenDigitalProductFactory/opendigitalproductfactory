import { describe, expect, it } from "vitest";
import {
  assertSandboxReadyForPromotion,
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

  it("projects the persisted sandbox source-currency verdict", () => {
    const state = buildSandboxStateFromRecord({
      buildBranch: "build/FB-123",
      gitCommitHashes: [],
      diffPatch: null,
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
      planDocument: null,
      description: null,
      buildExecState: {
        sourceCurrency: {
          source: "sandbox-git",
          status: "behind",
          recommendedAction: "auto-refresh",
          workspace: "/workspace",
          branch: "client/abc",
          headSha: "head",
          headTreeSha: "tree-head",
          targetRef: "origin/main",
          targetSha: "target",
          targetTreeSha: "tree-target",
          mergeBaseSha: "base",
          aheadBy: 0,
          behindBy: 3,
          dirty: false,
          localSourceChangeCount: 0,
          checkedAt: "2026-05-18T12:00:00.000Z",
          reason: "Sandbox is 3 commits behind origin/main.",
        },
      },
    });

    expect(state.sourceCurrency).toMatchObject({
      status: "behind",
      targetRef: "origin/main",
      recommendedAction: "auto-refresh",
    });
  });
});

describe("assertSandboxReadyForPromotion", () => {
  it("blocks promotion when the captured diff is missing files promised by the plan", () => {
    const state = buildSandboxStateFromRecord({
      buildBranch: "build/FB-STALE",
      gitCommitHashes: ["abc1234"],
      diffPatch: `diff --git a/packages/db/prisma/schema.prisma b/packages/db/prisma/schema.prisma
@@ -1 +1,2 @@
+new
`,
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
      planDocument: `## File Structure
- Create \`apps/web/lib/inference/ollama-url.ts\`: URL resolver
- Create \`apps/web/components/platform/OllamaManagement.tsx\`: model manager
`,
      description: null,
      buildExecState: {
        sourceCurrency: {
          source: "sandbox-git",
          status: "ahead",
          recommendedAction: "allow",
          workspace: "/workspace",
          branch: "build/FB-STALE",
          headSha: "head",
          headTreeSha: "tree-head",
          targetRef: "origin/main",
          targetSha: "target",
          targetTreeSha: "tree-target",
          mergeBaseSha: "target",
          aheadBy: 2,
          behindBy: 0,
          dirty: false,
          localSourceChangeCount: 2,
          checkedAt: "2026-05-18T12:00:00.000Z",
          reason: "Sandbox has local source commits.",
        },
      },
    });

    const gate = assertSandboxReadyForPromotion(state);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("Expected sandbox promotion gate to block missing plan files.");
    expect(gate.message).toContain("missing files promised by the build plan");
    expect(gate.failures).toEqual(expect.arrayContaining([
      expect.stringContaining("apps/web/lib/inference/ollama-url.ts"),
      expect.stringContaining("apps/web/components/platform/OllamaManagement.tsx"),
    ]));
  });

  it("blocks promotion when persisted source-currency asks the operator to pause", () => {
    const state = buildSandboxStateFromRecord({
      buildBranch: "build/FB-DIVERGED",
      gitCommitHashes: ["abc1234"],
      diffPatch: `diff --git a/apps/web/lib/inference/ollama-url.ts b/apps/web/lib/inference/ollama-url.ts
@@ -1 +1,2 @@
+new
`,
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
      planDocument: `## File Structure
- Create \`apps/web/lib/inference/ollama-url.ts\`: URL resolver
`,
      description: null,
      buildExecState: {
        sourceCurrency: {
          source: "sandbox-git",
          status: "diverged",
          recommendedAction: "pause",
          workspace: "/workspace",
          branch: "build/FB-DIVERGED",
          headSha: "head",
          headTreeSha: "tree-head",
          targetRef: "origin/main",
          targetSha: "target",
          targetTreeSha: "tree-target",
          mergeBaseSha: "base",
          aheadBy: 6,
          behindBy: 1,
          dirty: false,
          localSourceChangeCount: 6,
          checkedAt: "2026-05-18T12:00:00.000Z",
          reason: "Sandbox has local commits and is missing origin/main commits.",
        },
      },
    });

    const gate = assertSandboxReadyForPromotion(state);

    expect(gate.ok).toBe(false);
    if (gate.ok) throw new Error("Expected sandbox promotion gate to block paused source currency.");
    expect(gate.message).toContain("source is not promotable");
    expect(gate.failures).toContain("Sandbox source is diverged and requires pause: Sandbox has local commits and is missing origin/main commits.");
  });

  it("allows promotion when expected plan files are present and source currency allows release", () => {
    const state = buildSandboxStateFromRecord({
      buildBranch: "build/FB-CURRENT",
      gitCommitHashes: ["abc1234"],
      diffPatch: `diff --git a/apps/web/lib/inference/ollama-url.ts b/apps/web/lib/inference/ollama-url.ts
@@ -1 +1,2 @@
+new
`,
      updatedAt: new Date("2026-05-18T12:00:00.000Z"),
      planDocument: `## File Structure
- Create \`apps/web/lib/inference/ollama-url.ts\`: URL resolver
`,
      description: null,
      buildExecState: {
        sourceCurrency: {
          source: "sandbox-git",
          status: "current",
          recommendedAction: "allow",
          workspace: "/workspace",
          branch: "build/FB-CURRENT",
          headSha: "head",
          headTreeSha: "tree-head",
          targetRef: "origin/main",
          targetSha: "target",
          targetTreeSha: "tree-head",
          mergeBaseSha: "head",
          aheadBy: 0,
          behindBy: 0,
          dirty: false,
          localSourceChangeCount: 0,
          checkedAt: "2026-05-18T12:00:00.000Z",
          reason: "Sandbox source tree matches origin/main.",
        },
      },
    });

    expect(assertSandboxReadyForPromotion(state)).toEqual({
      ok: true,
      message: "Sandbox promotion integrity checks passed.",
    });
  });
});
