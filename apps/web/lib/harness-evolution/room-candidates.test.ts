import { describe, expect, it } from "vitest";

import {
  RING0_LAYER,
  deriveRoomCandidates,
  executorOf,
  findCrossRoomRecurrences,
  layerForShapeRef,
  resolveHarnessEvolutionBudget,
  resolvePlatformQueue,
  resolveSeedItemIds,
  roomMissFromActivity,
  roomMissFromToolFailure,
  type HarnessLayer,
  type RoomCandidate,
  type RoomMiss,
} from "./room-candidates";

// BI-49BC21C1 slice 1 (spec 2026-10-28-harness-evolution-loop-design.md):
// each ring-0 room's own recurring misses become its candidates (AC-2), the
// core takes the layer as data (AC-5), and the aggregator only spots
// cross-room recurrences (AC-4).

const NOW = new Date("2026-10-28T04:17:00Z");
const at = (minutesAgo: number) => new Date(NOW.getTime() - minutesAgo * 60_000);
const ROOM = { capsuleId: "WC-ROOM1", shapeRef: "delivery-medium@1.0.0" };

function toolMiss(id: string, toolName: string, error: string | null, minutesAgo = 1, agentId = "AGT-EXT-CODEX", threadId = `th-${id}`): RoomMiss {
  return roomMissFromToolFailure({ id, toolName, error, createdAt: at(minutesAgo), agentId, executionMode: "external-jsonrpc", threadId });
}

describe("executorOf", () => {
  it("names the executor that made the turn: external agents, Build Studio, coworkers, people", () => {
    expect(executorOf({ agentId: "AGT-EXT-CODEX", executionMode: "external-jsonrpc" })).toBe("codex");
    expect(executorOf({ agentId: "AGT-EXT-CLAUDE", executionMode: "external-jsonrpc" })).toBe("claude");
    expect(executorOf({ agentId: "AGT-EXT-GROK", executionMode: "external-jsonrpc" })).toBe("grok");
    expect(executorOf({ agentId: "build-specialist", executionMode: "agentic-loop" })).toBe("build-studio");
    expect(executorOf({ agentId: "AGT-WS-BUILD", executionMode: "agentic-loop" })).toBe("build-studio");
    expect(executorOf({ agentId: "AGT-WS-PORTFOLIO", executionMode: "agentic-loop" })).toBe("coworker");
    expect(executorOf({ agentId: "unknown", executionMode: "external-jsonrpc" })).toBe("unknown");
    expect(executorOf({ agentId: null, executionMode: null })).toBe("unknown");
  });
});

describe("resolveHarnessEvolutionBudget", () => {
  it("defaults every cap when the task carries no config", () => {
    expect(resolveHarnessEvolutionBudget(null)).toEqual({
      maxRooms: 50,
      maxCandidatesPerRoom: 3,
      maxCandidates: 50,
      maxProbeReplays: 20,
      tokenCap: 200_000,
      lookbackDays: 7,
      minRecurrence: 2,
    });
  });

  it("clamps an operator's values and ignores non-numbers", () => {
    const budget = resolveHarnessEvolutionBudget({
      maxRooms: 10_000, maxCandidatesPerRoom: 0, minRecurrence: 1, tokenCap: 9e9, lookbackDays: "all",
    });
    expect(budget).toMatchObject({ maxRooms: 200, maxCandidatesPerRoom: 1, minRecurrence: 2, tokenCap: 2_000_000, lookbackDays: 7 });
  });
});

describe("resolveSeedItemIds", () => {
  it("keeps configured order and drops blanks, repeats and non-strings", () => {
    expect(resolveSeedItemIds({ seedItemIds: ["BI-B", " ", "BI-A", "BI-B", 7] })).toEqual(["BI-B", "BI-A"]);
    expect(resolveSeedItemIds(undefined)).toEqual([]);
  });
});

describe("layerForShapeRef", () => {
  it("puts delivery shapes in ring 0 and leaves other shapes out", () => {
    expect(layerForShapeRef("delivery-medium@1.0.0", [RING0_LAYER])).toBe(RING0_LAYER);
    expect(layerForShapeRef("delivery-break-fix@1.0.0", [RING0_LAYER])).toBe(RING0_LAYER);
    expect(layerForShapeRef("acceptance-verification@1.1.0", [RING0_LAYER])).toBeNull();
    expect(layerForShapeRef(null, [RING0_LAYER])).toBeNull();
  });
});

