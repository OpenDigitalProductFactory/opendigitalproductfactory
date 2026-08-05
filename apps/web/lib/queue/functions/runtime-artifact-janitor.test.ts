// BI-DBF3F426 / BI-A55BE432 — unit tests for the runtime-artifact janitor schedule.
//
// Two load-bearing properties: (1) OBSERVE args can never carry a reaping flag, and
// (2) the live `--apply` path is reached ONLY when BOTH the master switch and the
// AUTO_REAP flag are set. Tests inject a fake `runScan` so no docker/git is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runRuntimeArtifactJanitorObserve,
  assertObserveArgs,
  assertAutoReapArgs,
  OBSERVE_SCAN_ARGS,
  AUTO_REAP_SCAN_ARGS,
  ARTIFACT_JANITOR_OBSERVE_FLAG,
  ARTIFACT_JANITOR_AUTO_REAP_FLAG,
  runtimeArtifactJanitor,
  type ScanOutcome,
  type ArtifactJanitorScan,
} from "./runtime-artifact-janitor";

const ENABLED_ENV = { [ARTIFACT_JANITOR_OBSERVE_FLAG]: "1" };
const AUTO_REAP_ENV = {
  [ARTIFACT_JANITOR_OBSERVE_FLAG]: "1",
  [ARTIFACT_JANITOR_AUTO_REAP_FLAG]: "1",
};

function scanOutcome(overrides: {
  mode?: string;
  stalenessDays?: number;
  imageDecisions?: unknown[];
  projectDecisions?: unknown[];
  applied?: unknown;
} = {}): ScanOutcome {
  const scan = {
    mode: overrides.mode ?? "dry-run",
    stalenessDays: overrides.stalenessDays ?? 7,
    imageDecisions: overrides.imageDecisions ?? [],
    projectDecisions: overrides.projectDecisions ?? [],
    ...(overrides.applied !== undefined ? { applied: overrides.applied } : {}),
  } as ArtifactJanitorScan;
  return { available: true, scan };
}

describe("runtime-artifact-janitor — dry-run / no-apply invariant (BI-DBF3F426)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("OBSERVE_SCAN_ARGS is exactly --json and contains no reaping flag", () => {
    expect([...OBSERVE_SCAN_ARGS]).toEqual(["--json"]);
    expect(OBSERVE_SCAN_ARGS).not.toContain("--apply");
    expect(OBSERVE_SCAN_ARGS).not.toContain("--live");
  });

  it("assertObserveArgs throws if an apply/live flag is ever introduced", () => {
    expect(() => assertObserveArgs(["--json"])).not.toThrow();
    expect(() => assertObserveArgs(["--json", "--apply"])).toThrow(/never contain reaping flags/);
    expect(() => assertObserveArgs(["--live"])).toThrow(/never contain reaping flags/);
    expect(() => assertObserveArgs(["--staleness-days=14"])).not.toThrow();
  });

  it("skips (no scan) when the observe flag is off — conservative default", async () => {
    const runScan = vi.fn(async (): Promise<ScanOutcome> => scanOutcome());
    const result = await runRuntimeArtifactJanitorObserve({ env: {}, runScan });
    expect(result.skipped).toBe(true);
    // The scan is never even invoked when disabled.
    expect(runScan).not.toHaveBeenCalled();
  });

  it("runs the injected scan in dry-run and returns the would-reap summary (deletes nothing)", async () => {
    const runScan = vi.fn(
      async (): Promise<ScanOutcome> =>
        scanOutcome({
          imageDecisions: [
            {
              image: { repository: "dpf-local-integration-foo-build" },
              verdict: "REAP",
              reason: "orphaned per-branch CI image 9.0d old (>=7d)",
              ageDays: 9,
            },
            {
              image: { repository: "dpf-local-integration-bar-build" },
              verdict: "KEEP",
              reason: "only 2.0d old (<7d grace)",
              ageDays: 2,
            },
          ],
          projectDecisions: [
            {
              project: { projectName: "dpf-stale-topic" },
              verdict: "REAP",
              reason: "orphaned worktree compose project (no live worktree) 8.0d idle",
              ageDays: 8,
            },
          ],
        }),
    );

    const result = await runRuntimeArtifactJanitorObserve({ env: ENABLED_ENV, runScan });

    expect(runScan).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected a summary");
    expect(result.mode).toBe("dry-run");
    expect(result.wouldReapImages).toBe(1); // only the REAP verdict, not the KEEP
    expect(result.wouldReapImageRepositories).toEqual(["dpf-local-integration-foo-build"]);
    expect(result.wouldReapProjects).toBe(1);
    expect(result.wouldReapProjectNames).toEqual(["dpf-stale-topic"]);
  });

  it("REFUSES a scan that reports any mode other than dry-run", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runScan = vi.fn(async (): Promise<ScanOutcome> => scanOutcome({ mode: "apply" }));
    const result = await runRuntimeArtifactJanitorObserve({ env: ENABLED_ENV, runScan });
    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error("expected skip");
    expect(result.reason).toMatch(/unexpected scan mode/);
    expect(errSpy).toHaveBeenCalled();
  });

  it("degrades gracefully (skip, no throw) when detection is unavailable — e.g. no docker in the portal container", async () => {
    const runScan = vi.fn(
      async (): Promise<ScanOutcome> => ({ available: false, reason: "docker not available" }),
    );
    const result = await runRuntimeArtifactJanitorObserve({ env: ENABLED_ENV, runScan });
    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error("expected skip");
    expect(result.reason).toMatch(/docker not available/);
  });

  it("exports runtimeArtifactJanitor as a defined Inngest function object", () => {
    expect(runtimeArtifactJanitor).toBeDefined();
    expect(typeof runtimeArtifactJanitor).toBe("object");
  });
});

