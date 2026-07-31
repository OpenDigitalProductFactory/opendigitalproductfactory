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

  it("parses the machine-readable verdict after sandbox noise", () => {
    expect(parsePublishedReadinessOutput(
      `fetch complete\nDPF_PR_READINESS_JSON={"ready":false,"blockers":["Docs Impact failed locally."]}\nDPF_PR_READINESS_COMMAND fetch=0 checkout=0 readiness=1 restore=0\n`,
    )).toEqual({
      ready: false,
      blockers: ["Docs Impact failed locally."],
    });
  });
});
