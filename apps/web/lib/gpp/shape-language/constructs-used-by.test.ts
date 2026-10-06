// constructsUsedBy: the one walk the DRC and the drive share (BI-8875C9DF,
// GPP Phase 3c PR-3c-1). Design: docs/superpowers/specs/
// 2026-10-02-gpp-phase-3c-drive-graph-execution-design.md §7.1; plan:
// docs/superpowers/plans/2026-10-02-gpp-phase-3c-drive-graph-execution.md
// (PR-3c-1).
//
// 1. Over each AC-NOT-EXECUTABLE fixture (and the parallel one, a passing
//    document since PR-3c-2), with every graph construct switched off, the
//    walk over the lowered document names exactly the constructs and elements
//    the DRC refuses, so the two readers of the walk cannot disagree.
// 2. A plain flow edge, a lone join and a paired join are walked as the DRC
//    walked them before the refactor.
// 3. No registry definition uses a gated construct.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, readWorkShapeDefinitionContract } from "@/lib/work-management/work-shapes";

import { constructsUsedBy } from "./constructs-used-by";
import { runDesignRules } from "./drc";
import { CONSTRUCT_EXECUTABLE } from "./executable-constructs";
import { lowerToDefinition } from "./emit";
import type { GateRatificationEntry } from "./gate-ratification";
import { parseShapeDocument } from "./parse";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources } from "./resolve-sources";

const FIXTURE_DIR = join(__dirname, "__fixtures__", "drc");
const RATIFICATION = JSON.parse(readFileSync(join(FIXTURE_DIR, "ratification.json"), "utf8")) as Record<string, GateRatificationEntry>;
const FIXTURES = [
  "pass-parallel-split-join.gpp.json",
  "e-not-executable-rework-edge.gpp.json",
  "e-not-executable-stage-deadline.gpp.json",
  "e-not-executable-sub-shape.gpp.json",
  "e-not-executable-refuse-edge.gpp.json",
];

const GRAPH_CONSTRUCTS_OFF = {
  ...CONSTRUCT_EXECUTABLE,
  "parallel-split-join": false,
  "rework-edge": false,
  "stage-deadline": false,
  "sub-shape": false,
};

let sources: GppResolveSources;
beforeAll(() => {
  sources = defaultResolveSources();
}, 120_000);

function load(file: string) {
  const parsed = parseShapeDocument(readFileSync(join(FIXTURE_DIR, file), "utf8"));
  if (!parsed.accepted) throw new Error(`${file} is not schema-valid`);
  return parsed.document;
}

describe("constructsUsedBy agrees with the DRC's E-NOT-EXECUTABLE findings", () => {
  it.each(FIXTURES)("%s", async (file) => {
    const document = load(file);
    // Every graph construct switched off (test-only), so the walk is compared for each fixture whatever the live
    // flags say: parallel split/join is executable since PR-3c-2, and its fixture is a passing document now.
    const findings = runDesignRules(document, await resolveShapeDocument(document, sources), { ratification: RATIFICATION, directSites: new Map(), executable: GRAPH_CONSTRUCTS_OFF });
    const refused = findings
      .filter((finding) => finding.rule === "E-NOT-EXECUTABLE")
      .map((finding) => `${finding.code}@${finding.elementId}${finding.path}`)
      .sort();
    const walked = constructsUsedBy(lowerToDefinition(document))
      .map((use) => `E-NOT-EXECUTABLE/${use.construct}@${use.elementId}/${use.path.join("/")}`)
      .sort();
    expect(walked).toEqual(refused);
    expect(walked.length).toBeGreaterThan(0);
  });
});

describe("constructsUsedBy walks exactly the gated elements", () => {
  const stage = (key: string) => ({
    key,
    title: key,
    accountablePrincipalRef: "agent:a",
    advance: { kind: "status-change" as const, condition: "done" },
    evidence: [] as const,
  });

  it("a plain flow edge uses no gated construct", () => {
    expect(constructsUsedBy({ stages: [stage("a"), stage("b")], flow: { nodes: [], edges: [{ from: "a", to: "b" }] } })).toEqual([]);
  });

  it("a paired join is not reported again; a lone join is", () => {
    const uses = constructsUsedBy({
      stages: [stage("a")],
      flow: {
        nodes: [
          { id: "p", type: "parallel-split" },
          { id: "j", type: "parallel-join", pairs: "p" },
          { id: "lone", type: "parallel-join", pairs: "missing" },
        ],
        edges: [],
      },
    });
    expect(uses.map((use) => use.elementId)).toEqual(["node:p", "node:lone"]);
    expect(uses.every((use) => use.construct === "parallel-split-join")).toBe(true);
  });

  it("names the gate, the stage and the edge, with their paths", () => {
    const uses = constructsUsedBy({
      stages: [
        {
          ...stage("a"),
          advance: {
            kind: "governed-decision",
            condition: "decided",
            decisionScope: "scope",
            gate: { authority: "wwmd", mode: "enforced", blocking: true, resolution: "accountable-human", onRefuse: "failure" },
          },
          deadline: { afterDays: 2, description: "two days" },
          subShape: "child@1.0.0",
        },
        stage("b"),
      ],
      flow: { nodes: [], edges: [{ from: "b", to: "a", rework: { maxIterations: 2 } }] },
    });
    expect(uses.map((use) => [use.construct, use.elementId, use.path.join("/")])).toEqual([
      ["rework-edge", "gate:a", "stages/0/advance/gate/onRefuse"],
      ["stage-deadline", "stage:a", "stages/0/deadline"],
      ["sub-shape", "stage:a", "stages/0/subShape"],
      ["rework-edge", "edge:b->a", "flow/edges/0/rework"],
    ]);
  });
});

describe("no registry definition uses a gated construct", () => {
  it("constructsUsedBy is empty for every current and prior definition", () => {
    const definitions = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
    expect(definitions.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    for (const definition of definitions) {
      expect(constructsUsedBy(readWorkShapeDefinitionContract(definition)), `${definition.key}@${definition.version}`).toEqual([]);
    }
  });
});
