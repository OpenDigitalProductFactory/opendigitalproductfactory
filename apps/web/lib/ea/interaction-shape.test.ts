import { describe, expect, it } from "vitest";

import {
  INTERACTION_STEP_ROLES,
  isDelegationNode,
  isInteractionStepRole,
  measureInteractionFlowLoad,
  type InteractionShapeNode,
} from "./interaction-shape";

describe("interaction shape step-role contract", () => {
  it("keeps delegate in the closed step-role set", () => {
    expect(INTERACTION_STEP_ROLES).toEqual([
      "entry",
      "progress",
      "decide",
      "delegate",
      "complete",
      "reference",
    ]);
    expect(isInteractionStepRole("delegate")).toBe(true);
    expect(isInteractionStepRole("delegated")).toBe(false);
  });

  it("identifies delegation nodes as their own role", () => {
    expect(isDelegationNode({ stepRole: "delegate" })).toBe(true);
    expect(isDelegationNode({ stepRole: "progress" })).toBe(false);
  });
});

describe("measureInteractionFlowLoad", () => {
  it("stops the human traversal at a delegate node", () => {
    const nodes: InteractionShapeNode[] = [
      {
        key: "entry",
        label: "Marketing",
        jobLane: "owner-marketing",
        stepRole: "entry",
        continuesTo: ["draft"],
      },
      {
        key: "draft",
        label: "Draft campaign",
        jobLane: "owner-marketing",
        stepRole: "progress",
        continuesTo: ["handoff"],
      },
      {
        key: "handoff",
        label: "Ask marketing coworker",
        jobLane: "owner-marketing",
        stepRole: "delegate",
        continuesTo: ["coworker-marketing"],
      },
      {
        key: "coworker-marketing",
        label: "Marketing coworker lane",
        jobLane: "coworker-marketing",
        stepRole: "complete",
      },
    ];

    expect(measureInteractionFlowLoad(nodes, "entry")).toEqual({
      entryKey: "entry",
      jobLane: "owner-marketing",
      terminalRole: "delegate",
      stepsToOutcome: 3,
      traversedNodeKeys: ["entry", "draft", "handoff"],
      delegatedTo: ["coworker-marketing"],
      deadEndNodeKeys: [],
      missingContinuationKeys: [],
    });
  });

  it("counts a normal complete path without changing existing semantics", () => {
    const nodes: InteractionShapeNode[] = [
      { key: "entry", label: "Start", jobLane: "owner", stepRole: "entry", continuesTo: ["finish"] },
      { key: "finish", label: "Done", jobLane: "owner", stepRole: "complete" },
    ];

    expect(measureInteractionFlowLoad(nodes, "entry")).toMatchObject({
      terminalRole: "complete",
      stepsToOutcome: 2,
      traversedNodeKeys: ["entry", "finish"],
      delegatedTo: [],
    });
  });

  it("reports progress and decision nodes without continuations as dead ends", () => {
    const nodes: InteractionShapeNode[] = [
      { key: "entry", label: "Start", jobLane: "owner", stepRole: "entry", continuesTo: ["decide"] },
      { key: "decide", label: "Choose", jobLane: "owner", stepRole: "decide" },
    ];

    expect(measureInteractionFlowLoad(nodes, "entry")).toMatchObject({
      terminalRole: "dead-end",
      stepsToOutcome: null,
      deadEndNodeKeys: ["decide"],
    });
  });

  it("returns a stable missing-entry result for callers that reference a stale node", () => {
    expect(measureInteractionFlowLoad([], "missing")).toEqual({
      entryKey: "missing",
      jobLane: null,
      terminalRole: "missing-entry",
      stepsToOutcome: null,
      traversedNodeKeys: [],
      delegatedTo: [],
      deadEndNodeKeys: [],
      missingContinuationKeys: ["missing"],
    });
  });
});
