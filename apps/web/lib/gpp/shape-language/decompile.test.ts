// The decompiler and its inverse, the lowering (PR-3a-3, BI-6DA17863).
//
// decompile(definition) writes a registered WorkShapeDefinition as a GPP shape
// document; lowerToDefinition(document) is the object half of emit. Property L1
// (spec §7.4) is checked here on one representative shape per family plus a
// frozen prior version:
//
//   canonicalJson(legacyProjection(lowerToDefinition(decompile(S).document))) === canonicalJson(S)
//
// with equal own-key sets at every object node, because canonical JSON cannot
// tell an absent key from one set to `undefined`. The registry-wide suite over
// all 51 definitions is PR-3a-4.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { getWorkShape, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import { lowerToDefinition } from "./emit";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { gppShapeDocumentSchema, type GppGate } from "./gpp-shape-schema";
import { legacyProjection } from "./legacy";

type JsonObject = Record<string, unknown>;

const WORKED_EXAMPLE_PATH = join(__dirname, "__fixtures__", "inquiry-response-watch.worked-example.gpp.json");

function workedExample(): JsonObject {
  return JSON.parse(readFileSync(WORKED_EXAMPLE_PATH, "utf8")) as JsonObject;
}

function workedExampleGate(): GppGate {
  const stages = workedExample().stages as Array<{ advance: { gate: GppGate } }>;
  return stages[1].advance.gate;
}

/** The worked example with its proposed `gate` block removed. */
function workedExampleWithoutGate(): JsonObject {
  const example = workedExample();
  const stages = example.stages as Array<{ advance: JsonObject }>;
  delete stages[1].advance.gate;
  return example;
}

function shape(key: string): WorkShapeDefinition {
  const definition = getWorkShape(key);
  if (!definition) throw new Error(`no registered shape ${key}`);
  return definition;
}

function prior(key: string, version: string): WorkShapeDefinition {
  const definition = WORK_SHAPE_PRIOR_VERSIONS.find((s) => s.key === key && s.version === version);
  if (!definition) throw new Error(`no prior version ${key}@${version}`);
  return definition;
}

/** One representative per registry family, plus a frozen prior version. */
const REPRESENTATIVES: ReadonlyArray<[family: string, load: () => WorkShapeDefinition]> = [
  ["anchor", () => shape("obligation-assurance-watch")],
  ["standing", () => shape("inquiry-response-watch")],
  ["coworker", () => shape("security-alert-triage-ladder")],
  ["orchestration", () => shape("evaluate-stream-orchestration")],
  ["delivery", () => shape("delivery-medium")],
  ["prior version", () => prior("pull-request-flow-watch", "1.0.0")],
];

/** The first path at which two values differ in their own-key sets, or null. */
function firstOwnKeyDifference(left: unknown, right: unknown, path = "$"): string | null {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path;
    if (left.length !== right.length) return `${path}.length`;
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstOwnKeyDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (left && typeof left === "object" && right && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join("\0") !== rightKeys.join("\0")) {
      return `${path} {${leftKeys.join(",")}} vs {${rightKeys.join(",")}}`;
    }
    for (const key of leftKeys) {
      const difference = firstOwnKeyDifference(
        (left as JsonObject)[key],
        (right as JsonObject)[key],
        `${path}.${key}`,
      );
      if (difference) return difference;
    }
    return null;
  }
  return null;
}

/** The production table with every ratification withdrawn: the state before PR-3b-R. */
const NOTHING_RATIFIED: Readonly<Record<string, GateRatificationEntry>> = Object.fromEntries(
  Object.entries(GATE_RATIFICATION).map(([scope, entry]) => [scope, { status: "proposed", proposed: entry.proposed, basis: entry.basis }]),
);

function ratifiedTable(scope: string, gate: GppGate): Readonly<Record<string, GateRatificationEntry>> {
  return {
    ...GATE_RATIFICATION,
    [scope]: {
      status: "ratified",
      proposed: gate,
      basis: "Test-only ratification; no production entry changes.",
      decisionId: "DI-000000000000",
      ratifiedAt: "2026-10-02",
    },
  };
}

