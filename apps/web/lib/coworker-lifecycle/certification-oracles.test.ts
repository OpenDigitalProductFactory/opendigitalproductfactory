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

  it("ORACLE-PURITY passes a non-offered tool classified grant-authorized-read-only (BI-68BBF206)", () => {
    // Native-mcp exposes the coworker's full grant-derived read-only toolset —
    // wider than the attachment list. A governed, authorized, side-effect-free
    // call is inside the authorization envelope even though it was not offered.
    const verdicts = evaluateJourneyOracles(
      evidence({
        executedTools: [
          { name: "query_backlog", success: true },
          { name: "list_my_backlog", success: true, authorization: "grant-authorized-read-only" },
        ],
      }),
    );
    expect(byId(verdicts, "ORACLE-PURITY")?.passed).toBe(true);
  });

  it("ORACLE-PURITY names WHY each tool sits outside the authorization envelope", () => {
    const verdicts = evaluateJourneyOracles(
      evidence({
        executedTools: [
          { name: "update_backlog_item_status", success: true, authorization: "side-effecting" },
          { name: "get_my_coworker_profile", success: true, authorization: "unauthorized" },
          { name: "mystery_tool", success: true, authorization: "unknown" },
        ],
      }),
    );
    const purity = byId(verdicts, "ORACLE-PURITY");
    expect(purity?.passed).toBe(false);
    expect(purity?.detail).toContain("update_backlog_item_status (side-effecting)");
    expect(purity?.detail).toContain(
      "get_my_coworker_profile (not authorized by the agent's grants)",
    );
    expect(purity?.detail).toContain("mystery_tool (not in the platform tool catalog)");
  });

  it("ORACLE-PURITY: an offered tool always passes regardless of classification", () => {
    // Offered-surface membership is the sufficient fast-path — the envelope
    // rule subsumes the old check rather than weakening it.
    const verdicts = evaluateJourneyOracles(
      evidence({
        executedTools: [{ name: "query_backlog", success: true, authorization: "unauthorized" }],
      }),
    );
    expect(byId(verdicts, "ORACLE-PURITY")?.passed).toBe(true);
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
