// The registry guard for hand-declared graph shapes (BI-8875C9DF, GPP Phase 3c
// PR-3c-1). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §7.2; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1, work-shape-graph-constructs.test.ts). AC-3C-FAILCLOSED, registry
// half.
//
// A TypeScript shape could declare a flow, a deadline, a sub-shape or a refuse
// route without ever passing the compiler. This guard holds such a shape to the
// compiler's rules: every registry definition that uses a graph construct is
// decompiled (which carries those fields since PR-3c-1), and must
// - pass checkSoundness with no finding,
// - pass the full runDesignRules with defaultResolveSources() with no
//   error-severity finding (C-1…C-9, D-1…D-8, and D-9/D-10 once PR-3c-5 adds
//   them, S-1…S-6 and E-NOT-EXECUTABLE), and
// - be listed on KNOWN_GRAPH_SHAPES, naming the backlog item that consumes it.
//
// KNOWN_GRAPH_SHAPES is shrink-only and EMPTY at merge: no shape is registered
// by Phase 3c (plan constraint 7). A consuming PR adds its own entry (R2D,
// BI-580A970A, is the first). An entry that names no registry graph shape fails,
// so a stale entry cannot linger.

import { beforeAll, describe, expect, it } from "vitest";

import { decompile } from "@/lib/gpp/shape-language/decompile";
import { runDesignRules } from "@/lib/gpp/shape-language/drc";
import { CONSTRUCT_EXECUTABLE, type GppConstruct } from "@/lib/gpp/shape-language/executable-constructs";
import { resolveShapeDocument, type GppResolveSources } from "@/lib/gpp/shape-language/resolve";
import { defaultResolveSources } from "@/lib/gpp/shape-language/resolve-sources";
import { checkSoundness } from "@/lib/gpp/shape-language/soundness";

import { DEADLINE_FIXTURE, PARALLEL_FIXTURE } from "./__fixtures__/graph-shape-fixtures";
import { usesGraphConstructs } from "./drive-marking";
import { WORK_SHAPE_PRIOR_VERSIONS } from "./work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "./work-shapes";

/** Registry graph shapes allowed to exist, each with the backlog item that consumes it. Shrink-only; empty at merge. */
const KNOWN_GRAPH_SHAPES: ReadonlyArray<{ ref: string; backlogItem: string }> = [];

const ref = (definition: WorkShapeDefinition) => `${definition.key}@${definition.version}`;

let sources: GppResolveSources;
beforeAll(() => {
  sources = defaultResolveSources();
}, 120_000);

/** Every reason a definition fails the guard; empty when it passes. */
async function guardProblems(
  definitions: readonly WorkShapeDefinition[],
  options: { allowList?: ReadonlyArray<{ ref: string; backlogItem: string }>; executable?: Readonly<Record<GppConstruct, boolean>> } = {},
): Promise<string[]> {
  const allowList = options.allowList ?? KNOWN_GRAPH_SHAPES;
  const problems: string[] = [];
  for (const definition of definitions) {
    if (!usesGraphConstructs(definition)) continue;
    const id = ref(definition);
    if (!allowList.some((entry) => entry.ref === id)) problems.push(`${id}: not on KNOWN_GRAPH_SHAPES`);
    const { document } = decompile(definition);
    for (const finding of checkSoundness(document)) problems.push(`${id}: ${finding.rule} ${finding.elementId}`);
    const findings = runDesignRules(document, await resolveShapeDocument(document, sources), {
      directSites: new Map(),
      ...(options.executable ? { executable: options.executable } : {}),
    });
    for (const finding of findings) {
      if (finding.severity === "error") problems.push(`${id}: ${finding.code} ${finding.elementId}`);
    }
  }
  return [...new Set(problems)];
}

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];

