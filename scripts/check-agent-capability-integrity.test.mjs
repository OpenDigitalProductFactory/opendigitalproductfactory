import test from "node:test";
import assert from "node:assert/strict";

import { findCompletenessRatchetFailures } from "./check-agent-capability-integrity.mjs";

const floors = {
  identity: 3,
  corpus: 3,
  governance: 3,
  shape: 2,
  cadence: 3,
  toolsAndSkills: 3,
  evidence: 2,
};

function agent(key, levels, handles = [key]) {
  return {
    key,
    handles,
    planes: Object.fromEntries(
      Object.entries(floors).map(([plane, ceiling]) => [
        plane,
        { level: levels[plane] ?? ceiling, ceiling },
      ]),
    ),
  };
}

const baseline = {
  capabilityCompleteness: {
    planeFloors: floors,
    grandfatheredAgentIds: ["legacy-agent"],
    maxOpenGapsByPlane: {
      ...Object.fromEntries(Object.keys(floors).map((plane) => [plane, 1])),
      corpus: 0,
    },
  },
};

test("rejects a new agent below any declared plane floor", () => {
  const report = {
    agents: [
      agent("legacy-agent", { identity: 2 }),
      agent("new-agent", { cadence: 0 }),
    ],
  };

  const failures = findCompletenessRatchetFailures(report, baseline);

  assert.ok(failures.some((failure) => failure.includes("new-agent") && failure.includes("cadence")));
});

test("accepts a new agent that meets every plane floor", () => {
  const report = {
    agents: [
      agent("legacy-agent", { identity: 2 }),
      agent("complete-new-agent", {}),
    ],
  };

  assert.deepEqual(findCompletenessRatchetFailures(report, baseline), []);
});

test("preserves grandfathering when an existing slug is canonically re-keyed", () => {
  const report = {
    agents: [
      agent("AGT-WS-LEGACY", { identity: 2 }, ["legacy-agent"]),
    ],
  };

  assert.deepEqual(findCompletenessRatchetFailures(report, baseline), []);
});

test("rejects aggregate plane-gap growth even for grandfathered identities", () => {
  const report = {
    agents: [
      agent("legacy-agent", { identity: 2, corpus: 2 }),
    ],
  };

  const failures = findCompletenessRatchetFailures(report, baseline);

  assert.ok(failures.some((failure) => failure.includes("corpus") && failure.includes("grew")));
});
