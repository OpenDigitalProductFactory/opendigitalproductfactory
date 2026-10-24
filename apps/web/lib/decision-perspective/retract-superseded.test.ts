import { describe, expect, it } from "vitest";
import {
  isSupersededByScope,
  planRetractions,
  retractSupersededDecisions,
  retractionOf,
  toolNameForRow,
} from "./retract-superseded";

const TOOLS = ["run_hive_scout_ingest", "create_portal_pr", "run_ux_test", "create_customer_account"];
const SCOPES: Record<string, "platform" | "business"> = {
  run_hive_scout_ingest: "platform",
  create_portal_pr: "platform",
  create_customer_account: "business",
};
const scopeOf = (name: string) => SCOPES[name];
const NOW = new Date("2026-09-16T00:00:00Z");

function row(over: Partial<Parameters<typeof toolNameForRow>[0]> = {}) {
  return {
    interactionId: "DI-1",
    question: "run hive scout ingest: ",
    routeContext: "/platform/ai/operations",
    outcomePayload: { confidenceScore: 0.75 },
    ...over,
  };
}

describe("identifying the tool behind a decision row", () => {
  it("reads the tool from a /tool/<name> route", () => {
    expect(toolNameForRow(row({ routeContext: "/tool/create_portal_pr" }), TOOLS)).toBe("create_portal_pr");
  });

  it("falls back to the question prefix alignmentStatement wrote", () => {
    expect(toolNameForRow(row(), TOOLS)).toBe("run_hive_scout_ingest");
  });

  it("matches the longest tool label, not merely the first that fits", () => {
    const names = ["run_hive", "run_hive_scout_ingest"];
    expect(toolNameForRow(row(), names)).toBe("run_hive_scout_ingest");
  });

  it("returns null for a question that is not a tool statement", () => {
    expect(
      toolNameForRow(row({ question: "Should we fund the Workroom owner writer?" }), TOOLS),
    ).toBeNull();
  });

  it("ignores a /tool/ route naming a tool the catalog does not have", () => {
    expect(
      toolNameForRow(row({ routeContext: "/tool/not_a_real_tool", question: "x" }), TOOLS),
    ).toBeNull();
  });
});

describe("what counts as superseded", () => {
  it("supersedes a question whose tool is now platform-scoped", () => {
    expect(isSupersededByScope("run_hive_scout_ingest", scopeOf)).toBe(true);
  });

  it("leaves a genuine business-scoped tool alone", () => {
    expect(isSupersededByScope("create_customer_account", scopeOf)).toBe(false);
  });

  it("does not supersede on absence — an unknown scope is ambiguous, not an answer", () => {
    expect(isSupersededByScope("run_ux_test", scopeOf)).toBe(false);
    expect(isSupersededByScope(null, scopeOf)).toBe(false);
  });
});

describe("planning retractions", () => {
  it("retracts the flood and records why", () => {
    const rows = Array.from({ length: 39 }, (_, i) => row({ interactionId: `DI-${i}` }));
    const plan = planRetractions({ rows, toolNames: TOOLS, scopeOf, now: NOW });
    expect(plan).toHaveLength(39);
    expect(plan[0]!.retraction.supersededByTool).toBe("run_hive_scout_ingest");
    expect(plan[0]!.retraction.reason).toContain("would not ask this question today");
    expect(plan[0]!.retraction.retractedAt).toBe("2026-09-16T00:00:00.000Z");
  });

  it("leaves a real business decision pending", () => {
    const plan = planRetractions({
      rows: [row({ question: "Should we fund the Workroom owner writer?", routeContext: "/ops/demand" })],
      toolNames: TOOLS,
      scopeOf,
      now: NOW,
    });
    expect(plan).toHaveLength(0);
  });

  it("is idempotent — an already-retracted row is not re-stamped", () => {
    const already = row({
      outcomePayload: {
        confidenceScore: 0.75,
        retraction: { retractedAt: "2026-09-15T00:00:00.000Z", reason: "r", supersededByTool: "run_hive_scout_ingest" },
      },
    });
    expect(planRetractions({ rows: [already], toolNames: TOOLS, scopeOf, now: NOW })).toHaveLength(0);
  });

  it("never proposes touching humanOutcome — the marker is machine-owned", () => {
    const plan = planRetractions({ rows: [row()], toolNames: TOOLS, scopeOf, now: NOW });
    expect(Object.keys(plan[0]!)).toEqual(["interactionId", "retraction"]);
    expect(JSON.stringify(plan)).not.toContain("humanOutcome");
    expect(JSON.stringify(plan)).not.toContain("clearsGate");
  });
});

describe("reading a retraction back", () => {
  it("recognises a stamped row and ignores an unstamped one", () => {
    expect(retractionOf({ retraction: { retractedAt: "2026-09-16T00:00:00.000Z" } })).not.toBeNull();
    expect(retractionOf({ confidenceScore: 0.75 })).toBeNull();
    expect(retractionOf(null)).toBeNull();
    expect(retractionOf({ retraction: { reason: "no timestamp" } })).toBeNull();
  });
});

describe("retractSupersededDecisions", () => {
  function fakeDb(rows: ReturnType<typeof row>[]) {
    const updates: Array<{ where: unknown; data: Record<string, unknown> }> = [];
    return {
      updates,
      db: {
        decisionInteraction: {
          findMany: async () => rows,
          update: async (args: { where: unknown; data: Record<string, unknown> }) => {
            updates.push(args);
            return null;
          },
        },
      },
    };
  }

  it("stamps the flood and leaves a genuine decision untouched", async () => {
    const { db, updates } = fakeDb([
      row({ interactionId: "DI-dup" }),
      row({ interactionId: "DI-real", question: "Should we fund the writer?", routeContext: "/ops/demand" }),
    ]);
    const result = await retractSupersededDecisions({ db: db as never, toolNames: TOOLS, scopeOf, now: NOW });
    expect(result).toMatchObject({ scanned: 2, retracted: 1 });
    expect(updates).toHaveLength(1);
    expect((updates[0]!.where as { interactionId: string }).interactionId).toBe("DI-dup");
  });

  it("preserves the gate's own evidence rather than replacing the payload", async () => {
    const { db, updates } = fakeDb([row({ outcomePayload: { confidenceScore: 0.75, stanceAlignment: "approve" } })]);
    await retractSupersededDecisions({ db: db as never, toolNames: TOOLS, scopeOf, now: NOW });
    const payload = updates[0]!.data["outcomePayload"] as Record<string, unknown>;
    expect(payload["confidenceScore"]).toBe(0.75);
    expect(payload["stanceAlignment"]).toBe("approve");
    expect(payload["retraction"]).toBeDefined();
  });

  it("never writes humanOutcome — a retraction is not a ruling", async () => {
    const { db, updates } = fakeDb([row()]);
    await retractSupersededDecisions({ db: db as never, toolNames: TOOLS, scopeOf, now: NOW });
    expect(Object.keys(updates[0]!.data)).toEqual(["outcomePayload"]);
  });

  it("dryRun plans without writing, so an operator can see it first", async () => {
    const { db, updates } = fakeDb([row()]);
    const result = await retractSupersededDecisions({
      db: db as never, toolNames: TOOLS, scopeOf, now: NOW, dryRun: true,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.retracted).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
