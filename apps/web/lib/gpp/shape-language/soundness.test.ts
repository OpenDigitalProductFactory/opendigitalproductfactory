// Structural soundness S-1 to S-6 (PR-3b-2, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §6.3, §7.2; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-2).
//
// 1. Every decompiled registry document (current and prior, counted from the
//    registry) has zero soundness findings: a sequential shape is sound by
//    construction (§6.3).
// 2. One seeded violation per rule. Each fixture under __fixtures__/drc/ is a
//    schema-valid document with exactly one violation; expected.json names
//    its rule and element id. The fixtures join PR-3b-3's DRC corpus.
// 3. Further cases: refuse routes, block leaks, and a sound explicit flow with
//    a parallel block and a bounded rework edge, which the interpreter runs to
//    its success stop.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { listWorkShapes, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import type { GppShapeDocument } from "./gpp-shape-schema";
import { markedStageKeys, startShapeInstance, stepShapeInstance } from "./interpreter";
import { parseShapeDocument } from "./parse";
import { checkSoundness } from "./soundness";

const ALL_DEFINITIONS: readonly WorkShapeDefinition[] = [...listWorkShapes(), ...WORK_SHAPE_PRIOR_VERSIONS];
const FIXTURE_DIR = join(__dirname, "__fixtures__", "drc");
const EXPECTED = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf8")) as Record<
  string,
  { rule: string; elementId: string }
>;
const SOUNDNESS_FIXTURES = readdirSync(FIXTURE_DIR)
  .filter((name) => /^s-\d-.*\.gpp\.json$/.test(name))
  .sort();

function loadFixture(name: string): GppShapeDocument {
  const parsed = parseShapeDocument(readFileSync(join(FIXTURE_DIR, name), "utf8"));
  if (!parsed.accepted) throw new Error(`${name} is not schema-valid: ${JSON.stringify(parsed.diagnostics)}`);
  return parsed.document;
}

type Stage = GppShapeDocument["stages"][number];

function stage(key: string, advance: Stage["advance"] = { kind: "status-change", condition: `${key} done` }): Stage {
  return { key, title: key, accountablePrincipalRef: "role:shape-owner", advance, evidence: ["manual-check"] };
}

function documentWith(parts: Partial<GppShapeDocument>): GppShapeDocument {
  return {
    format: "gpp-shape/0.1",
    key: "inline",
    version: "1.0.0",
    title: "Inline",
    description: "Inline soundness case.",
    triggers: ["claim"],
    stages: [stage("a"), stage("b")],
    stopConditions: [
      { kind: "success", condition: "done", disposition: "proceed" },
      { kind: "failure", condition: "failed", disposition: "refused" },
      { kind: "budget", condition: "spent", disposition: "inconclusive" },
    ],
    grants: [],
    measures: [],
    budgets: [],
    reviewPoint: { everyDays: 7, description: "weekly" },
    collaborationShape: null,
    ...parts,
  };
}

const enforcedRefuse = (onRefuse?: string): Stage["advance"] => ({
  kind: "governed-decision",
  condition: "decided",
  decisionScope: "inline-scope",
  gate: {
    authority: "wwmd",
    mode: "enforced",
    blocking: true,
    resolution: "accountable-human",
    ...(onRefuse !== undefined ? { onRefuse } : {}),
  },
});

const rulesOf = (document: GppShapeDocument) => checkSoundness(document).map((finding) => `${finding.rule} ${finding.elementId}`);

describe("every registry shape is sound", () => {
  it("counts the registry from its sources", () => {
    expect(ALL_DEFINITIONS.length).toBe(listWorkShapes().length + WORK_SHAPE_PRIOR_VERSIONS.length);
    expect(ALL_DEFINITIONS.length).toBeGreaterThan(0);
  });

  it.each(ALL_DEFINITIONS.map((definition) => [`${definition.key}@${definition.version}`, definition] as const))(
    "%s has zero soundness findings",
    (_id, definition) => {
      expect(checkSoundness(decompile(definition).document)).toEqual([]);
    },
  );
});