describe("runtime-artifact-janitor — founder-gated auto-reap (BI-A55BE432)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("AUTO_REAP_SCAN_ARGS carries --apply; assertAutoReapArgs guards it", () => {
    expect([...AUTO_REAP_SCAN_ARGS]).toContain("--apply");
    expect([...AUTO_REAP_SCAN_ARGS]).toContain("--json");
    expect(() => assertAutoReapArgs(["--json", "--apply"])).not.toThrow();
    expect(() => assertAutoReapArgs(["--json"])).toThrow(/must include --apply/);
  });

  it("stays in dry-run when only the master switch is set (AUTO_REAP absent)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runScan = vi.fn(async (mode: "dry-run" | "apply"): Promise<ScanOutcome> => scanOutcome({ mode }));
    const result = await runRuntimeArtifactJanitorObserve({ env: ENABLED_ENV, runScan });
    expect(runScan).toHaveBeenCalledWith("dry-run");
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected a summary");
    expect(result.mode).toBe("dry-run");
    warnSpy.mockRestore();
  });

  it("reaps live and returns the apply summary (incl. reclaimed volumes) when both flags are set", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const runScan = vi.fn(
      async (mode: "dry-run" | "apply"): Promise<ScanOutcome> =>
        scanOutcome({
          mode,
          projectDecisions: [
            {
              project: { projectName: "dpf-provider-openrouter-policy" },
              verdict: "REAP",
              reason: "orphaned worktree compose project 15.9d idle",
              ageDays: 15.9,
            },
          ],
          applied: {
            images: [],
            projects: [
              {
                projectName: "dpf-provider-openrouter-policy",
                ok: true,
                volumes: [
                  { name: "dpf-provider-openrouter-policy_dev_pgdata", ok: true },
                  { name: "dpf-provider-openrouter-policy_dev_node_modules", ok: true },
                  { name: "dpf-provider-openrouter-policy_dev_nm_db", ok: false }, // failed rm not counted
                ],
              },
            ],
          },
        }),
    );

    const result = await runRuntimeArtifactJanitorObserve({ env: AUTO_REAP_ENV, runScan });

    expect(runScan).toHaveBeenCalledWith("apply");
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error("expected a summary");
    expect(result.mode).toBe("apply");
    if (result.mode !== "apply") throw new Error("expected apply summary");
    expect(result.reapedProjects).toBe(1);
    expect(result.reclaimedVolumes).toBe(2); // only the ok:true volumes
    expect(result.reapedProjectNames).toEqual(["dpf-provider-openrouter-policy"]);
    warnSpy.mockRestore();
  });

  it("REFUSES an apply run whose scan reports the wrong mode (mismatch tripwire)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const runScan = vi.fn(async (): Promise<ScanOutcome> => scanOutcome({ mode: "dry-run" }));
    const result = await runRuntimeArtifactJanitorObserve({ env: AUTO_REAP_ENV, runScan });
    expect(result.skipped).toBe(true);
    if (!result.skipped) throw new Error("expected skip");
    expect(result.reason).toMatch(/unexpected scan mode/);
    expect(errSpy).toHaveBeenCalled();
  });
});
