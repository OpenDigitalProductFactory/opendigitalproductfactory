// GPP C-8 — direct phase-write ratchet. Phase 2 PR-F (BI-45F9CB7A).
// Acceptance AC-SINGLE-TRANSITION: fails when code outside
// lib/build/plan-to-build-transition-core.ts gains a FeatureBuild write that can set
// phase = "build"; passes on main at merge.
import { describe, expect, it } from "vitest";

import {
  countBuildCapableByFile,
  findDirectPhaseWrites,
  KNOWN_DIRECT_BUILD_PHASE_WRITES,
  TRANSITION_MODULE,
} from "./direct-phase-writes";
import { readWebSourceFiles } from "./source-files";

const writes = findDirectPhaseWrites(readWebSourceFiles());
const live = countBuildCapableByFile(writes);
const known = KNOWN_DIRECT_BUILD_PHASE_WRITES;

describe("GPP C-8 direct phase writes — live tree against the shrink-only list", () => {
  it("no new path can write phase \"build\" outside the transition module", () => {
    const grown = Object.entries(live)
      .filter(([path, count]) => count > (known[path]?.count ?? 0))
      .map(([path, count]) => `${path}: ${count} live > ${known[path]?.count ?? 0} listed`);
    expect(grown, "Route plan→build through transitionPlanToBuild instead of writing the phase").toEqual([]);
  });

  it("the list only shrinks: a listed count above the live count must be lowered", () => {
    const stale = Object.entries(known)
      .filter(([path, entry]) => entry.count > (live[path] ?? 0))
      .map(([path, entry]) => `${path}: listed ${entry.count} > ${live[path] ?? 0} live`);
    expect(stale, "A direct write was removed: shrink KNOWN_DIRECT_BUILD_PHASE_WRITES").toEqual([]);
  });

  it("every allowlisted file carries a reason", () => {
    for (const [path, entry] of Object.entries(known)) {
      expect(entry.reason.trim().length, path).toBeGreaterThan(20);
    }
  });

  it("the transition core holds exactly one phase = \"build\" write, and plan-to-build-transition.ts none", () => {
    const own = writes.filter((w) => w.path === TRANSITION_MODULE && (w.target === "build" || w.target === "dynamic"));
    expect(own).toHaveLength(1);
    expect(own[0]!.target).toBe("build");
    expect(writes.filter((w) => w.path === "lib/build/plan-to-build-transition.ts" && (w.target === "build" || w.target === "dynamic"))).toEqual([]);
  });
});

describe("scanner self-test on a synthetic tree", () => {
  const tree = [
    { path: "lib/a.ts", content: 'await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });' },
    { path: "lib/b.ts", content: 'await tx.featureBuild.updateMany({\n  where: { id, phase: "plan" },\n  data: { phase: next, x: 1 },\n});' },
    { path: "lib/c.ts", content: 'await prisma.featureBuild.update({ where: { buildId, phase: "build" }, data: { phase: "review" } });' },
    { path: "lib/d.ts", content: '// prisma.featureBuild.update({ data: { phase: "build" } })\n/* featureBuild.update({ data: { phase: "build" } }) */' },
    { path: "lib/e.test.ts", content: 'prisma.featureBuild.update({ data: { phase: "build" } });' },
    { path: "lib/f.ts", content: 'await prisma.featureBuild.update({ where: { buildId }, data: { ...(failed ? { phase: "build" } : {}) } });' },
    { path: "lib/g.ts", content: 'await prisma.$executeRaw`UPDATE "FeatureBuild" SET "phase" = ${p} WHERE id = ${id}`;' },
    { path: "lib/h.ts", content: 'await prisma.featureBuild.findMany({ where: { phase: "build" } });' },
  ];

  it("finds data-side phase writes only, and classifies their targets", () => {
    expect(findDirectPhaseWrites(tree).map((w) => `${w.path}:${w.line}:${w.target}`)).toEqual([
      "lib/a.ts:1:build",
      "lib/b.ts:1:dynamic",
      "lib/c.ts:1:review",
      "lib/f.ts:1:build",
      "lib/g.ts:1:dynamic",
    ]);
  });

  it("goes red when one extra phase \"build\" write is added", () => {
    const base = countBuildCapableByFile(findDirectPhaseWrites(tree));
    const withExtra = countBuildCapableByFile(
      findDirectPhaseWrites([
        ...tree,
        { path: "lib/c.ts", content: 'await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });' },
      ]),
    );
    const grown = Object.entries(withExtra).filter(([path, count]) => count > (base[path] ?? 0));
    expect(grown).toEqual([["lib/c.ts", 1]]);
  });

  it("ignores writes inside the transition module", () => {
    const counts = countBuildCapableByFile(
      findDirectPhaseWrites([
        { path: TRANSITION_MODULE, content: 'await prisma.featureBuild.update({ where: { buildId }, data: { phase: "build" } });' },
      ]),
    );
    expect(counts).toEqual({});
  });
});
