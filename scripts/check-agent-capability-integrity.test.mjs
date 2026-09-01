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

/**
 * A baseline whose per-plane maximums match the report exactly. Slack is now a
 * failure in its own right, so a fixture that means "nothing else is wrong"
 * must not carry incidental headroom.
 */
function tightBaselineFor(report, grandfatheredAgentIds) {
  return {
    capabilityCompleteness: {
      planeFloors: floors,
      grandfatheredAgentIds,
      maxOpenGapsByPlane: Object.fromEntries(
        Object.keys(floors).map((plane) => [
          plane,
          report.agents.filter((a) => Number(a.planes[plane].level) < Number(a.planes[plane].ceiling)).length,
        ]),
      ),
    },
  };
}

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

  assert.deepEqual(
    findCompletenessRatchetFailures(report, tightBaselineFor(report, ["legacy-agent"])),
    [],
  );
});

test("preserves grandfathering when an existing slug is canonically re-keyed", () => {
  const report = {
    agents: [
      agent("AGT-WS-LEGACY", { identity: 2 }, ["legacy-agent"]),
    ],
  };

  assert.deepEqual(
    findCompletenessRatchetFailures(report, tightBaselineFor(report, ["legacy-agent"])),
    [],
  );
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

test("rejects unclaimed slack — a closed gap must be locked in, not left reopenable", () => {
  // The baseline permits one open identity gap; the report has none. Left
  // unclaimed, that headroom is exactly what lets the gap reopen later while
  // this gate stays green.
  const report = {
    agents: [
      agent("legacy-agent", {}),
    ],
  };

  const failures = findCompletenessRatchetFailures(report, baseline);

  assert.ok(
    failures.some((failure) => failure.includes("identity") && failure.includes("still allows")),
    `expected an identity slack failure, got: ${JSON.stringify(failures)}`,
  );
  assert.ok(
    failures.some((failure) => failure.includes("--update")),
    "the failure must name the command that locks the closure in",
  );
});

test("rejects a grandfathered agent that has since reached every floor", () => {
  // `legacy-agent` is exempt from the floor loop. Once it meets every floor the
  // exemption is unearned, and leaving it listed means a later regression is
  // skipped rather than caught.
  const report = {
    agents: [
      agent("legacy-agent", {}),
      agent("filler-1", { identity: 2 }, ["filler-1"]),
    ],
  };
  const withRoom = {
    capabilityCompleteness: {
      ...baseline.capabilityCompleteness,
      grandfatheredAgentIds: ["legacy-agent", "filler-1"],
    },
  };

  const failures = findCompletenessRatchetFailures(report, withRoom);

  assert.ok(
    failures.some((failure) => failure.includes("legacy-agent") && failure.includes("still grandfathered")),
    `expected a stale-grandfather failure, got: ${JSON.stringify(failures)}`,
  );
  assert.ok(
    !failures.some((failure) => failure.includes("filler-1") && failure.includes("still grandfathered")),
    "an agent still below a floor keeps its exemption",
  );
});

test("a baseline exactly matching reality passes — the ratchet is silent when tight", () => {
  const tight = {
    capabilityCompleteness: {
      planeFloors: floors,
      grandfatheredAgentIds: ["legacy-agent"],
      maxOpenGapsByPlane: Object.fromEntries(Object.keys(floors).map((plane) => [plane, 0])),
    },
  };
  const report = { agents: [agent("legacy-agent", {})] };

  // legacy-agent meets every floor here, so the stale-grandfather rule fires;
  // that is the only complaint, and no plane reports slack.
  const failures = findCompletenessRatchetFailures(report, tight);

  assert.ok(!failures.some((failure) => failure.includes("still allows")));
});
