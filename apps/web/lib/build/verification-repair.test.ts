import { describe, it, expect, vi } from "vitest";
import {
  verificationNeedsRepair,
  selectFailingFiles,
  buildRepairPrompt,
  runVerificationRepairLoop,
  type RepairVerdict,
} from "./verification-repair";

describe("verificationNeedsRepair (BI-99B06AD1)", () => {
  it("needs repair on a typecheck failure or any in-scope test failure", () => {
    expect(verificationNeedsRepair({ typecheckPassed: false, testsFailed: 0 })).toBe(true);
    expect(verificationNeedsRepair({ typecheckPassed: true, testsFailed: 3 })).toBe(true);
  });
  it("does NOT repair a clean verdict, or a null (out-of-scope-only) typecheck", () => {
    expect(verificationNeedsRepair({ typecheckPassed: true, testsFailed: 0 })).toBe(false);
    // null typecheck = only out-of-scope noise → not this build's problem.
    expect(verificationNeedsRepair({ typecheckPassed: null, testsFailed: 0 })).toBe(false);
    expect(verificationNeedsRepair({ typecheckPassed: true, testsFailed: null })).toBe(false);
  });
});

describe("selectFailingFiles", () => {
  const changed = ["apps/web/lib/foo.ts", "apps/web/lib/bar.ts"];
  it("intersects error-named paths with the changed surface", () => {
    const out = "apps/web/lib/foo.ts(12,5): error TS2322: Type 'x' is not assignable.";
    expect(selectFailingFiles(out, changed)).toEqual(["apps/web/lib/foo.ts"]);
  });
  it("strips trailing punctuation from a matched path", () => {
    expect(selectFailingFiles("see apps/web/lib/bar.ts.", changed)).toEqual(["apps/web/lib/bar.ts"]);
  });
  it("falls back to the changed files when the error names none of them", () => {
    const out = "packages/other/thing.ts: error";
    expect(selectFailingFiles(out, changed)).toEqual(changed);
  });
  it("caps the list and de-dupes", () => {
    const many = Array.from({ length: 20 }, (_, i) => `apps/web/lib/f${i}.ts`);
    const out = many.join(" ") + " " + many[0]; // duplicate the first
    expect(selectFailingFiles(out, many).length).toBe(12);
  });
});

describe("buildRepairPrompt", () => {
  it("scopes to the failing files, embeds the real error, and forbids weakening tests", () => {
    const p = buildRepairPrompt({
      attempt: 1,
      maxRounds: 2,
      failureAxis: "test-failure",
      errorOutput: "FAIL apps/web/lib/foo.test.ts > does the thing",
      failingFiles: ["apps/web/lib/foo.ts"],
    });
    expect(p.title).toMatch(/Repair test failures \(round 1\/2\)/);
    expect(p.implement).toContain("apps/web/lib/foo.ts");
    expect(p.implement).toContain("FAIL apps/web/lib/foo.test.ts");
    expect(p.implement).toMatch(/do not.*weaken|skip, or delete tests/i);
  });
  it("labels typecheck failures as typecheck", () => {
    expect(
      buildRepairPrompt({ attempt: 2, maxRounds: 2, failureAxis: "typecheck-failure", errorOutput: "", failingFiles: [] }).title,
    ).toMatch(/typecheck/);
  });
});

describe("runVerificationRepairLoop", () => {
  const failing: RepairVerdict = { typecheckPassed: false, testsFailed: 0, failureAxis: "typecheck-failure", output: "apps/web/lib/foo.ts: error TS2322" };
  const clean: RepairVerdict = { typecheckPassed: true, testsFailed: 0, failureAxis: null, output: "ok" };

  it("repairs and stops as soon as re-verify is clean", async () => {
    const dispatchRepair = vi.fn().mockResolvedValue(true);
    const reverify = vi.fn().mockResolvedValue(clean);
    const res = await runVerificationRepairLoop({
      initial: failing, changedFiles: ["apps/web/lib/foo.ts"], maxRounds: 2, dispatchRepair, reverify,
    });
    expect(res.rounds).toBe(1);
    expect(res.repaired).toBe(true);
    expect(dispatchRepair).toHaveBeenCalledTimes(1);
    expect(reverify).toHaveBeenCalledTimes(1);
  });

  it("stops after maxRounds when it can't fix it (falls through to the gate)", async () => {
    const dispatchRepair = vi.fn().mockResolvedValue(true);
    const reverify = vi.fn().mockResolvedValue(failing); // never clean
    const res = await runVerificationRepairLoop({
      initial: failing, changedFiles: ["apps/web/lib/foo.ts"], maxRounds: 2, dispatchRepair, reverify,
    });
    expect(res.rounds).toBe(2);
    expect(res.repaired).toBe(false);
    expect(dispatchRepair).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the initial verdict is already clean", async () => {
    const dispatchRepair = vi.fn();
    const reverify = vi.fn();
    const res = await runVerificationRepairLoop({
      initial: clean, changedFiles: [], maxRounds: 2, dispatchRepair, reverify,
    });
    expect(res.rounds).toBe(0);
    expect(res.repaired).toBe(true);
    expect(dispatchRepair).not.toHaveBeenCalled();
  });

  it("stops if a repair dispatch does not complete (no stale re-verify)", async () => {
    const dispatchRepair = vi.fn().mockResolvedValue(false);
    const reverify = vi.fn();
    const res = await runVerificationRepairLoop({
      initial: failing, changedFiles: ["apps/web/lib/foo.ts"], maxRounds: 2, dispatchRepair, reverify,
    });
    expect(res.rounds).toBe(1);
    expect(res.repaired).toBe(false);
    expect(reverify).not.toHaveBeenCalled();
  });
});
