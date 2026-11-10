import { describe, expect, it } from "vitest";

import { assertTierAOnly, reapArgsForBranch } from "./pull-request-merged-reap";

describe("reapArgsForBranch", () => {
  it("scopes the scan to the merged branch and never widens past Tier A", () => {
    const args = reapArgsForBranch("fix/thing", true);
    expect(args).toContain("--branch");
    expect(args[args.indexOf("--branch") + 1]).toBe("fix/thing");
    expect(args).toContain("--tier-a-only");
    expect(args).toContain("--live");
  });

  // Default OFF is the soak posture: observe the event before it deletes.
  it("is a dry run unless live reaping is explicitly enabled", () => {
    const args = reapArgsForBranch("fix/thing", false);
    expect(args).toContain("--dry-run");
    expect(args).not.toContain("--live");
  });
});

describe("assertTierAOnly", () => {
  // Tier B is stale-but-unmerged work. A merge event says nothing about it, so
  // a merge-triggered reaper must never be able to reach it.
  it("refuses a live reap that could reach Tier B", () => {
    expect(() => assertTierAOnly(["--branch", "x", "--live"])).toThrow(/tier-a-only/);
  });

  // An unscoped live run would sweep the whole fleet off a single merge — the
  // opposite of what the event means.
  it("refuses to run unscoped, even in a dry run", () => {
    expect(() => assertTierAOnly(["--json", "--tier-a-only", "--dry-run"])).toThrow(/--branch/);
  });

  it("accepts the arguments the function actually builds", () => {
    expect(() => assertTierAOnly(reapArgsForBranch("feat/x", true))).not.toThrow();
    expect(() => assertTierAOnly(reapArgsForBranch("feat/x", false))).not.toThrow();
  });
});
