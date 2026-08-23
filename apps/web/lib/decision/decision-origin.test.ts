import { describe, expect, it } from "vitest";

import {
  buildDecisionOriginCopy,
  parseDecisionCaller,
  resolveDecisionOrigin,
  type DecisionOriginDb,
} from "./decision-origin";

const ROOM = {
  capsuleId: "WC-1234",
  title: "Market aperture scouting",
  objective: "Find external catalogs worth ingesting",
  activityKind: "governance",
  status: "working",
};

/** A db double whose tables are empty unless a test fills them. */
function fakeDb(overrides: Partial<Record<string, unknown>> = {}): DecisionOriginDb {
  const calls: Record<string, unknown[]> = {};
  const db = {
    workroom: { findFirst: async (args: never) => (calls.workroom ??= []).push(args) && null },
    taskRun: { findUnique: async () => null },
    featureBuild: { findUnique: async () => null },
    agent: { findUnique: async () => null },
    decisionInteraction: { findMany: async () => [] },
  } as unknown as DecisionOriginDb;
  return { ...db, ...(overrides as object) } as DecisionOriginDb;
}

const BASE_ROW = {
  interactionId: "DI-1",
  question: "run hive scout ingest",
  buildId: null,
  taskRunId: null,
  outcomePayload: {},
};

describe("parseDecisionCaller", () => {
  it("pulls the session ref out of an MCP session token", () => {
    const caller = parseDecisionCaller({
      caller: { apiTokenId: "session:abc123:external-catalog-scout", agentId: "scout" },
    });
    expect(caller.sessionRef).toBe("abc123");
    expect(caller.agentId).toBe("scout");
  });

  it("leaves the session ref null for a token that is not a session token", () => {
    expect(parseDecisionCaller({ caller: { apiTokenId: "dpfmcp_live" } }).sessionRef).toBeNull();
    expect(parseDecisionCaller(null).sessionRef).toBeNull();
    expect(parseDecisionCaller("nonsense").apiTokenId).toBeNull();
  });
});

describe("resolveDecisionOrigin", () => {
  it("reports nothing resolved rather than guessing", async () => {
    const origin = await resolveDecisionOrigin(fakeDb(), BASE_ROW);
    expect(origin.matchedVia).toBe("none");
    expect(origin.workroom).toBeNull();
    expect(origin.coworker).toBeNull();
    expect(buildDecisionOriginCopy(origin).unresolved).not.toBeNull();
  });

  it("matches through the build the decision names", async () => {
    const origin = await resolveDecisionOrigin(
      fakeDb({
        featureBuild: { findUnique: async () => ({ id: "row-1", title: "Catalog ingest" }) },
        workroom: { findFirst: async () => ROOM },
      }),
      { ...BASE_ROW, buildId: "BUILD-9" },
    );
    expect(origin.matchedVia).toBe("build");
    expect(origin.workroom?.capsuleId).toBe("WC-1234");
    expect(origin.activity?.href).toBe("/build/BUILD-9");
  });

  it("resolves the task run before the room, because the key spaces differ", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const origin = await resolveDecisionOrigin(
      fakeDb({
        taskRun: {
          findUnique: async () => ({
            id: "row-77",
            title: "Daily catalog sweep",
            objective: "Scan the external catalog for new entries",
            status: "working",
          }),
        },
        workroom: {
          findFirst: async (args: { where: Record<string, unknown> }) => {
            seen.push(args.where);
            return ROOM;
          },
        },
      }),
      { ...BASE_ROW, taskRunId: "TR-5" },
    );
    expect(origin.matchedVia).toBe("task-run");
    // The room is looked up by the run's ROW id, never by the semantic id.
    expect(seen[0]).toEqual({ taskRunId: "row-77" });
    expect(origin.activity?.detail).toContain("Scan the external catalog");
  });

  it("falls back to the session token when no build or run is named", async () => {
    const origin = await resolveDecisionOrigin(
      fakeDb({ workroom: { findFirst: async () => ROOM } }),
      {
        ...BASE_ROW,
        outcomePayload: {
          caller: { apiTokenId: "session:abc123:scout", client: "claude-code/2.1.241" },
        },
      },
    );
    expect(origin.matchedVia).toBe("session-token");
    expect(origin.workroom?.title).toBe("Market aperture scouting");
  });

  it("reports the coworker alone when no room claimed the work", async () => {
    const origin = await resolveDecisionOrigin(
      fakeDb({
        agent: {
          findUnique: async () => ({
            agentId: "external-catalog-scout",
            name: "external-catalog-scout",
            displayName: "Catalog Scout",
            role: "research",
            kind: "specialist",
            portfolio: { slug: "foundational" },
          }),
        },
      }),
      { ...BASE_ROW, outcomePayload: { caller: { agentId: "external-catalog-scout" } } },
    );
    expect(origin.matchedVia).toBe("agent");
    expect(origin.workroom).toBeNull();
    expect(origin.coworker?.displayName).toBe("Catalog Scout");
    expect(buildDecisionOriginCopy(origin).basis).toContain("no room claimed");
  });

  it("counts prior occurrences and how many are still open", async () => {
    const origin = await resolveDecisionOrigin(
      fakeDb({
        decisionInteraction: {
          findMany: async () => [
            { interactionId: "DI-0", createdAt: new Date("2026-08-01"), humanOutcome: null },
            { interactionId: "DI-2", createdAt: new Date("2026-08-10"), humanOutcome: { ok: true } },
          ],
        },
      }),
      BASE_ROW,
    );
    expect(origin.recurrence.priorOccurrences).toBe(2);
    expect(origin.recurrence.stillOpen).toBe(1);
    expect(buildDecisionOriginCopy(origin).recurrence).toContain("still waiting on you");
  });
});

describe("buildDecisionOriginCopy", () => {
  it("keeps a partial match honest about what matched it", async () => {
    const origin = await resolveDecisionOrigin(
      fakeDb({ workroom: { findFirst: async () => ROOM } }),
      { ...BASE_ROW, outcomePayload: { caller: { apiTokenId: "session:abc123:scout" } } },
    );
    const copy = buildDecisionOriginCopy(origin);
    expect(copy.basis).toBe("Matched through the session token that raised it.");
    expect(copy.unresolved).toBeNull();
    expect(copy.lines[0]?.href).toBe("/build/work/WC-1234");
  });
});
