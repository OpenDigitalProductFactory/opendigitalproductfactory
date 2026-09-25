// BI-A0521CB0 — the finalize sequence, driven with fakes. It replays FB-D671B016:
// the gauntlet fails only on decision trailers, the stage records the decisions
// and re-runs it, then records scoped tests and writes the failure analysis.
import { describe, expect, it, vi } from "vitest";

import { runBuildStudioFinalize, type FinalizeDeps } from "./finalize-stage-runner";

const binding = { sha: "c".repeat(40), headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const narrative = JSON.stringify({
  designAnalysis: "Out-of-enum principleTier values silently mis-rank kernel principles.",
  scope: "Seed-time validation of principle frontmatter and three corrected pages.",
  affectedPeople: "Coworkers and owners whose decisions consult kernel principles.",
  invariants: "Every seeded principle carries a principleTier from the enum.",
  boundaries: "Seeding rejects bad frontmatter; runtime readers are unchanged.",
  noEliminationRationale: "The change detects and refuses bad input rather than removing its source.",
  scenarios: [{ key: "bad-tier", trigger: "A page is authored with an unknown principleTier", effect: "Decisions weigh the principle wrongly and silently",
    severity: "medium", exposure: "Any install that seeds the kernel from the repository", prevention: "Seed validation rejects the unknown tier",
    containment: "The seed run fails before writing the page", detection: "The seed error names the page and the value",
    recovery: "Correct the frontmatter and reseed the kernel", residualRisk: { owner: "platform-architecture", disposition: "mitigated", rationale: "Validation plus corrected pages remove the known cases" } }],
});

function deps(overrides: Partial<FinalizeDeps> = {}): FinalizeDeps & { saved: unknown[]; commits: string[] } {
  const saved: unknown[] = [];
  const commits: string[] = [];
  const gauntlet = vi.fn()
    .mockResolvedValueOnce({ ran: true, passed: false, failedGuards: ["Docs Impact Gate", "Seed Contribution Fit Gate"], output: "[seed-fit-gate] FAILED", recordId: "g1", binding })
    .mockResolvedValueOnce({ ran: true, passed: true, failedGuards: [], output: "all clean", recordId: "g2", binding });
  return {
    saved, commits,
    capture: vi.fn().mockResolvedValue({ diffPatch: "diff --git a/seed.ts b/seed.ts", changedFiles: ["packages/db/src/seed-wiki-kernel.ts"] }),
    runGauntlet: gauntlet,
    llm: vi.fn(async (prompt: string) => prompt.includes("gate decisions")
      ? "Docs-Impact-Decision: internal seed validation, no user-visible change\nSeed-Fit-Decision: global-default"
      : narrative),
    commitDecisions: vi.fn(async (lines: string[]) => { commits.push(lines.join("\n")); }),
    runScopedTests: vi.fn().mockResolvedValue({ passed: true, typeCheckPassed: true, testOutput: "57 passed", typeCheckOutput: "", scope: "scoped" }),
    recordTests: vi.fn().mockResolvedValue("t1"),
    workroom: vi.fn().mockResolvedValue({ id: "room-row", capsuleId: "WC-1E7C7DC8" }),
    resolveEvidence: vi.fn(async (ids: readonly string[]) => ids.map((id) => ({
      id, capsuleId: "WC-1E7C7DC8", headTreeHash: binding.headTreeHash, diffDigest: binding.diffDigest,
      status: "passed", expected: `ran ${id}`, observed: "passed", completedAt: "2026-09-25T03:00:00Z",
    }))),
    designReference: vi.fn().mockResolvedValue(`featureBuild/FB-D671B016/designDoc@${"d".repeat(40)}`),
    saveFailureAnalysis: vi.fn(async (fa: unknown) => { saved.push(fa); }),
    log: vi.fn(),
    ...overrides,
  };
}

describe("runBuildStudioFinalize", () => {
  it("records the decisions, passes the gauntlet, records tests, and saves a valid failure analysis", async () => {
    const d = deps();
    const out = await runBuildStudioFinalize("FB-D671B016", d);
    expect(out).toMatchObject({ status: "ready", evidenceIds: ["g2", "t1"] });
    expect(d.commits).toEqual(["Docs-Impact-Decision: internal seed validation, no user-visible change\nSeed-Fit-Decision: global-default"]);
    expect(d.runGauntlet).toHaveBeenCalledTimes(2);
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]).toMatchObject({ capsuleId: "WC-1E7C7DC8", headTreeHash: binding.headTreeHash, diffDigest: binding.diffDigest });
  });

  it("stops on a failure no decision can fix, and writes nothing", async () => {
    const d = deps({ runGauntlet: vi.fn().mockResolvedValue({ ran: true, passed: false, failedGuards: ["Module Size Guard"], output: "x", recordId: "g1", binding }) });
    const out = await runBuildStudioFinalize("FB-X", d);
    expect(out).toMatchObject({ status: "gauntlet-failed", failedGuards: ["Module Size Guard"] });
    expect(d.runGauntlet).toHaveBeenCalledTimes(2);
    expect(d.commitDecisions).not.toHaveBeenCalled();
    expect(d.saved).toHaveLength(0);
  });

  it("stops when the scoped tests fail; a failing build gets no failure analysis", async () => {
    const d = deps({ runScopedTests: vi.fn().mockResolvedValue({ passed: false, typeCheckPassed: true, testOutput: "1 failed", typeCheckOutput: "", scope: "scoped" }) });
    expect(await runBuildStudioFinalize("FB-X", d)).toMatchObject({ status: "tests-failed" });
    expect(d.saved).toHaveLength(0);
  });

  it("gives up after bounded rounds when the gauntlet keeps failing on decisions", async () => {
    const d = deps({ runGauntlet: vi.fn().mockResolvedValue({ ran: true, passed: false, failedGuards: ["Docs Impact Gate"], output: "x", recordId: "g", binding }) });
    expect(await runBuildStudioFinalize("FB-X", d)).toMatchObject({ status: "decisions-exhausted" });
    expect(d.runGauntlet).toHaveBeenCalledTimes(3);
  });

  it("re-runs a non-decision failure once and continues when the re-run passes", async () => {
    const d = deps({ runGauntlet: vi.fn()
      .mockResolvedValueOnce({ ran: true, passed: false, failedGuards: ["Janitor Tests"], output: "Could not read 7e3f", recordId: "g1", binding })
      .mockResolvedValueOnce({ ran: true, passed: true, failedGuards: [], output: "all clean", recordId: "g2", binding }) });
    const out = await runBuildStudioFinalize("FB-D671B016", d);
    expect(out).toMatchObject({ status: "ready", evidenceIds: ["g2", "t1"] });
    expect(d.log).toHaveBeenCalledWith(expect.stringContaining("re-running once"));
  });
});