describe("one seeded violation per rule (S-1 to S-6)", () => {
  it("the fixture set covers each of S-1 to S-6 exactly once, and expected.json lists exactly the S fixtures", () => {
    expect(SOUNDNESS_FIXTURES.map((name) => EXPECTED[name]?.rule).sort()).toEqual(["S-1", "S-2", "S-3", "S-4", "S-5", "S-6"]);
    // The rest of the corpus (C, D, E, W fixtures) is PR-3b-3's; drc-corpus.test.ts checks it.
    const soundnessEntries = Object.keys(EXPECTED).filter((name) => EXPECTED[name]?.rule.startsWith("S-"));
    expect(soundnessEntries.sort()).toEqual(SOUNDNESS_FIXTURES);
  });

  it.each(SOUNDNESS_FIXTURES)("%s yields exactly its rule on its element", (name) => {
    const findings = checkSoundness(loadFixture(name));
    const expected = EXPECTED[name] as { rule: string; elementId: string };
    expect(findings.map((finding) => ({ rule: finding.rule, elementId: finding.elementId }))).toEqual([expected]);
    const [finding] = findings;
    expect(finding?.severity).toBe("error");
    expect(finding?.code).toBe(expected.rule);
    expect(finding?.message.length).toBeGreaterThan(0);
  });

  it("findings carry RFC 6901 paths into the document", () => {
    expect(checkSoundness(loadFixture("s-1-unreachable-stage.gpp.json"))[0]?.path).toBe("/stages/2");
    expect(checkSoundness(loadFixture("s-3-unpaired-split.gpp.json"))[0]?.path).toBe("/flow/nodes/0");
    expect(checkSoundness(loadFixture("s-5-unbounded-cycle.gpp.json"))[0]?.path).toBe("/flow/edges/1");
    expect(checkSoundness(loadFixture("s-6-no-budget-stop.gpp.json"))[0]?.path).toBe("/stopConditions");
  });
});

describe("refuse routes and rework (S-5)", () => {
  it("a refuse route to an earlier stage with no bounded rework edge is unbounded", () => {
    const document = documentWith({ stages: [stage("a"), stage("b", enforcedRefuse("a"))] });
    expect(rulesOf(document)).toEqual(["S-5 gate:b"]);
  });

  it("a refuse route to a later stage, or to nothing, is refused", () => {
    expect(rulesOf(documentWith({ stages: [stage("a", enforcedRefuse("b")), stage("b")] }))).toEqual(["S-5 gate:a"]);
    expect(rulesOf(documentWith({ stages: [stage("a"), stage("b", enforcedRefuse("nowhere"))] }))).toEqual(["S-5 gate:b"]);
  });

  it("a refuse route to a stop is sound", () => {
    expect(rulesOf(documentWith({ stages: [stage("a"), stage("b", enforcedRefuse("stop:failure:1"))] }))).toEqual([]);
    expect(rulesOf(documentWith({ stages: [stage("a"), stage("b", enforcedRefuse("failure"))] }))).toEqual([]);
  });

  it("a refuse route bounded by a rework edge is sound; a rework edge that goes forward is not", () => {
    const bounded = documentWith({
      stages: [stage("a"), stage("b", enforcedRefuse("a"))],
      flow: {
        nodes: [],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "success" },
          { from: "b", to: "a", rework: { maxIterations: 2 } },
        ],
      },
    });
    expect(rulesOf(bounded)).toEqual([]);
    const forward = documentWith({
      flow: {
        nodes: [],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "success" },
          { from: "a", to: "b", rework: { maxIterations: 1 } },
        ],
      },
    });
    expect(rulesOf(forward)).toEqual(["S-5 edge:a->b"]);
  });
});

