import { describe, expect, it } from "vitest";

import {
  buildSandboxSourceCurrencyProbeCommand,
  classifySandboxSourceCurrency,
  formatSandboxSourceCurrencySummary,
  parseSandboxSourceCurrencyProbeOutput,
} from "./sandbox-source-currency";

describe("classifySandboxSourceCurrency", () => {
  it("treats matching source trees as current even when sandbox has an empty baseline commit", () => {
    const snapshot = classifySandboxSourceCurrency({
      branch: "client/abc",
      headSha: "sandbox-baseline",
      headTreeSha: "tree-main",
      targetRef: "origin/main",
      targetSha: "main-tip",
      targetTreeSha: "tree-main",
      mergeBaseSha: "main-tip",
      aheadBy: 1,
      behindBy: 0,
      dirty: false,
      localSourceChangeCount: 0,
      checkedAt: "2026-05-18T12:00:00.000Z",
      workspace: "/workspace",
    });

    expect(snapshot.status).toBe("current");
    expect(snapshot.recommendedAction).toBe("allow");
  });

  it("classifies a clean branch with only non-source local commits as behind when main moved", () => {
    const snapshot = classifySandboxSourceCurrency({
      branch: "client/abc",
      headSha: "sandbox-baseline",
      headTreeSha: "tree-old",
      targetRef: "origin/main",
      targetSha: "main-new",
      targetTreeSha: "tree-new",
      mergeBaseSha: "main-old",
      aheadBy: 1,
      behindBy: 3,
      dirty: false,
      localSourceChangeCount: 0,
      checkedAt: "2026-05-18T12:00:00.000Z",
      workspace: "/workspace",
    });

    expect(snapshot.status).toBe("behind");
    expect(snapshot.recommendedAction).toBe("auto-refresh");
  });

  it("pauses a dirty sandbox before any freshness conclusion", () => {
    const snapshot = classifySandboxSourceCurrency({
      branch: "build/FB-123",
      headSha: "head",
      headTreeSha: "tree-head",
      targetRef: "client/abc",
      targetSha: "client",
      targetTreeSha: "tree-client",
      mergeBaseSha: "client",
      aheadBy: 0,
      behindBy: 0,
      dirty: true,
      localSourceChangeCount: 0,
      checkedAt: "2026-05-18T12:00:00.000Z",
      workspace: "/workspace",
    });

    expect(snapshot.status).toBe("dirty");
    expect(snapshot.recommendedAction).toBe("pause");
  });

  it("pauses a branch that has source commits and is missing newer target commits", () => {
    const snapshot = classifySandboxSourceCurrency({
      branch: "build/FB-123",
      headSha: "feature-head",
      headTreeSha: "tree-feature",
      targetRef: "client/abc",
      targetSha: "client-new",
      targetTreeSha: "tree-client-new",
      mergeBaseSha: "client-old",
      aheadBy: 2,
      behindBy: 4,
      dirty: false,
      localSourceChangeCount: 5,
      checkedAt: "2026-05-18T12:00:00.000Z",
      workspace: "/workspace",
    });

    expect(snapshot.status).toBe("diverged");
    expect(snapshot.recommendedAction).toBe("pause");
  });

  it("reports unknown when git cannot resolve the target ref", () => {
    const snapshot = classifySandboxSourceCurrency({
      branch: "client/abc",
      headSha: "head",
      headTreeSha: "tree-head",
      targetRef: "origin/main",
      targetSha: null,
      targetTreeSha: null,
      mergeBaseSha: null,
      aheadBy: null,
      behindBy: null,
      dirty: false,
      localSourceChangeCount: null,
      checkedAt: "2026-05-18T12:00:00.000Z",
      workspace: "/workspace",
    });

    expect(snapshot.status).toBe("unknown");
    expect(snapshot.recommendedAction).toBe("inspect");
  });
});

describe("parseSandboxSourceCurrencyProbeOutput", () => {
  it("parses git probe output into a classified snapshot", () => {
    const snapshot = parseSandboxSourceCurrencyProbeOutput(
      [
        "branch=build/FB-123",
        "headSha=head",
        "headTreeSha=tree-head",
        "targetSha=target",
        "targetTreeSha=tree-target",
        "mergeBaseSha=base",
        "aheadBehind=2 5",
        "dirty=false",
        "localSourceChangeCount=7",
      ].join("\n"),
      {
        targetRef: "origin/main",
        checkedAt: "2026-05-18T12:00:00.000Z",
        workspace: "/workspace",
      },
    );

    expect(snapshot).toMatchObject({
      source: "sandbox-git",
      status: "diverged",
      branch: "build/FB-123",
      aheadBy: 2,
      behindBy: 5,
      localSourceChangeCount: 7,
    });
  });
});

describe("buildSandboxSourceCurrencyProbeCommand", () => {
  it("checks tree identity, ahead/behind counts, dirty state, and local source changes", () => {
    const command = buildSandboxSourceCurrencyProbeCommand({
      workspace: "/workspace",
      targetRef: "origin/main",
    });

    expect(command).toContain("rev-parse HEAD^{tree}");
    expect(command).toContain("rev-parse origin/main^{tree}");
    expect(command).toContain("rev-list --left-right --count HEAD...origin/main");
    expect(command).toContain("status --porcelain --untracked-files=all -- .");
    expect(command).toContain("localSourceChangeCount");
    expect(command).toContain(":!**/.next/**");
    expect(command).toContain(":!apps/web/next-env.d.ts");
    expect(command).toContain(":!.pnpm-store");
  });
});

describe("formatSandboxSourceCurrencySummary", () => {
  it("names the branch, target, status, and recommended operator action", () => {
    const summary = formatSandboxSourceCurrencySummary({
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
    });

    expect(summary).toContain("client/abc");
    expect(summary).toContain("behind");
    expect(summary).toContain("origin/main");
    expect(summary).toContain("auto-refresh");
  });
});
