import { describe, expect, it } from "vitest";
import {
  evaluateJourneyOracles,
  journeyPassed,
  type JourneyExecutionEvidence,
} from "./certification-oracles";

function evidence(overrides: Partial<JourneyExecutionEvidence>): JourneyExecutionEvidence {
  return {
    content: "I used query_backlog and found 12 open items; one is 'Fix login'.",
    executedTools: [{ name: "query_backlog", success: true }],
    offeredToolNames: ["query_backlog", "get_registry_entry"],
    downgraded: false,
    ...overrides,
  };
}

function byId(verdicts: ReturnType<typeof evaluateJourneyOracles>, id: string) {
  return verdicts.find((v) => v.oracleId === id);
}

describe("certification oracles (EP-COWORKER-LIFECYCLE Phase 2)", () => {
  it("passes a healthy run on all oracles", () => {
    const verdicts = evaluateJourneyOracles(evidence({}));
    expect(journeyPassed(verdicts)).toBe(true);
    expect(verdicts.map((v) => v.oracleId).sort()).toEqual([
      "ORACLE-FABRICATE",
      "ORACLE-PURITY",
      "ORACLE-REFUSAL",
      "ORACLE-SURFACE",
      "ORACLE-TOOL",
    ]);
  });

  it("ORACLE-TOOL fails when no successful tool call happened", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({ executedTools: [{ name: "query_backlog", success: false }] }),
    );
    expect(byId(verdicts, "ORACLE-TOOL")?.passed).toBe(false);
    expect(journeyPassed(verdicts)).toBe(false);
  });

  it("ORACLE-SURFACE fails when the coworker had no read-only tools at all", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({ offeredToolNames: [], executedTools: [] }),
    );
    expect(byId(verdicts, "ORACLE-SURFACE")?.passed).toBe(false);
  });

  it("ORACLE-PURITY fails when an executed tool was outside the offered surface", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({
        executedTools: [
          { name: "query_backlog", success: true },
          { name: "delete_everything", success: true },
        ],
      }),
    );
    expect(byId(verdicts, "ORACLE-PURITY")?.passed).toBe(false);
  });

  it("ORACLE-FABRICATE fails a completion claim with zero tool calls", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({
        content: "Done! I've saved the campaign brief and updated the records.",
        executedTools: [],
      }),
    );
    expect(byId(verdicts, "ORACLE-FABRICATE")?.passed).toBe(false);
  });

  it("ORACLE-REFUSAL fails when the reply denies having a delivered tool", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({
        content: "I can't do that — query_backlog is not available in my tool list here.",
        executedTools: [],
      }),
    );
    expect(byId(verdicts, "ORACLE-REFUSAL")?.passed).toBe(false);
  });

  it("downgraded runs skip prose oracles but still require a tool call", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({ downgraded: true, executedTools: [] }),
    );
    expect(byId(verdicts, "ORACLE-FABRICATE")).toBeUndefined();
    expect(byId(verdicts, "ORACLE-REFUSAL")).toBeUndefined();
    expect(byId(verdicts, "ORACLE-TOOL")?.passed).toBe(false);
  });

  it("an execution error short-circuits to a single failed verdict", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({ executionError: "provider unavailable" }),
    );
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].oracleId).toBe("ORACLE-TOOL");
    expect(verdicts[0].passed).toBe(false);
    expect(journeyPassed(verdicts)).toBe(false);
  });
});
