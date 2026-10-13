// The legacy projection L1 compares under (PR-3a-3, BI-6DA17863). It drops
// exactly the five fields spec §4.4 adds and never an existing one, so
// "equal under the legacy projection" cannot hide a lost field.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "@dpf/integration-shared/canonical-json";
import { describe, expect, it } from "vitest";

import type { WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { legacyDroppedFields, legacyProjection } from "./legacy";

/**
 * inquiry-response-watch@1.0.0 as it was hand-declared, with no additive field
 * (the pinned pre-migration fixture; the registry now holds the compiled
 * definition, which carries its ratified gate).
 */
function inquiry(): WorkShapeDefinition {
  const fixture = join(__dirname, "../../work-management/__fixtures__/inquiry-response-watch@1.0.0.pre-migration.json");
  return JSON.parse(readFileSync(fixture, "utf8")) as WorkShapeDefinition;
}

const GATE = { authority: "wwwd", mode: "enforced", blocking: true, resolution: "accountable-human" } as const;

/** inquiry-response-watch carrying every §4.4 additive field. */
function extended(): WorkShapeDefinition {
  const base = inquiry();
  const [draft, send] = base.stages;
  if (send.advance.kind !== "governed-decision") throw new Error("send must be governed");
  return {
    ...base,
    stages: [
      {
        ...draft,
        binding: { id: "draft-reply", version: 1, enforcement: "shadow" },
        deadline: { afterDays: 2, description: "Two days." },
        subShape: "issue-triage-watch@1.0.0",
      },
      { ...send, advance: { ...send.advance, gate: GATE } },
    ],
    flow: { nodes: [], edges: [{ from: "draft", to: "send" }] },
  } as unknown as WorkShapeDefinition;
}

describe("legacyProjection", () => {
  it("is the identity, under canonical JSON and key sets, on a definition with no additive field", () => {
    const base = inquiry();
    const projected = legacyProjection(base);
    expect(canonicalJson(projected)).toBe(canonicalJson(base));
    expect(Object.keys(projected)).toEqual(Object.keys(base));
    expect(projected.stages.map((s) => Object.keys(s))).toEqual(base.stages.map((s) => Object.keys(s)));
  });

  it("drops advance.gate, stage binding/deadline/subShape and flow, and nothing else", () => {
    const projected = legacyProjection(extended());
    expect(canonicalJson(projected)).toBe(canonicalJson(inquiry()));
    expect(Object.keys(projected)).toEqual(Object.keys(inquiry()));
    expect(Object.keys(projected.stages[0])).toEqual(Object.keys(inquiry().stages[0]));
    expect(Object.keys(projected.stages[1].advance)).toEqual(["kind", "condition", "decisionScope"]);
  });

  it("never drops an existing field, even one it does not know", () => {
    const base = inquiry();
    const withUnknown = {
      ...base,
      futureField: 1,
      stages: [{ ...base.stages[0], futureStageField: 2 }, base.stages[1]],
    } as unknown as WorkShapeDefinition;
    const projected = legacyProjection(withUnknown) as unknown as Record<string, unknown> & {
      stages: Array<Record<string, unknown>>;
    };
    expect(projected.futureField).toBe(1);
    expect(projected.stages[0].futureStageField).toBe(2);
  });

  it("does not mutate its input", () => {
    const input = extended();
    const before = canonicalJson(input);
    legacyProjection(input);
    expect(canonicalJson(input)).toBe(before);
  });
});

describe("legacyDroppedFields", () => {
  it("lists nothing for a definition with no additive field", () => {
    expect(legacyDroppedFields(inquiry())).toEqual([]);
  });

  it("lists every field the projection drops, with its stage and value, in document order", () => {
    const definition = extended();
    expect(legacyDroppedFields(definition)).toEqual([
      { stage: null, field: "flow", value: { nodes: [], edges: [{ from: "draft", to: "send" }] } },
      { stage: "draft", field: "binding", value: { id: "draft-reply", version: 1, enforcement: "shadow" } },
      { stage: "draft", field: "deadline", value: { afterDays: 2, description: "Two days." } },
      { stage: "draft", field: "subShape", value: "issue-triage-watch@1.0.0" },
      { stage: "send", field: "advance.gate", value: GATE },
    ]);
  });
});
