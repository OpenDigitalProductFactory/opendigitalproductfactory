// The ratification report builder (PR-3a-3, BI-6DA17863): property R of spec
// §7.4. For each definition it reports every new typed field L1 drops and every
// governed stage, with the status of its decisionScope in GATE_RATIFICATION.
// PR-3b-5 writes it to disk; PR-3a-4 snapshot-tests it over the registry.

import { describe, expect, it } from "vitest";

import { WORK_SHAPE_PRIOR_VERSIONS } from "@/lib/work-management/work-shape-prior-versions";
import { getWorkShape, type WorkShapeDefinition } from "@/lib/work-management/work-shapes";

import { decompile } from "./decompile";
import { lowerToDefinition } from "./emit";
import { GATE_RATIFICATION, type GateRatificationEntry } from "./gate-ratification";
import { legacyDroppedFields } from "./legacy";
import { buildRatificationReport } from "./ratification-report";

function shape(key: string): WorkShapeDefinition {
  const definition = getWorkShape(key);
  if (!definition) throw new Error(`no registered shape ${key}`);
  return definition;
}

const PRIOR_PR_FLOW = WORK_SHAPE_PRIOR_VERSIONS.find(
  (s) => s.key === "pull-request-flow-watch" && s.version === "1.0.0",
) as WorkShapeDefinition;

const GATE = { authority: "wwwd", mode: "enforced", blocking: true, resolution: "accountable-human" } as const;

const RATIFIED_OUTBOUND: Readonly<Record<string, GateRatificationEntry>> = {
  ...GATE_RATIFICATION,
  "outbound-customer-communication": {
    status: "ratified",
    proposed: GATE,
    basis: "Test-only ratification.",
    decisionId: "DI-000000000000",
    ratifiedAt: "2026-10-02",
  },
};

function governedStages(definition: WorkShapeDefinition) {
  return definition.stages
    .filter((s) => s.advance.kind === "governed-decision")
    .map((s) => ({
      shape: `${definition.key}@${definition.version}`,
      stage: s.key,
      decisionScope: s.advance.kind === "governed-decision" ? s.advance.decisionScope : "",
    }));
}

describe("buildRatificationReport", () => {
  it("with nothing ratified, drops no field and lists every governed stage as proposed and awaiting", () => {
    const definitions = [shape("inquiry-response-watch"), shape("obligation-assurance-watch"), PRIOR_PR_FLOW];
    const report = buildRatificationReport(definitions);

    expect(report.dropped).toEqual([]);
    const expected = definitions
      .flatMap(governedStages)
      .map((row) => ({ ...row, status: "proposed" as const }))
      .sort((a, b) => (a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : a.stage < b.stage ? -1 : 1));
    expect(report.governedStages).toEqual(expected);
    expect(report.awaitingRatification).toEqual(expected);
    expect(report.awaitingRatification.length).toBeGreaterThan(0);
  });

  it("with a ratified scope, lists the dropped gate by shape, stage and value, and the stage is no longer awaiting", () => {
    const report = buildRatificationReport([shape("inquiry-response-watch")], RATIFIED_OUTBOUND);

    expect(report.dropped).toEqual([
      { shape: "inquiry-response-watch@1.0.0", stage: "send", field: "advance.gate", value: GATE },
    ]);
    expect(report.governedStages).toEqual([
      {
        shape: "inquiry-response-watch@1.0.0",
        stage: "send",
        decisionScope: "outbound-customer-communication",
        status: "ratified",
      },
    ]);
    expect(report.awaitingRatification).toEqual([]);
  });

  it("reports exactly the fields L1 drops for every input (R)", () => {
    const definitions = [shape("inquiry-response-watch"), shape("delivery-medium"), PRIOR_PR_FLOW];
    const report = buildRatificationReport(definitions, RATIFIED_OUTBOUND);
    const l1Dropped = definitions.flatMap((definition) =>
      legacyDroppedFields(lowerToDefinition(decompile(definition, { ratification: RATIFIED_OUTBOUND }).document)).map(
        (row) => ({ shape: `${definition.key}@${definition.version}`, ...row }),
      ),
    );
    expect(report.dropped).toEqual(expect.arrayContaining(l1Dropped));
    expect(report.dropped).toHaveLength(l1Dropped.length);
  });

  it("marks a governed scope with no table entry as unlisted, and awaiting", () => {
    const base = shape("inquiry-response-watch");
    const [draft, send] = base.stages;
    if (send.advance.kind !== "governed-decision") throw new Error("send must be governed");
    const unlisted: WorkShapeDefinition = {
      ...base,
      stages: [draft, { ...send, advance: { ...send.advance, decisionScope: "scope-with-no-entry" } }],
    };
    const report = buildRatificationReport([unlisted]);
    expect(report.awaitingRatification).toEqual([
      { shape: "inquiry-response-watch@1.0.0", stage: "send", decisionScope: "scope-with-no-entry", status: "unlisted" },
    ]);
  });

  it("sorts by shape, then stage, then field, independent of input order", () => {
    const definitions = [PRIOR_PR_FLOW, shape("inquiry-response-watch"), shape("obligation-assurance-watch")];
    const forward = buildRatificationReport(definitions, RATIFIED_OUTBOUND);
    const reversed = buildRatificationReport([...definitions].reverse(), RATIFIED_OUTBOUND);
    expect(reversed).toEqual(forward);
    const shapes = forward.governedStages.map((row) => row.shape);
    expect(shapes).toEqual([...shapes].sort());
  });

  it("is pure: it does not mutate its inputs or the table", () => {
    const definition = shape("inquiry-response-watch");
    const before = JSON.stringify([definition, RATIFIED_OUTBOUND]);
    buildRatificationReport([definition], RATIFIED_OUTBOUND);
    expect(JSON.stringify([definition, RATIFIED_OUTBOUND])).toBe(before);
  });
});