describe("block structure (S-3)", () => {
  const parallel = (extraEdges: Array<{ from: string; to: string }>, edges?: Array<{ from: string; to: string }>) =>
    documentWith({
      stages: [stage("a"), stage("b"), stage("c"), stage("d")],
      flow: {
        nodes: [
          { id: "p", type: "parallel-split" },
          { id: "j", type: "parallel-join", pairs: "p" },
        ],
        edges: [
          ...(edges ?? [
            { from: "a", to: "p" },
            { from: "p", to: "b" },
            { from: "p", to: "c" },
            { from: "b", to: "j" },
            { from: "c", to: "j" },
            { from: "j", to: "d" },
            { from: "d", to: "success" },
          ]),
          ...extraEdges,
        ],
      },
    });

  it("a properly nested parallel block is sound", () => {
    expect(rulesOf(parallel([]))).toEqual([]);
  });

  it("a branch that leaves its block other than through the join is refused", () => {
    const leak = parallel([], [
      { from: "a", to: "p" },
      { from: "p", to: "b" },
      { from: "p", to: "c" },
      { from: "b", to: "j" },
      { from: "c", to: "d" },
      { from: "j", to: "d" },
      { from: "d", to: "success" },
    ]);
    // c → d leaves the block; d then has two ways in, and the join only one.
    expect(rulesOf(leak)).toEqual(["S-3 edge:c->d", "S-3 node:j", "S-3 stage:d"]);
  });

  it("a branch that exits straight to a stop leaves its block", () => {
    const toStop = parallel([], [
      { from: "a", to: "p" },
      { from: "p", to: "b" },
      { from: "p", to: "c" },
      { from: "b", to: "j" },
      { from: "c", to: "j" },
      { from: "b", to: "failure" },
      { from: "j", to: "d" },
      { from: "d", to: "success" },
    ]);
    expect(rulesOf(toStop)).toEqual(["S-3 edge:b->failure", "S-3 stage:b"]);
  });

  it("nested blocks are sound, and a rework edge inside the inner block stays in it", () => {
    const nested = documentWith({
      stages: ["a", "b", "c", "d", "e"].map((key) => stage(key)),
      flow: {
        nodes: [
          { id: "p", type: "parallel-split" },
          { id: "q", type: "parallel-split" },
          { id: "k", type: "parallel-join", pairs: "q" },
          { id: "j", type: "parallel-join", pairs: "p" },
        ],
        edges: [
          { from: "a", to: "p" },
          { from: "p", to: "q" },
          { from: "q", to: "b" },
          { from: "q", to: "c" },
          { from: "b", to: "k" },
          { from: "c", to: "k" },
          { from: "k", to: "j" },
          { from: "p", to: "d" },
          { from: "d", to: "j" },
          { from: "j", to: "e" },
          { from: "e", to: "success" },
          { from: "b", to: "b", rework: { maxIterations: 1 } },
        ],
      },
    });
    expect(rulesOf(nested)).toEqual([]);
    const escaping = { ...nested, flow: { ...nested.flow!, edges: [...nested.flow!.edges, { from: "c", to: "a", rework: { maxIterations: 1 } }] } };
    expect(rulesOf(escaping)).toEqual(["S-5 edge:c->a"]);
  });

  it("an edge naming nothing, and a node id that shadows a stage key, are refused", () => {
    const dangling = documentWith({ flow: { nodes: [], edges: [{ from: "a", to: "b" }, { from: "b", to: "ghost" }] } });
    expect(rulesOf(dangling)).toEqual(["S-3 edge:b->ghost"]);
    const shadow = documentWith({
      flow: { nodes: [{ id: "a", type: "parallel-join", pairs: "a" }], edges: [{ from: "a", to: "b" }, { from: "b", to: "success" }] },
    });
    expect(rulesOf(shadow)).toContain("S-3 node:a");
  });
});

describe("the interpreter runs a sound explicit flow to completion", () => {
  it("parallel block: the join waits for both branches, then the token moves on", () => {
    const document = documentWith({
      stages: [stage("a"), stage("b"), stage("c"), stage("d")],
      flow: {
        nodes: [
          { id: "p", type: "parallel-split" },
          { id: "j", type: "parallel-join", pairs: "p" },
        ],
        edges: [
          { from: "a", to: "p" },
          { from: "p", to: "b" },
          { from: "p", to: "c" },
          { from: "b", to: "j" },
          { from: "c", to: "j" },
          { from: "j", to: "d" },
          { from: "d", to: "success" },
        ],
      },
    });
    expect(checkSoundness(document)).toEqual([]);
    let marking = startShapeInstance(document);
    const receipt = (stageKey: string) => ({ type: "receipt" as const, stageKey, kind: "manual-check" });
    marking = stepShapeInstance(document, marking, receipt("a"));
    expect(markedStageKeys(document, marking)).toEqual(["b", "c"]);
    marking = stepShapeInstance(document, marking, receipt("c"));
    expect(markedStageKeys(document, marking)).toEqual(["b"]);
    expect(marking.tokens).toContainEqual({ node: "node:j", from: "stage:c" });
    marking = stepShapeInstance(document, marking, receipt("b"));
    expect(markedStageKeys(document, marking)).toEqual(["d"]);
    marking = stepShapeInstance(document, marking, receipt("d"));
    expect(marking.stopped).toEqual({ stopId: "stop:success:1", kind: "success", disposition: "proceed" });
    expect(marking.tokens).toEqual([]);
  });
});