describe("the registry guard for graph shapes (AC-3C-FAILCLOSED, registry half)", () => {
  it("every registry graph shape is sound, passes the full DRC and is on the allow list", async () => {
    expect(ALL_DEFINITIONS.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(await guardProblems(ALL_DEFINITIONS)).toEqual([]);
  }, 120_000);

  it("the allow list names only registry graph shapes, each with a backlog item", () => {
    const graphRefs = new Set(ALL_DEFINITIONS.filter(usesGraphConstructs).map(ref));
    for (const entry of KNOWN_GRAPH_SHAPES) {
      expect(graphRefs.has(entry.ref), entry.ref).toBe(true);
      expect(entry.backlogItem).toMatch(/^BI-[0-9A-F]{8}$/);
    }
  });

  it("is empty at merge: Phase 3c registers no shape", () => {
    expect(KNOWN_GRAPH_SHAPES).toEqual([]);
    expect(ALL_DEFINITIONS.filter(usesGraphConstructs).map(ref)).toEqual([]);
  });
});

describe("the guard refuses a graph shape injected into the registry", () => {
  /** A real registry shape with no error finding, given a flow that says exactly its sequence. */
  async function cleanFlowShape(): Promise<WorkShapeDefinition> {
    for (const definition of listWorkShapes()) {
      const { document, awaitingRatification } = decompile(definition);
      if (awaitingRatification.length > 0) continue;
      const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { directSites: new Map() });
      if (findings.some((finding) => finding.severity === "error")) continue;
      const keys = definition.stages.map((stage) => stage.key);
      return {
        ...definition,
        key: `${definition.key}-graph`,
        flow: { nodes: [], edges: [...keys.slice(1).map((key, index) => ({ from: keys[index]!, to: key })), { from: keys.at(-1)!, to: "success" }] },
      };
    }
    throw new Error("no registry shape passes the DRC cleanly, so the positive control cannot be built");
  }

  it("a sound, executable graph shape passes only once it is on the allow list (the positive control)", async () => {
    const shape = await cleanFlowShape();
    expect(await guardProblems([shape], { allowList: [] })).toEqual([`${ref(shape)}: not on KNOWN_GRAPH_SHAPES`]);
    expect(await guardProblems([shape], { allowList: [{ ref: ref(shape), backlogItem: "BI-8875C9DF" }] })).toEqual([]);
  }, 120_000);

  it("a shape using a construct whose flag is off is refused with E-NOT-EXECUTABLE, even when allow-listed", async () => {
    const shape = await cleanFlowShape();
    const withDeadline: WorkShapeDefinition = {
      ...shape,
      stages: shape.stages.map((stage, index) => (index === 0 ? { ...stage, deadline: { afterDays: 1, description: "One day." } } : stage)),
    };
    const allowList = [{ ref: ref(shape), backlogItem: "BI-8875C9DF" }];
    expect(CONSTRUCT_EXECUTABLE["stage-deadline"]).toBe(false);
    expect(await guardProblems([withDeadline], { allowList })).toEqual([`${ref(shape)}: E-NOT-EXECUTABLE/stage-deadline stage:${shape.stages[0]!.key}`]);
    // The flag is the only switch: with it on (test-only), the same shape passes.
    expect(await guardProblems([withDeadline], { allowList, executable: { ...CONSTRUCT_EXECUTABLE, "stage-deadline": true } })).toEqual([]);
  }, 120_000);

  it("an unsound shape is refused even with every flag on and allow-listed", async () => {
    const shape = await cleanFlowShape();
    const keys = shape.stages.map((stage) => stage.key);
    // The flow never routes a token to the last stage: S-4 (no dead stage).
    const unsound: WorkShapeDefinition = {
      ...shape,
      flow: { nodes: [], edges: [...keys.slice(1, -1).map((key, index) => ({ from: keys[index]!, to: key })), { from: keys.at(-2) ?? keys[0]!, to: "success" }] },
    };
    const allOn = Object.fromEntries(Object.keys(CONSTRUCT_EXECUTABLE).map((key) => [key, true])) as Record<GppConstruct, boolean>;
    const problems = await guardProblems([unsound], { allowList: [{ ref: ref(unsound), backlogItem: "BI-8875C9DF" }], executable: allOn });
    expect(problems.some((problem) => / S-\d /.test(problem))).toBe(true);
  }, 120_000);

  it("the Phase 3c fixtures (unknown agent, flags off, not listed) are refused", async () => {
    const problems = await guardProblems([PARALLEL_FIXTURE, DEADLINE_FIXTURE]);
    expect(problems).toContain(`${ref(PARALLEL_FIXTURE)}: not on KNOWN_GRAPH_SHAPES`);
    // Parallel split/join is executable since PR-3c-2: the parallel fixture is refused for the allow list
    // (and its unknown agent), never for E-NOT-EXECUTABLE. The deadline flag is still off.
    expect(problems).not.toContain(`${ref(PARALLEL_FIXTURE)}: E-NOT-EXECUTABLE/parallel-split-join node:p`);
    expect(problems).toContain(`${ref(DEADLINE_FIXTURE)}: E-NOT-EXECUTABLE/stage-deadline stage:b`);
  }, 120_000);
});