describe("room misses", () => {
  it("keys a tool failure by tool and refusal code", () => {
    expect(toolMiss("te-1", "record_workroom_evidence", "authority_denied: room not yours")).toMatchObject({
      missKey: "tool:record_workroom_evidence:authority_denied",
      actor: "coworker",
      // No authority for the action: the fix is a narrow GPP permit, not an approval.
      componentHint: "gpp-permit",
      ref: { kind: "tool-execution", id: "te-1" },
    });
    expect(toolMiss("te-4", "claim_workroom_scope", "scope_conflict").componentHint).toBe("skill-tool");
    expect(toolMiss("te-2", "claim_workroom_scope", null).missKey).toBe("tool:claim_workroom_scope:unknown");
    expect(toolMiss("te-3", "x", "e".repeat(200)).missKey).toBe(`tool:x:${"e".repeat(60)}`);
  });

  it("maps miss-kind activities through the layer's table, human interactions included", () => {
    expect(roomMissFromActivity({ id: "a1", kind: "status-override", recordedAt: NOW, recordedByAgentId: null }, RING0_LAYER)).toMatchObject({
      missKey: "activity:status-override",
      actor: "human",
      executor: "human",
      componentHint: "stage-brief",
      ref: { kind: "room-activity", id: "a1" },
    });
    expect(roomMissFromActivity({ id: "a2", kind: "provider-blocked", recordedAt: NOW, recordedByAgentId: null }, RING0_LAYER)?.componentHint).toBe("role-grant");
    expect(roomMissFromActivity({ id: "a3", kind: "lease-renewed", recordedAt: NOW, recordedByAgentId: null }, RING0_LAYER)).toBeNull();
  });

  it("lets another layer supply its own miss kinds without a second code path", () => {
    const archetype: HarnessLayer = {
      key: "archetype:vet-clinic",
      decisionScope: "wwwd",
      shapeKeyPrefixes: ["vet-intake"],
      missKinds: { "question": { actor: "human", componentHint: "coworker-prompt" } },
    };
    expect(roomMissFromActivity({ id: "q1", kind: "question", recordedAt: NOW, recordedByAgentId: "AGT-WS-VET" }, archetype)?.componentHint).toBe("coworker-prompt");
    expect(layerForShapeRef("vet-intake@2.0.0", [RING0_LAYER, archetype])).toBe(archetype);
  });
});

describe("deriveRoomCandidates", () => {
  it("turns recurring misses into room-scoped candidates with trajectory refs", () => {
    const misses = [
      ...["a", "b", "c", "d", "e", "f"].map((id, i) => toolMiss(id, "record_workroom_evidence", "authority_denied", i)),
      toolMiss("g", "claim_workroom_scope", "scope_conflict"),
    ];
    const result = deriveRoomCandidates({ room: ROOM, layer: RING0_LAYER, misses, minRecurrence: 2, maxCandidates: 3 });
    expect(result.candidates).toEqual([
      {
        candidateKey: "WC-ROOM1:tool:record_workroom_evidence:authority_denied",
        capsuleId: "WC-ROOM1",
        shapeRef: "delivery-medium@1.0.0",
        layer: "ring-0",
        decisionScope: "wwmd",
        missKey: "tool:record_workroom_evidence:authority_denied",
        actor: "coworker",
        componentHint: "gpp-permit",
        recurrence: 6,
        executors: { codex: 6 },
        executorLayer: "executor:codex",
        distinctRuns: 6,
        lastSeenAt: at(0).toISOString(),
        trajectory: ["a", "b", "c", "d", "e"].map((id) => ({ kind: "tool-execution", id })),
      },
    ]);
    expect(result.belowThreshold).toBe(1);
  });

  it("counts distinct runs, so one thread retrying is not a recurring miss", () => {
    const oneThread = deriveRoomCandidates({
      room: ROOM, layer: RING0_LAYER, minRecurrence: 2, maxCandidates: 3,
      misses: [toolMiss("1", "t", "x", 1, "AGT-EXT-CODEX", "th-a"), toolMiss("2", "t", "x", 2, "AGT-EXT-CODEX", "th-a")],
    }).candidates[0]!;
    expect(oneThread).toMatchObject({ recurrence: 2, distinctRuns: 1 });
  });

  it("puts a miss shared by two executors in the core layer and a single executor's miss in its own layer", () => {
    const shared = deriveRoomCandidates({
      room: ROOM, layer: RING0_LAYER, minRecurrence: 2, maxCandidates: 3,
      misses: [toolMiss("1", "t", "x", 1, "AGT-EXT-CODEX"), toolMiss("2", "t", "x", 2, "AGT-EXT-CLAUDE"), toolMiss("3", "t", "x", 3, "AGT-EXT-CODEX")],
    }).candidates[0]!;
    expect(shared.executors).toEqual({ claude: 1, codex: 2 });
    expect(shared.executorLayer).toBe("core");
    const single = deriveRoomCandidates({
      room: ROOM, layer: RING0_LAYER, minRecurrence: 2, maxCandidates: 3,
      misses: [toolMiss("1", "t", "x"), toolMiss("2", "t", "x")],
    }).candidates[0]!;
    expect(single).toMatchObject({ executors: { codex: 2 }, executorLayer: "executor:codex" });
  });

  it("keeps the highest recurrence first, breaks ties stably and caps per room", () => {
    const misses = [
      toolMiss("1", "t_b", "x", 5), toolMiss("2", "t_b", "x", 5),
      toolMiss("3", "t_a", "x", 5), toolMiss("4", "t_a", "x", 5),
      toolMiss("5", "t_c", "x", 1), toolMiss("6", "t_c", "x", 1),
      toolMiss("7", "t_d", "x"), toolMiss("8", "t_d", "x"), toolMiss("9", "t_d", "x"),
    ];
    const result = deriveRoomCandidates({ room: ROOM, layer: RING0_LAYER, misses, minRecurrence: 2, maxCandidates: 3 });
    expect(result.candidates.map((c) => c.missKey)).toEqual(["tool:t_d:x", "tool:t_c:x", "tool:t_a:x"]);
    expect(result.overCap).toBe(1);
  });

  it("takes the room's own decision scope, falling back to the layer's", () => {
    const misses = [toolMiss("1", "t", "x"), toolMiss("2", "t", "x")];
    const derive = (decisionScope: string | null) =>
      deriveRoomCandidates({ room: { ...ROOM, decisionScope }, layer: RING0_LAYER, misses, minRecurrence: 2, maxCandidates: 3 })
        .candidates[0]!.decisionScope;
    expect(derive("wsid")).toBe("wsid");
    expect(derive(null)).toBe("wwmd");
    expect(derive("not-a-scope")).toBe("wwmd");
  });
});

