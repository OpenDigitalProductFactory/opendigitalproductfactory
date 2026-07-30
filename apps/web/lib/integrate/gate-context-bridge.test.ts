// Gate-context bridge tests (BI-121DC3A3).
//
// The acceptance contract from the BI: a Build Studio build-phase prompt for
// a plan touching a baselined module must contain that module's size cap
// WITHOUT any hand-written text — proven here end-to-end through the real
// generator (single source), the bridge, and getBuildContextSection.

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  computeGateContextMarkdown,
  plannedChangesFromPlan,
  resolveGateContextRepoRoot,
} from "./gate-context-bridge";
import { getBuildContextSection } from "./build-agent-prompts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

describe("plannedChangesFromPlan", () => {
  it("maps fileStructure create/modify to A/M and drops junk", () => {
    const plan = {
      buildPlan: {
        fileStructure: [
          { path: "apps/web/lib/foo/new.ts", action: "create", purpose: "x" },
          { path: "apps\\web\\instrumentation.ts", action: "modify", purpose: "y" },
          { path: "", action: "create" },
          { action: "modify" },
        ],
      },
    };
    expect(plannedChangesFromPlan(plan)).toEqual([
      { path: "apps/web/lib/foo/new.ts", status: "A" },
      { path: "apps/web/instrumentation.ts", status: "M" },
    ]);
  });

  it("accepts a plan whose fileStructure sits at the top level", () => {
    const plan = { fileStructure: [{ path: "scripts/x.mjs", action: "modify" }] };
    expect(plannedChangesFromPlan(plan)).toEqual([{ path: "scripts/x.mjs", status: "M" }]);
  });

  it("returns [] for missing/empty plans", () => {
    expect(plannedChangesFromPlan(null)).toEqual([]);
    expect(plannedChangesFromPlan({})).toEqual([]);
  });
});

describe("resolveGateContextRepoRoot", () => {
  it("resolves a root that actually contains the generator", () => {
    expect(resolveGateContextRepoRoot({ DPF_REPO_ROOT: repoRoot })).toBe(repoRoot);
  });

  it("returns null when no candidate carries the generator", () => {
    expect(resolveGateContextRepoRoot({ DPF_REPO_ROOT: join(repoRoot, "docs") })).toBeNull();
  });
});

describe("computeGateContextMarkdown (real generator)", () => {
  it("returns null for an empty change set without spawning", async () => {
    expect(await computeGateContextMarkdown([])).toBeNull();
  });

  it("emits the pack for planned files via --stdin-json", async () => {
    const markdown = await computeGateContextMarkdown(
      [{ path: "apps/web/instrumentation.ts", status: "M" }],
      { repoRoot },
    );
    expect(markdown).toContain("Gate context");
    expect(markdown).toContain("apps/web/instrumentation.ts");
    expect(markdown).toMatch(/≤ \d+ lines/);
  }, 30_000);

  it("acceptance: the build prompt section carries a baselined module's cap with no hand-written text", async () => {
    const plan = {
      buildPlan: {
        fileStructure: [{ path: "apps/web/instrumentation.ts", action: "modify", purpose: "gate" }],
      },
    };
    const gateContext = await computeGateContextMarkdown(plannedChangesFromPlan(plan), { repoRoot });
    const section = await getBuildContextSection({
      buildId: "FB-TEST",
      phase: "build",
      title: "Test",
      brief: null,
      portfolioId: null,
      plan,
      gateContext: gateContext ?? undefined,
    });
    expect(section).toContain("--- CI Gate Constraints");
    expect(section).toContain("apps/web/instrumentation.ts");
    expect(section).toMatch(/≤ \d+ lines/);
    expect(section).toContain("CI remains the authority");
  }, 30_000);
});
