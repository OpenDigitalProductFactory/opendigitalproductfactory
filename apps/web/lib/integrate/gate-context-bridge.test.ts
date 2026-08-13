// Gate-context bridge tests (BI-121DC3A3).
//
// The acceptance contract from the BI: a Build Studio build-phase prompt for
// a plan touching a baselined module must contain that module's size cap
// WITHOUT any hand-written text — proven here end-to-end through the real
// generator (single source), the bridge, and getBuildContextSection.

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  computeChangeImpactContract,
  computeGateContextJson,
  computeGateContextMarkdown,
  plannedChangesFromPlan,
  resolveGateContextRepoRoot,
} from "./gate-context-bridge";
import { getBuildContextSection } from "./build-agent-prompts";

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fakeRepoRoot(label: string) {
  const root = mkdtempSync(join(tmpdir(), `dpf-gate-context-${label}-`));
  temporaryRoots.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "scripts", "gate-context.mjs"), "// fixture\n");
  return root;
}

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

  it("walks up from a nested working directory when configured roots are stale", () => {
    const previous = process.cwd();
    process.chdir(join(repoRoot, "docs"));
    try {
      expect(resolveGateContextRepoRoot({ DPF_REPO_ROOT: join(repoRoot, "missing") })).toBe(repoRoot);
    } finally {
      process.chdir(previous);
    }
  });

  it("prefers image-owned working-directory bytes over a mutable host checkout", () => {
    const imageRoot = fakeRepoRoot("image");
    const hostRoot = fakeRepoRoot("host");
    const previous = process.cwd();
    process.chdir(imageRoot);
    try {
      expect(resolveGateContextRepoRoot({ DPF_REPO_ROOT: hostRoot })).toBe(realpathSync(imageRoot));
    } finally {
      process.chdir(previous);
    }
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

describe("change-impact contract", () => {
  it("returns typed resolved JSON for planned edit paths", async () => {
    const context = await computeGateContextJson(
      [{ path: "apps/web/components/ops/NewActivityPanel.tsx", status: "A" }],
      { repoRoot },
    );
    expect(context?.schemaVersion).toBe(2);
    expect(context?.guardObligations.some((entry) => entry.id === "prose-lint-guard")).toBe(true);

    const contract = await computeChangeImpactContract(
      ["apps/web/components/ops/NewActivityPanel.tsx"],
      { repoRoot },
    );
    expect(contract.status).toBe("resolved");
    expect(contract.paths).toEqual(["apps/web/components/ops/NewActivityPanel.tsx"]);
    expect(contract.gateContext?.schemaVersion).toBe(2);
    expect(contract.gateContext?.moduleSize).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "apps/web/components/ops/NewActivityPanel.tsx", rule: expect.stringContaining("new module") }),
    ]));
  }, 30_000);

  it("fails safe when the generator cannot be resolved", async () => {
    const contract = await computeChangeImpactContract(
      ["apps/web/lib/example.ts"],
      { repoRoot: join(repoRoot, "docs") },
    );
    expect(contract).toMatchObject({
      status: "unresolved",
      paths: ["apps/web/lib/example.ts"],
      reason: "gate-context generator unavailable or returned invalid JSON",
    });
    expect(contract.instructions.join(" ")).toMatch(/exhaustive verification/i);
  });

  it("marks directory scope unresolved instead of claiming an empty impact set", async () => {
    const contract = await computeChangeImpactContract(["apps/web/lib"], { repoRoot });
    expect(contract).toMatchObject({
      status: "unresolved",
      unresolvedPaths: ["apps/web/lib"],
    });
    expect(contract.reason).toMatch(/concrete files/i);
  });
});
