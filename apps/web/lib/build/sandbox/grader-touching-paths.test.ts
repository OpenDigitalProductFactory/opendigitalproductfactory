import { describe, expect, it } from "vitest";

import { classifyGraderTouches, parseUnifiedDiff, summarizeGraderTouches } from "./grader-touching-paths";

/** A minimal `git diff` section for one file. */
function fileDiff(path: string, opts: { deleted?: boolean; added?: string[]; removed?: string[] } = {}): string {
  return [
    `diff --git a/${path} b/${path}`,
    ...(opts.deleted ? ["deleted file mode 100644"] : []),
    "index 1111111..2222222 100644",
    `--- a/${path}`,
    opts.deleted ? "+++ /dev/null" : `+++ b/${path}`,
    "@@ -1,3 +1,3 @@",
    ...(opts.removed ?? []).map((l) => `-${l}`),
    ...(opts.added ?? []).map((l) => `+${l}`),
  ].join("\n");
}

describe("parseUnifiedDiff", () => {
  it("separates files and their added and removed lines, skipping the ---/+++ headers", () => {
    const files = parseUnifiedDiff([
      fileDiff("a.ts", { added: ["x"], removed: ["y"] }),
      fileDiff("b.ts", { deleted: true, removed: ["z"] }),
    ].join("\n"));
    expect(files).toEqual([
      { path: "a.ts", deleted: false, added: ["x"], removed: ["y"] },
      { path: "b.ts", deleted: true, added: [], removed: ["z"] },
    ]);
  });
});

describe("classifyGraderTouches", () => {
  it("flags a deleted test file", () => {
    expect(classifyGraderTouches(fileDiff("apps/web/lib/x.test.ts", { deleted: true, removed: ["it('a', () => {})"] })))
      .toEqual([{ kind: "test-deleted", path: "apps/web/lib/x.test.ts" }]);
  });

  it.each([
    "  it.skip(\"works\", () => {",
    "describe.skip(\"suite\", () => {",
    "  test.only(\"just this\", () => {",
    "  xit(\"later\", () => {",
    "  it.todo(\"someday\")",
  ])("flags a newly added skip: %s", (line) => {
    const touches = classifyGraderTouches(fileDiff("apps/web/lib/x.test.ts", { added: [line] }));
    expect(touches).toEqual([expect.objectContaining({ kind: "test-skipped", path: "apps/web/lib/x.test.ts" })]);
  });

  it("does not flag a skip that only moved within the file", () => {
    const moved = "  it.skip(\"works\", () => {";
    expect(classifyGraderTouches(fileDiff("apps/web/lib/x.test.ts", { added: [moved], removed: [moved] }))).toEqual([]);
  });

  it("does not flag removing a skip, which turns a test back on", () => {
    expect(classifyGraderTouches(fileDiff("apps/web/lib/x.test.ts", {
      added: ["  it(\"works\", () => {"],
      removed: ["  it.skip(\"works\", () => {"],
    }))).toEqual([]);
  });

  it.each([
    "scripts/check-module-size.mjs",
    "scripts/pregate-preflight.mjs",
    "scripts/lib/pregate-preflight.mjs",
  ])("flags a guard script: %s", (path) => {
    expect(classifyGraderTouches(fileDiff(path, { added: ["// x"] }))).toEqual([{ kind: "guard-script", path }]);
  });

  it("flags a CI workflow", () => {
    expect(classifyGraderTouches(fileDiff(".github/workflows/ci.yml", { added: ["on: push"] })))
      .toEqual([{ kind: "ci-workflow", path: ".github/workflows/ci.yml" }]);
  });

  it("flags test runner config, and a coverage threshold change in it", () => {
    expect(classifyGraderTouches(fileDiff("apps/web/vitest.config.ts", { added: ["  lines: 40,"], removed: ["  lines: 80,"] })))
      .toEqual([
        { kind: "test-config", path: "apps/web/vitest.config.ts" },
        { kind: "coverage-threshold", path: "apps/web/vitest.config.ts" },
      ]);
    expect(classifyGraderTouches(fileDiff("apps/mobile/jest.config.js", { added: ["  testTimeout: 5000,"] })))
      .toEqual([{ kind: "test-config", path: "apps/mobile/jest.config.js" }]);
  });

  it("leaves ordinary product and test changes alone", () => {
    const patch = [
      fileDiff("apps/web/lib/feature.ts", { added: ["export const x = 1;"] }),
      fileDiff("apps/web/lib/feature.test.ts", { added: ["  it(\"x is 1\", () => {"] }),
      fileDiff("scripts/installer/install.sh", { added: ["echo hi"] }),
      fileDiff("docs/notes.md", { added: ["Mention it.skip( in prose"] }),
    ].join("\n");
    expect(classifyGraderTouches(patch)).toEqual([]);
  });

  it("returns nothing for an empty diff", () => {
    expect(classifyGraderTouches("")).toEqual([]);
  });
});

describe("summarizeGraderTouches", () => {
  it("is null when nothing was touched, so no trail line is written", () => {
    expect(summarizeGraderTouches([])).toBeNull();
  });

  it("names each touch and asks for explicit acceptance", () => {
    const summary = summarizeGraderTouches([
      { kind: "guard-script", path: "scripts/check-a.mjs" },
      { kind: "test-deleted", path: "x.test.ts" },
    ]);
    expect(summary).toContain("(2)");
    expect(summary).toContain("guard-script scripts/check-a.mjs");
    expect(summary).toContain("must accept these parts explicitly");
  });

  it("bounds a long list", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ kind: "test-deleted" as const, path: `t${i}.test.ts` }));
    expect(summarizeGraderTouches(many)).toContain("and 4 more");
  });
});