describe("findCrossRoomRecurrences", () => {
  const candidate = (capsuleId: string, shapeRef: string, missKey: string, recurrence: number, executors: Record<string, number> = { codex: recurrence }) =>
    ({ capsuleId, shapeRef, missKey, recurrence, layer: "ring-0", executors }) as RoomCandidate;

  it("groups by shape key and miss key, two rooms or more, shape versions together", () => {
    const groups = findCrossRoomRecurrences([
      candidate("WC-1", "delivery-medium@1.0.0", "tool:t:x", 5),
      candidate("WC-2", "delivery-medium@1.1.0", "tool:t:x", 3),
      candidate("WC-3", "delivery-small@1.0.0", "tool:t:x", 9),
      candidate("WC-4", "delivery-medium@1.0.0", "tool:other:y", 4),
    ]);
    expect(groups).toEqual([
      {
        layer: "ring-0",
        shapeKey: "delivery-medium",
        missKey: "tool:t:x",
        rooms: ["WC-1", "WC-2"],
        shapeRefs: ["delivery-medium@1.0.0", "delivery-medium@1.1.0"],
        totalRecurrence: 8,
        executors: { codex: 8 },
        executorLayer: "executor:codex",
      },
    ]);
  });

  it("promotes a miss to the core when different executors hit it in different rooms", () => {
    const [group] = findCrossRoomRecurrences([
      candidate("WC-1", "delivery-small@1.0.0", "tool:t:x", 3, { codex: 3 }),
      candidate("WC-2", "delivery-small@1.0.0", "tool:t:x", 2, { "build-studio": 2 }),
    ]);
    expect(group).toMatchObject({ executors: { "build-studio": 2, codex: 3 }, executorLayer: "core" });
  });
});

describe("resolvePlatformQueue", () => {
  it("keeps open items in order and gives a reason for missing or terminal ones", () => {
    expect(
      resolvePlatformQueue(["BI-OPEN", "BI-GONE", "BI-DONE"], [
        { itemId: "BI-DONE", title: "d", status: "done" },
        { itemId: "BI-OPEN", title: "o", status: "triaging" },
      ]),
    ).toEqual({
      open: [{ itemId: "BI-OPEN", title: "o", status: "triaging" }],
      rejected: [
        { itemId: "BI-GONE", reason: "missing" },
        { itemId: "BI-DONE", reason: "terminal", status: "done" },
      ],
    });
  });
});
