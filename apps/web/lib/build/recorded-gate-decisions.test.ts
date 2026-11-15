// BI-BA6EDCDD: a Build Studio PR must carry the gate decisions its own commits
// recorded, or the published-tree readiness refuses it on every retry.
import { describe, expect, it, vi } from "vitest";

import {
  buildRecordedDecisionsLogCommand,
  extractRecordedGateDecisions,
  mergeReadinessDecisions,
  resolvePublicationReadinessDecisions,
} from "./recorded-gate-decisions";

const SEP = "\x1e";

// FB-533EC6E2, 2026-11-13: the build recorded its decisions in its own commit,
// newest first as git log prints them.
const FB_533EC6E2_LOG = [
  [
    "chore(FB-533EC6E2): record gate decisions",
    "",
    "Docs-Impact-Decision: docs-updated — local-ci-slot-sizing.md documents the changed bounded local-CI and recovery behavior",
    "Convergence-Impact-Decision: auto-converges — release promotion carries the updated application and build-tool assets to existing installs on self-upgrade",
    "Design-Grounding-Decision: grounded — specs/plans reviewed for the Build Studio workflow; code substrate reviewed in apps/web/lib/mcp/packs/build-evidence-pack.ts",
    "Signed-off-by: dpf-agent-f53f157c <agent-f53f157c79e24864@hive.dpf>",
  ].join("\n"),
  "docs(local-ci): clarify control-plane starvation vs builder exhaustion\n\nCo-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>",
].join(SEP);

describe("extractRecordedGateDecisions", () => {
  it("carries every decision trailer the build recorded, once each, in contract order", () => {
    expect(extractRecordedGateDecisions(FB_533EC6E2_LOG)).toBe([
      "Design-Grounding-Decision: grounded — specs/plans reviewed for the Build Studio workflow; code substrate reviewed in apps/web/lib/mcp/packs/build-evidence-pack.ts",
      "Docs-Impact-Decision: docs-updated — local-ci-slot-sizing.md documents the changed bounded local-CI and recovery behavior",
      "Convergence-Impact-Decision: auto-converges — release promotion carries the updated application and build-tool assets to existing installs on self-upgrade",
    ].join("\n"));
  });

  it("keeps the newest commit's value when a decision was recorded twice", () => {
    const log = [
      "fix: later\n\nSeed-Fit-Decision: none — no seed change after the rework",
      "feat: earlier\n\nSeed-Fit-Decision: seed-updated — added a seed row",
    ].join(SEP);
    expect(extractRecordedGateDecisions(log)).toBe("Seed-Fit-Decision: none — no seed change after the rework");
  });

  it("never carries attestations, retired trailers or authorship lines", () => {
    const log = [
      "feat: x",
      "",
      "Local-CI-Evidence: gate-run-123",
      "Local-CI-Override: skipped",
      "UX-Fit-Decision: fits",
      "Signed-off-by: someone <a@b.c>",
      "Co-Authored-By: Claude <noreply@anthropic.com>",
    ].join("\n");
    expect(extractRecordedGateDecisions(log)).toBe("");
  });

  it("ignores a trailer name with no value", () => {
    expect(extractRecordedGateDecisions("feat: x\n\nConvergence-Impact-Decision:   ")).toBe("");
  });
});

describe("mergeReadinessDecisions", () => {
  it("lets an explicit decision override the recorded one of the same name", () => {
    expect(mergeReadinessDecisions(
      "Convergence-Impact-Decision: not-applicable — owner says so",
      "Convergence-Impact-Decision: auto-converges — recorded\nSeed-Fit-Decision: none — recorded",
    )).toBe("Convergence-Impact-Decision: not-applicable — owner says so\nSeed-Fit-Decision: none — recorded");
  });

  it("returns the explicit text unchanged when nothing was recorded", () => {
    expect(mergeReadinessDecisions("  Docs-Impact-Decision: none — x  ", "")).toBe("Docs-Impact-Decision: none — x");
    expect(mergeReadinessDecisions("", "")).toBe("");
  });
});

describe("buildRecordedDecisionsLogCommand", () => {
  it("reads only the build's own commits ahead of its base and upstream main", () => {
    expect(buildRecordedDecisionsLogCommand("/workspace/.builds/FB-533EC6E2", "client/5727856b-3296"))
      .toBe("cd '/workspace/.builds/FB-533EC6E2' && _dpf_up=\"\"; git rev-parse --verify --quiet origin/main >/dev/null && _dpf_up=\"^origin/main\"; git log --no-merges -n 200 --format='%B%x1e' 'client/5727856b-3296'..HEAD $_dpf_up");
  });

  it("refuses an unsafe workdir or base ref", () => {
    expect(() => buildRecordedDecisionsLogCommand("/tmp/x", "client/a")).toThrow();
    expect(() => buildRecordedDecisionsLogCommand("/workspace", "a'; rm -rf /")).toThrow();
  });
});

describe("resolvePublicationReadinessDecisions", () => {
  it("puts the recorded decisions in the PR body when the caller gave none (the automatic PR path)", async () => {
    const exec = vi.fn(async () => FB_533EC6E2_LOG);
    const decisions = await resolvePublicationReadinessDecisions({
      explicit: undefined,
      containerId: "dpf-sandbox-1",
      workdir: "/workspace/.builds/FB-533EC6E2",
      baseRef: "client/5727856b",
      exec,
    });
    expect(decisions).toContain("Convergence-Impact-Decision: auto-converges");
    expect(decisions).toContain("Design-Grounding-Decision: grounded");
    expect(decisions).toContain("Docs-Impact-Decision: docs-updated");
    expect(exec).toHaveBeenCalledWith("dpf-sandbox-1", expect.stringContaining("git log --no-merges"));
  });

  it("falls back to the explicit decisions when the sandbox cannot be read", async () => {
    const decisions = await resolvePublicationReadinessDecisions({
      explicit: "Seed-Fit-Decision: none — x",
      containerId: "dpf-sandbox-1",
      workdir: "/workspace",
      baseRef: "client/a",
      exec: async () => { throw new Error("container gone"); },
    });
    expect(decisions).toBe("Seed-Fit-Decision: none — x");
  });

  it("does not read the sandbox when the build has none", async () => {
    const exec = vi.fn();
    expect(await resolvePublicationReadinessDecisions({
      explicit: "", containerId: null, workdir: "/workspace", baseRef: "client/a", exec,
    })).toBe("");
    expect(exec).not.toHaveBeenCalled();
  });
});
