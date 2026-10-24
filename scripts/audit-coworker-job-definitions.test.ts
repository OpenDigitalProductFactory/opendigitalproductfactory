import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { auditAgent } from "./audit-coworker-job-definitions";
import { JOB_DEFINITION_AXES } from "../packages/db/src/coworker-job-definition";

// WHAT THIS GUARDS. The audit's one job is to say, per axis, "has anyone
// answered this yet?" — derived from the grader, never guessed. The failure
// mode to prevent is generosity: an axis marked answered because a plane row
// was merely PRESENT, or because absence was read as fine.

const PLANES_AT_CEILING = {
  identity: { level: 3, ceiling: 3 },
  shape: { level: 2, ceiling: 2 },
  governance: { level: 3, ceiling: 3 },
  cadence: { level: 3, ceiling: 3 },
  toolsAndSkills: { level: 3, ceiling: 3 },
  corpus: { level: 3, ceiling: 3 },
  evidence: { level: 2, ceiling: 2 },
};

function agent(over: Partial<{ planes: Record<string, { level: number; ceiling: number }> }> = {}) {
  return {
    key: "AGT-TEST",
    displayName: "Test Coworker",
    identityClass: "active-roster",
    planes: PLANES_AT_CEILING,
    ...over,
  } as never;
}

const REGISTRY = new Map([
  ["AGT-TEST", { agent_id: "AGT-TEST", escalates_to: "AGT-ORCH-000", value_stream: "operate" }],
]);

describe("an axis is answered only when its plane is AT its ceiling", () => {
  it("reports a fully-graded coworker as complete", () => {
    const row = auditAgent(agent(), REGISTRY as never);
    assert.deepEqual(row.openAxes, []);
  });

  it("marks an axis OPEN when its plane sits below the ceiling", () => {
    const row = auditAgent(
      agent({ planes: { ...PLANES_AT_CEILING, cadence: { level: 0, ceiling: 3 } } }),
      REGISTRY as never,
    );
    assert.deepEqual(row.openAxes, ["cadence"]);
  });

  it("marks an axis OPEN when the plane is missing entirely", () => {
    // Absence of evidence is exactly what this audit looks for; reading a
    // missing row as satisfied would make the whole exercise decorative.
    const planes = { ...PLANES_AT_CEILING } as Record<string, { level: number; ceiling: number }>;
    delete planes.shape;
    const row = auditAgent(agent({ planes }), REGISTRY as never);
    assert.deepEqual(row.openAxes, ["accountabilities"]);
  });
});

describe("the two axes the measure does not grade", () => {
  it("reads supervision from the registry's escalation target", () => {
    const row = auditAgent(
      agent(),
      new Map([["AGT-TEST", { agent_id: "AGT-TEST", value_stream: "operate" }]]) as never,
    );
    assert.deepEqual(row.openAxes, ["supervision"]);
  });

  it("reads tailoring from the registry's value-stream binding", () => {
    const row = auditAgent(
      agent(),
      new Map([["AGT-TEST", { agent_id: "AGT-TEST", escalates_to: "AGT-ORCH-000" }]]) as never,
    );
    assert.deepEqual(row.openAxes, ["tailoring"]);
  });

  it("treats a coworker absent from the registry as open on both", () => {
    const row = auditAgent(agent(), new Map() as never);
    assert.deepEqual(row.openAxes, ["supervision", "tailoring"]);
  });

  it("resolves the registry row through a bridged handle", () => {
    // Canonical identity reconciliation means a coworker answers to more than
    // one id; missing that would report a placed coworker as unplaced.
    const row = auditAgent(
      { ...(agent() as object), key: "AGT-UNKNOWN", handles: ["AGT-TEST"] } as never,
      REGISTRY as never,
    );
    assert.deepEqual(row.openAxes, []);
  });
});

describe("it covers the whole contract", () => {
  it("returns a status for every one of the nine axes", () => {
    const row = auditAgent(agent(), REGISTRY as never);
    assert.deepEqual(Object.keys(row.axes).sort(), [...JOB_DEFINITION_AXES].sort());
  });
});