describe("decompile: the §4.5 worked example", () => {
  it("inquiry-response-watch@1.0.0 decompiles to the §4.5 document minus the gate block when no entry is ratified", () => {
    const { document, awaitingRatification } = decompile(shape("inquiry-response-watch"), { ratification: NOTHING_RATIFIED });

    expect(document).toEqual(workedExampleWithoutGate());
    expect(canonicalJson(document)).toBe(canonicalJson(workedExampleWithoutGate()));
    expect(awaitingRatification).toEqual(["send"]);
  });

  it("with a test-only ratified entry for outbound-customer-communication, the gate block appears exactly as §4.5 shows", () => {
    const table = ratifiedTable("outbound-customer-communication", workedExampleGate());
    const { document, awaitingRatification } = decompile(shape("inquiry-response-watch"), { ratification: table });

    expect(document).toEqual(workedExample());
    expect(JSON.stringify(document)).toBe(JSON.stringify(workedExample()));
    expect(awaitingRatification).toEqual([]);
  });

  it("with the production table (PR-3b-R ratified outbound-customer-communication), the gate block is §4.5's minus the escalation left for later ratification", () => {
    const { document, awaitingRatification } = decompile(shape("inquiry-response-watch"));
    const { escalation: _escalation, ...ratifiedGate } = workedExampleGate();

    expect(GATE_RATIFICATION["outbound-customer-communication"]).toMatchObject({ status: "ratified", decisionId: "DI-BEEAF36D0244" });
    const advanceWithoutGate = (workedExampleWithoutGate().stages as Array<{ advance: JsonObject }>)[1].advance;
    expect(document.stages[1].advance).toEqual({ ...advanceWithoutGate, gate: ratifiedGate });
    expect(awaitingRatification).toEqual([]);
  });

  it("emits fields in schema order and never emits flow, binding, deadline or subShape", () => {
    const { document } = decompile(shape("inquiry-response-watch"));

    expect(Object.keys(document)).toEqual([
      "format",
      "key",
      "version",
      "title",
      "description",
      "triggers",
      "stages",
      "stopConditions",
      "grants",
      "measures",
      "budgets",
      "reviewPoint",
      "collaborationShape",
    ]);
    expect(Object.keys(document.stages[0])).toEqual([
      "key",
      "title",
      "accountablePrincipalRef",
      "advance",
      "evidence",
      "tools",
    ]);
    expect(Object.keys(document.stages[1].advance)).toEqual(["kind", "condition", "decisionScope", "gate"]);
  });
});

describe.each(REPRESENTATIVES)("decompile and lower: %s family", (_family, load) => {
  it("the decompiled document validates against the PR-3a-1 schema", () => {
    const result = gppShapeDocumentSchema.safeParse(decompile(load()).document);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });

  it("lower(decompile(S)) equals S under the legacy projection, with equal own-key sets (L1)", () => {
    // legacy(S) is S for a hand-declared shape; a compiled shape (PR-3b-6)
    // carries its ratified gate, which the projection drops on both sides.
    const definition = legacyProjection(load());
    const lowered = lowerToDefinition(decompile(definition).document);

    expect(canonicalJson(legacyProjection(lowered))).toBe(canonicalJson(definition));
    expect(firstOwnKeyDifference(legacyProjection(lowered), definition)).toBeNull();
  });

  it("decompile(lower(D)) equals D for the decompiled document (L2)", () => {
    const { document } = decompile(load());
    expect(canonicalJson(decompile(lowerToDefinition(document)).document)).toBe(canonicalJson(document));
  });

  it("lists every governed stage as awaiting ratification while nothing is ratified", () => {
    const definition = load();
    const governed = definition.stages.filter((s) => s.advance.kind === "governed-decision").map((s) => s.key);
    expect(decompile(definition, { ratification: NOTHING_RATIFIED }).awaitingRatification).toEqual(governed);
  });
});

