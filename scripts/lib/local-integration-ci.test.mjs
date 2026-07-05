import { describe, expect, it } from "vitest";
import { createLocalIntegrationPlan } from "./local-integration-ci.mjs";

describe("createLocalIntegrationPlan", () => {
  it("plans a single-branch local integration run", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "doc/build-studio-decision-skill-packs",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "linux",
    });

    expect(plan.commands.map((command) => command.join(" "))).toEqual([
      "git fetch origin main",
      "git checkout -B local-integration/doc-build-studio-decision-skill-packs origin/main",
      "git merge --no-ff --no-edit doc/build-studio-decision-skill-packs",
      "node scripts/sandbox-freshness-preflight.mjs --converge --branch local-integration/doc-build-studio-decision-skill-packs",
      "pnpm --filter web exec vitest run",
      "pnpm --filter web typecheck",
      "pnpm --filter web exec next build",
    ]);
  });

  it("runs the sandbox freshness preflight after every merge and before any gate", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/x",
      mode: "sibling-set",
      siblingBranches: ["feat/y"],
      hostPlatform: "linux",
    });
    const commands = plan.commands.map((command) => command.join(" "));
    const preflightIndex = commands.findIndex((c) => c.includes("sandbox-freshness-preflight.mjs"));
    const lastMergeIndex = commands.map((c, i) => (c.startsWith("git merge") ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const firstGateIndex = commands.findIndex((c) => c.includes("vitest run"));
    expect(preflightIndex).toBeGreaterThan(lastMergeIndex);
    expect(preflightIndex).toBeLessThan(firstGateIndex);
  });

  it("adds sibling branches in order for concurrent development", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "sibling-set",
      siblingBranches: ["feat/environment-broker", "fix/build-studio-copy"],
    });

    expect(plan.integrationBranch).toBe("local-integration/feat-build-studio-decision-skills-slice-1");
    expect(plan.commands.map((command) => command.join(" "))).toContain(
      "git merge --no-ff --no-edit feat/environment-broker",
    );
    expect(plan.commands.map((command) => command.join(" "))).toContain(
      "git merge --no-ff --no-edit fix/build-studio-copy",
    );
  });

  it("uses a Docker production build on Windows hosts", () => {
    const plan = createLocalIntegrationPlan({
      candidateBranch: "feat/build-studio-decision-skills-slice-1",
      mode: "single-branch",
      siblingBranches: [],
      hostPlatform: "win32",
    });

    expect(plan.commands.map((command) => command.join(" "))).toContain(
      "docker build --target build -t dpf-local-integration-feat-build-studio-decision-skills-slice-1-build .",
    );
    expect(plan.commands.map((command) => command.join(" "))).not.toContain(
      "pnpm --filter web exec next build",
    );
  });
});
