import { describe, expect, it } from "vitest";

import {
  buildPublishedReadinessCommand,
  evaluateBuildVerificationReadiness,
  parsePublishedReadinessOutput,
} from "./build-studio-pr-readiness";

describe("Build Studio PR readiness", () => {
  it("blocks every incomplete build-verification class", () => {
    expect(evaluateBuildVerificationReadiness({
      typecheckPassed: false,
      testsFailed: 2,
      acceptanceMet: 1,
      acceptanceTotal: 3,
    }).blockers).toEqual([
      "TypeCheck did not pass.",
      "2 test(s) failed.",
      "2 acceptance criterion/criteria remain unmet.",
    ]);
  });

  it("requires at least one completed acceptance criterion", () => {
    expect(evaluateBuildVerificationReadiness({
      typecheckPassed: true,
      testsFailed: 0,
      acceptanceMet: 0,
      acceptanceTotal: 0,
    }).ready).toBe(false);
  });

  // BI-D9287821: a doc build's process policy drops acceptance, so nothing ever
  // records it; publishing must not demand what the policy never asked for.
  it("does not demand acceptance when the build's policy does not require it", () => {
    expect(evaluateBuildVerificationReadiness({
      typecheckPassed: true,
      testsFailed: 0,
      acceptanceMet: 0,
      acceptanceTotal: 0,
      acceptanceRequired: false,
    })).toEqual({ ready: true, blockers: [] });
  });

  it("still blocks recorded criteria that are unmet when acceptance is not required", () => {
    expect(evaluateBuildVerificationReadiness({
      typecheckPassed: true,
      testsFailed: 0,
      acceptanceMet: 0,
      acceptanceTotal: 1,
      acceptanceRequired: false,
    }).ready).toBe(false);
  });

  it("builds an exact published-ref command without embedding the PR body", () => {
    const command = buildPublishedReadinessCommand({
      branchName: "build/FB-123",
      commitSha: "a".repeat(40),
      restoreBranch: "build/FB-123",
      prBodyBase64: "dmFsaWRhdGVkIGJvZHk=",
      repositoryOwner: "OpenDigitalProductFactory",
      repositoryName: "opendigitalproductfactory",
    });
    expect(command).toContain("--published-ref");
    expect(command).toContain("refs/remotes/origin/build/FB-123");
    expect(command).toContain("a".repeat(40));
    expect(command).toContain("--json");
    expect(command).toContain("GIT_ASKPASS");
    expect(command).not.toContain("ghp_");
    expect(command).not.toContain("validated body");
  });

  // BI-5C4933EB: the check detached the shared /workspace root and then tried
  // to restore build/<id>, which git refuses while that branch is checked out
  // in the build's own worktree, so readiness never completed.
  // BI-D9287821: a body file inside the checkout is an untracked file, and the
  // readiness check refuses any tree with uncommitted changes.
  it("writes the PR body outside the checkout it validates", () => {
    const command = buildPublishedReadinessCommand({
      branchName: "dpf/abc/fix",
      commitSha: "a".repeat(40),
      restoreBranch: "build/FB-1",
      prBodyBase64: "Ym9keQ==",
      repositoryOwner: "o",
      repositoryName: "r",
      workdir: "/workspace/.builds/FB-1",
    });
    expect(command).toContain(`--pr-body-file '/tmp/.dpf-pr-body-${"a".repeat(40)}.md'`);
    expect(command).not.toMatch(/> '\.dpf-pr-body/);
  });

  it("runs in the build's own workdir, never the shared root", () => {
    const command = buildPublishedReadinessCommand({
      branchName: "build/FB-123",
      commitSha: "a".repeat(40),
      restoreBranch: "build/FB-123",
      prBodyBase64: "dmFsaWRhdGVkIGJvZHk=",
      repositoryOwner: "OpenDigitalProductFactory",
      repositoryName: "opendigitalproductfactory",
      workdir: "/workspace/.builds/FB-123",
    });
    expect(command.startsWith("cd '/workspace/.builds/FB-123'")).toBe(true);
    expect(command).not.toContain("cd /workspace;");
  });

  it("refuses a workdir outside the sandbox workspace", () => {
    expect(() => buildPublishedReadinessCommand({
      branchName: "build/FB-123",
      commitSha: "a".repeat(40),
      restoreBranch: "build/FB-123",
      prBodyBase64: "dmFsaWRhdGVkIGJvZHk=",
      repositoryOwner: "OpenDigitalProductFactory",
      repositoryName: "opendigitalproductfactory",
      workdir: "/tmp/../etc",
    })).toThrow();
  });

  it("parses the machine-readable verdict after sandbox noise", () => {
    expect(parsePublishedReadinessOutput(
      `fetch complete\nDPF_PR_READINESS_JSON={"ready":false,"blockers":["Docs Impact failed locally."]}\nDPF_PR_READINESS_COMMAND fetch=0 checkout=0 readiness=1 restore=0\n`,
    )).toEqual({
      ready: false,
      blockers: ["Docs Impact failed locally."],
    });
  });
});