describe("decompile and lower: field-level contracts", () => {
  // The registry value with no additive field (inquiry-response-watch is a
  // compiled shape since PR-3b-6 and carries its ratified gate).
  const base = legacyProjection(shape("inquiry-response-watch"));

  it("tools absent and tools: [] survive decompile → lower unchanged", () => {
    const withEmpty: WorkShapeDefinition = {
      ...base,
      stages: [{ ...base.stages[0], tools: [] }, base.stages[1]],
    };
    expect(Object.hasOwn(base.stages[1], "tools")).toBe(false);

    const document = decompile(withEmpty).document;
    expect(document.stages[0].tools).toEqual([]);
    expect(Object.hasOwn(document.stages[1], "tools")).toBe(false);

    const lowered = lowerToDefinition(document);
    expect(lowered.stages[0].tools).toEqual([]);
    expect(Object.hasOwn(lowered.stages[1], "tools")).toBe(false);
    expect(firstOwnKeyDifference(legacyProjection(lowered), withEmpty)).toBeNull();
  });

  it("lower(decompile(S)) returns a fresh object; mutating it does not mutate the registry", () => {
    const before = canonicalJson(shape("inquiry-response-watch"));
    const lowered = lowerToDefinition(decompile(shape("inquiry-response-watch")).document) as {
      title: string;
      triggers: string[];
      stages: Array<{ title: string; evidence: string[]; tools?: string[]; advance: { condition: string } }>;
      reviewPoint: { everyDays: number };
      stopConditions: Array<{ condition: string }>;
    };

    lowered.title = "mutated";
    lowered.triggers.push("claim");
    lowered.stages[0].title = "mutated";
    lowered.stages[0].evidence.push("decision-record");
    lowered.stages[0].tools?.push("mutated_tool");
    lowered.stages[1].advance.condition = "mutated";
    lowered.reviewPoint.everyDays = 1;
    lowered.stopConditions[0].condition = "mutated";

    expect(canonicalJson(shape("inquiry-response-watch"))).toBe(before);
  });

  it("the decompiled document shares no object with the ratification table", () => {
    const table = ratifiedTable("outbound-customer-communication", workedExampleGate());
    const { document } = decompile(base, { ratification: table });
    const advance = document.stages[1].advance;
    if (advance.kind !== "governed-decision" || !advance.gate) throw new Error("expected a gate");

    expect(advance.gate).not.toBe(table["outbound-customer-communication"].proposed);
    expect(advance.gate.escalation).not.toBe(table["outbound-customer-communication"].proposed.escalation);
  });

  it("lowering builds the definition in WorkShapeDefinition declaration order and carries a ratified gate", () => {
    const table = ratifiedTable("outbound-customer-communication", workedExampleGate());
    const lowered = lowerToDefinition(decompile(base, { ratification: table }).document);

    expect(Object.keys(lowered)).toEqual([
      "key",
      "version",
      "title",
      "description",
      "triggers",
      "stages",
      "stopConditions",
      "grants",
      "measures",
      "budgets",
      "reviewPoint",
      "collaborationShape",
    ]);
    expect(lowered.stages[1].advance).toEqual({
      kind: "governed-decision",
      condition: base.stages[1].advance.condition,
      decisionScope: "outbound-customer-communication",
      gate: workedExampleGate(),
    });
    // The added gate is the only difference, and the legacy projection removes it.
    expect(canonicalJson(lowered)).not.toBe(canonicalJson(base));
    expect(canonicalJson(legacyProjection(lowered))).toBe(canonicalJson(base));
    expect(firstOwnKeyDifference(legacyProjection(lowered), base)).toBeNull();
  });

  it("lowering carries the other additive fields only when the document declares them", () => {
    const { document } = decompile(base);
    const extended = {
      ...document,
      stages: [
        {
          ...document.stages[0],
          binding: { id: "draft-reply", version: 1, enforcement: "shadow" as const },
          deadline: { afterDays: 2, description: "Raise a deadline event after two days." },
          subShape: "issue-triage-watch@1.0.0",
        },
        document.stages[1],
      ],
      flow: { nodes: [], edges: [{ from: "draft", to: "send" }] },
    };
    expect(gppShapeDocumentSchema.safeParse(extended).success).toBe(true);

    const lowered = lowerToDefinition(extended);
    expect(Object.keys(lowered.stages[0])).toEqual([
      "key",
      "title",
      "accountablePrincipalRef",
      "advance",
      "evidence",
      "tools",
      "binding",
      "deadline",
      "subShape",
    ]);
    expect(Object.keys(lowered.stages[1])).not.toContain("binding");
    expect(lowered.flow).toEqual(extended.flow);
    expect(canonicalJson(legacyProjection(lowered))).toBe(canonicalJson(base));
  });
});

