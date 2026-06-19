import { describe, it, expect } from "vitest";
import {
  parsePrivatePathManifest,
  compilePrivatePathMatcher,
  matchesPrivatePath,
  splitUnifiedDiffByFile,
  stripPrivatePathsFromDiff,
} from "./private-paths";

describe("parsePrivatePathManifest", () => {
  it("drops comments and blank lines, trims, dedupes, preserves order", () => {
    const text = [
      "# comment",
      "",
      "  proprietary/  ",
      "**/*.secret",
      "proprietary/", // dup after trim
      "   ",
      "# another comment",
      "config/x",
    ].join("\n");
    expect(parsePrivatePathManifest(text)).toEqual([
      "proprietary/",
      "**/*.secret",
      "config/x",
    ]);
  });
});

describe("compilePrivatePathMatcher", () => {
  it("matches an unanchored, slash-free pattern at any depth (incl. subtree)", () => {
    const isPrivate = compilePrivatePathMatcher(["secrets"]);
    expect(isPrivate("secrets")).toBe(true);
    expect(isPrivate("apps/web/secrets")).toBe(true);
    expect(isPrivate("apps/web/secrets/keys.ts")).toBe(true);
    expect(isPrivate("apps/web/public/logo.svg")).toBe(false);
  });

  it("anchors a leading-slash pattern to the repo root", () => {
    const isPrivate = compilePrivatePathMatcher(["/config/private"]);
    expect(isPrivate("config/private")).toBe(true);
    expect(isPrivate("config/private/x.ts")).toBe(true);
    expect(isPrivate("apps/config/private")).toBe(false);
  });

  it("supports `*` (within-segment) and `**` (across-segments)", () => {
    const star = compilePrivatePathMatcher(["**/*.secret"]);
    expect(star("a/b/c.secret")).toBe(true);
    expect(star("top.secret")).toBe(true);
    expect(star("a/b/c.ts")).toBe(false);

    const single = compilePrivatePathMatcher(["config/*.key"]);
    expect(single("config/api.key")).toBe(true);
    expect(single("config/nested/api.key")).toBe(false); // * does not cross /
  });

  it("treats a trailing-slash dir pattern as the dir and its subtree", () => {
    const isPrivate = compilePrivatePathMatcher(["proprietary/"]);
    expect(isPrivate("proprietary")).toBe(true);
    expect(isPrivate("proprietary/pricing.ts")).toBe(true);
    expect(isPrivate("proprietaryX")).toBe(false);
  });

  it("normalizes leading ./ and backslashes", () => {
    expect(matchesPrivatePath("./proprietary/x.ts", ["proprietary/"])).toBe(true);
    expect(matchesPrivatePath("proprietary\\x.ts", ["proprietary/"])).toBe(true);
  });

  it("empty pattern set matches nothing", () => {
    const isPrivate = compilePrivatePathMatcher([]);
    expect(isPrivate("anything")).toBe(false);
  });
});

const GIT_DIFF = [
  "diff --git a/apps/web/lib/public.ts b/apps/web/lib/public.ts",
  "index 111..222 100644",
  "--- a/apps/web/lib/public.ts",
  "+++ b/apps/web/lib/public.ts",
  "@@ -1,1 +1,1 @@",
  "-old",
  "+new",
  "diff --git a/proprietary/pricing.ts b/proprietary/pricing.ts",
  "index 333..444 100644",
  "--- a/proprietary/pricing.ts",
  "+++ b/proprietary/pricing.ts",
  "@@ -1,1 +1,1 @@",
  "-secret-old",
  "+secret-new",
].join("\n");

describe("splitUnifiedDiffByFile", () => {
  it("splits a git diff into per-file blocks with their paths", () => {
    const { blocks } = splitUnifiedDiffByFile(GIT_DIFF);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].paths).toContain("apps/web/lib/public.ts");
    expect(blocks[1].paths).toContain("proprietary/pricing.ts");
  });
});

describe("stripPrivatePathsFromDiff", () => {
  it("removes the private file block, keeps the public one", () => {
    const isPrivate = compilePrivatePathMatcher(["proprietary/"]);
    const result = stripPrivatePathsFromDiff(GIT_DIFF, isPrivate);
    expect(result.didStrip).toBe(true);
    expect(result.strippedPaths).toEqual(["proprietary/pricing.ts"]);
    expect(result.kept).toContain("apps/web/lib/public.ts");
    expect(result.kept).not.toContain("proprietary/pricing.ts");
    expect(result.kept).not.toContain("secret-new");
  });

  it("returns an empty kept diff when every file is private", () => {
    const isPrivate = compilePrivatePathMatcher(["apps/web/", "proprietary/"]);
    const result = stripPrivatePathsFromDiff(GIT_DIFF, isPrivate);
    expect(result.didStrip).toBe(true);
    expect(result.kept.trim()).toBe("");
  });

  it("is a no-op when nothing is private", () => {
    const isPrivate = compilePrivatePathMatcher(["does-not-exist/"]);
    const result = stripPrivatePathsFromDiff(GIT_DIFF, isPrivate);
    expect(result.didStrip).toBe(false);
    expect(result.kept).toBe(GIT_DIFF);
  });

  it("handles empty / whitespace diffs without throwing", () => {
    const isPrivate = compilePrivatePathMatcher(["x"]);
    expect(stripPrivatePathsFromDiff("", isPrivate).kept).toBe("");
    expect(stripPrivatePathsFromDiff("   ", isPrivate).didStrip).toBe(false);
  });

  it("retains a preamble before the first file block", () => {
    const withPreamble = "From: agent\nSubject: change\n\n" + GIT_DIFF;
    const isPrivate = compilePrivatePathMatcher(["proprietary/"]);
    const result = stripPrivatePathsFromDiff(withPreamble, isPrivate);
    expect(result.kept).toContain("Subject: change");
    expect(result.kept).toContain("apps/web/lib/public.ts");
    expect(result.kept).not.toContain("proprietary/pricing.ts");
  });
});
