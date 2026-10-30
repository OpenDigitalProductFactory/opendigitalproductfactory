import { describe, expect, it } from "vitest";

import { classifyGuardRefusals, type GuardRunForClassification } from "./classify-guard-refusals";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-09-01T00:00:00Z");
const NOW = new Date(T0 + 30 * DAY);
const sha = (c: string) => c.repeat(40);
const digest = (c: string) => c.repeat(64);

type GuardOverrides = Partial<GuardRunForClassification["guards"][number]>;

function run(
  runId: string,
  dayOffset: number,
  verdict: "passed" | "refused" | "self-test-failed" | "runner-failed" | "skipped",
  overrides: {
    patchId?: string | null;
    baseSha?: string | null;
    headSha?: string;
    dirty?: boolean;
    override?: GuardRunForClassification["override"];
    guard?: GuardOverrides;
    branch?: string;
    cloneKey?: string;
  } = {},
): GuardRunForClassification {
  return {
    runId,
    startedAt: new Date(T0 + dayOffset * DAY),
    cloneKey: overrides.cloneKey ?? "0".repeat(16),
    branch: overrides.branch ?? "feat/x",
    baseSha: overrides.baseSha === undefined ? sha("a") : overrides.baseSha,
    headSha: overrides.headSha ?? sha(String(dayOffset % 10)),
    patchId: overrides.patchId === undefined ? sha("1") : overrides.patchId,
    dirty: overrides.dirty ?? false,
    override: overrides.override ?? null,
    guards: [
      {
        guardId: "loop:check-no-x",
        kind: "guard",
        guardDigest: digest("d"),
        baselineDigest: null,
        verdict,
        ...overrides.guard,
      },
    ],
  };
}

function outcomeOf(runs: GuardRunForClassification[]) {
  return classifyGuardRefusals(runs, { now: NOW }).map((c) => [c.runId, c.outcome, c.reason]);
}

describe("classifyGuardRefusals — design §4.3, one test per row", () => {
  it("a refusal whose run carried an override is overridden", () => {
    const runs = [run("r1", 0, "refused", { override: { kind: "skip-env", code: "DPF_SKIP_PREGATE_PREFLIGHT_REASON", reason: "x" } })];
    expect(outcomeOf(runs)).toEqual([["r1", "overridden", "DPF_SKIP_PREGATE_PREFLIGHT_REASON"]]);
  });

  it("no passing run within 14 days is unresolved (no-later-pass)", () => {
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 15, "passed", { patchId: sha("2") })])).toEqual([
      ["r1", "unresolved", "no-later-pass"],
    ]);
  });

  it("a dirty refused or passing run is unresolved (dirty-tree)", () => {
    expect(outcomeOf([run("r1", 0, "refused", { dirty: true }), run("p1", 1, "passed", { patchId: sha("2") })])).toEqual([
      ["r1", "unresolved", "dirty-tree"],
    ]);
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed", { patchId: sha("2"), dirty: true })])).toEqual([
      ["r1", "unresolved", "dirty-tree"],
    ]);
  });

  it("a moved base is unresolved (base-moved): main may have fixed it", () => {
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed", { patchId: sha("2"), baseSha: sha("b") })])).toEqual([
      ["r1", "unresolved", "base-moved"],
    ]);
  });

  it("the guard changed and the code did not: false-refusal", () => {
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed", { guard: { guardDigest: digest("e") } })])).toEqual([
      ["r1", "false-refusal", "guard-changed"],
    ]);
  });

  it("the guard and the code both changed: unresolved (ambiguous)", () => {
    expect(
      outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed", { patchId: sha("2"), guard: { guardDigest: digest("e") } })]),
    ).toEqual([["r1", "unresolved", "ambiguous"]]);
  });

  it("only the baseline changed: overridden (baseline-raised)", () => {
    expect(
      outcomeOf([
        run("r1", 0, "refused", { guard: { baselineDigest: digest("1") } }),
        run("p1", 1, "passed", { guard: { baselineDigest: digest("2") } }),
      ]),
    ).toEqual([["r1", "overridden", "baseline-raised"]]);
  });

  it("AC-GOE-03: a refusal followed by a fixing commit on an unchanged guard and base is caught", () => {
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed", { patchId: sha("2") })])).toEqual([
      ["r1", "caught", "code-changed"],
    ]);
  });

  it("nothing changed and the verdict flipped: unresolved (flaky-pass)", () => {
    expect(outcomeOf([run("r1", 0, "refused"), run("p1", 1, "passed")])).toEqual([["r1", "unresolved", "flaky-pass"]]);
  });
});

describe("classifyGuardRefusals — scope", () => {
  it("leaves a refusal inside its 14-day window unclassified", () => {
    const recent = new Date(NOW.getTime() - 3 * DAY);
    const runs = [{ ...run("r1", 0, "refused"), startedAt: recent }];
    expect(classifyGuardRefusals(runs, { now: NOW })).toEqual([]);
  });

  it("classifies an in-window refusal once its deciding pass exists", () => {
    const runs = [
      { ...run("r1", 0, "refused"), startedAt: new Date(NOW.getTime() - 3 * DAY) },
      { ...run("p1", 0, "passed", { patchId: sha("2") }), startedAt: new Date(NOW.getTime() - 2 * DAY) },
    ];
    expect(outcomeOf(runs)).toEqual([["r1", "caught", "code-changed"]]);
  });

  it("classifies intermediate refusals against the same deciding pass", () => {
    expect(
      outcomeOf([run("r1", 0, "refused"), run("r2", 1, "refused", { patchId: sha("3") }), run("p1", 2, "passed", { patchId: sha("2") })]),
    ).toEqual([
      ["r1", "caught", "code-changed"],
      ["r2", "caught", "code-changed"],
    ]);
  });

  it("never classifies aggregate or hook results, self-test failures, runner failures or skips", () => {
    const runs = [
      run("a1", 0, "refused", { guard: { kind: "aggregate", guardId: "policy:repo-guard-loop" } }),
      run("h1", 0, "refused", { guard: { kind: "hook", guardId: "hook:pre-push-gate" } }),
      run("s1", 0, "self-test-failed"),
      run("f1", 0, "runner-failed"),
      run("k1", 0, "skipped"),
    ];
    expect(classifyGuardRefusals(runs, { now: NOW })).toEqual([]);
  });

  it("pairs only within the same clone and branch", () => {
    expect(
      outcomeOf([
        run("r1", 0, "refused"),
        run("p-other-branch", 1, "passed", { patchId: sha("2"), branch: "feat/y" }),
        run("p-other-clone", 1, "passed", { patchId: sha("2"), cloneKey: "1".repeat(16) }),
      ]),
    ).toEqual([["r1", "unresolved", "no-later-pass"]]);
  });

  it("returns a stable key per (runId, guardId) and cites the deciding run", () => {
    const [classification] = classifyGuardRefusals([run("r1", 0, "refused"), run("p1", 1, "passed", { patchId: sha("2") })], {
      now: NOW,
    });
    expect(classification).toMatchObject({ key: "r1:loop:check-no-x", decidingRunId: "p1", guardId: "loop:check-no-x" });
  });
});