// ── Phase 3c PR-3c-1 (BI-8875C9DF): the graph constructs and a declared refuse
// route are carried, so the registry guard sees what a hand-declared shape says
// (design corrections 5 and 12).
describe("decompile carries the Phase 3c graph constructs when a definition declares them", () => {
  const base = shape("obligation-assurance-watch");
  const governedIndex = base.stages.findIndex((stage) => stage.advance.kind === "governed-decision");
  const governed = base.stages[governedIndex]!;
  const refuseGate = { authority: "wwmd" as const, mode: "enforced" as const, blocking: true, resolution: "accountable-human" as const, onRefuse: "failure" };
  const graph: WorkShapeDefinition = {
    ...base,
    stages: base.stages.map((stage, index) => {
      if (index === 0) return { ...stage, deadline: { afterDays: 3, description: "Three days to sweep." } };
      if (index === 1) return { ...stage, subShape: "obligation-assurance-watch@1.0.0" };
      if (index === governedIndex && stage.advance.kind === "governed-decision") return { ...stage, advance: { ...stage.advance, gate: refuseGate } };
      return stage;
    }),
    flow: {
      nodes: [],
      edges: base.stages.slice(1).map((stage, index) => ({ from: base.stages[index]!.key, to: stage.key })),
    },
  };

  it("emits flow after stages, and each stage's deadline and subShape, in schema order", () => {
    const { document } = decompile(graph, { ratification: NOTHING_RATIFIED });
    expect(Object.keys(document).indexOf("flow")).toBe(Object.keys(document).indexOf("stages") + 1);
    expect(document.flow).toEqual(graph.flow);
    expect(document.stages[0]!.deadline).toEqual({ afterDays: 3, description: "Three days to sweep." });
    expect(document.stages[1]!.subShape).toBe("obligation-assurance-watch@1.0.0");
    expect(gppShapeDocumentSchema.safeParse(document).success).toBe(true);
  });

  it("a declared gate with a refuse route wins over the table, and the stage is still awaiting ratification", () => {
    const { document, awaitingRatification } = decompile(graph, { ratification: NOTHING_RATIFIED });
    const advance = document.stages[governedIndex]!.advance;
    expect(advance.kind === "governed-decision" ? advance.gate : undefined).toEqual(refuseGate);
    expect(awaitingRatification).toContain(governed.key);
  });

  it("a declared gate without a refuse route is not carried: the gate stays the table's", () => {
    const { onRefuse: _onRefuse, ...plainGate } = refuseGate;
    const declared: WorkShapeDefinition = {
      ...base,
      stages: base.stages.map((stage, index) =>
        index === governedIndex && stage.advance.kind === "governed-decision" ? { ...stage, advance: { ...stage.advance, gate: plainGate } } : stage),
    };
    const advance = decompile(declared, { ratification: NOTHING_RATIFIED }).document.stages[governedIndex]!.advance;
    expect(advance.kind === "governed-decision" ? advance.gate : undefined).toBeUndefined();
  });

  // GPP Phase 3c PR-3c-3: a refuse route declared by the stage's single outgoing rework edge is a refuse route too.
  it("a declared gate whose refuse route is the stage's single rework edge is carried", () => {
    const { onRefuse: _onRefuse, ...plainGate } = refuseGate;
    const previous = base.stages[governedIndex - 1]!.key;
    const reworked: WorkShapeDefinition = {
      ...base,
      stages: base.stages.map((stage, index) =>
        index === governedIndex && stage.advance.kind === "governed-decision" ? { ...stage, advance: { ...stage.advance, gate: plainGate } } : stage),
      flow: {
        nodes: [],
        edges: [
          ...base.stages.slice(1).map((stage, index) => ({ from: base.stages[index]!.key, to: stage.key })),
          { from: governed.key, to: previous, rework: { maxIterations: 1 } },
        ],
      },
    };
    const advance = decompile(reworked, { ratification: NOTHING_RATIFIED }).document.stages[governedIndex]!.advance;
    expect(advance.kind === "governed-decision" ? advance.gate : undefined).toEqual(plainGate);
  });

  it("round-trips: lower(decompile(S)) carries every construct, and decompile(lower(D)) equals D (L2)", () => {
    const { document } = decompile(graph, { ratification: NOTHING_RATIFIED });
    const lowered = lowerToDefinition(document);
    expect(lowered.flow).toEqual(graph.flow);
    expect(lowered.stages[0]!.deadline).toEqual(graph.stages[0]!.deadline);
    expect(lowered.stages[1]!.subShape).toBe(graph.stages[1]!.subShape);
    expect(canonicalJson(decompile(lowered, { ratification: NOTHING_RATIFIED }).document)).toBe(canonicalJson(document));
  });

  it("a sequential definition's document has no flow, deadline or subShape key", () => {
    const { document } = decompile(base);
    expect(Object.hasOwn(document, "flow")).toBe(false);
    for (const stage of document.stages) {
      expect(Object.hasOwn(stage, "deadline")).toBe(false);
      expect(Object.hasOwn(stage, "subShape")).toBe(false);
    }
  });
});
