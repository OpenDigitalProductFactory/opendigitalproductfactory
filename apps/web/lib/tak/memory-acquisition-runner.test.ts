import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  runMemoryAcquisitionSweep,
  runThreadCheckpointSweep,
  type MemoryAcquisitionDb,
} from "./memory-acquisition-runner";

function findMany<T>() {
  return vi.fn<(args?: unknown) => Promise<T[]>>();
}

describe("runMemoryAcquisitionSweep", () => {
  const db: MemoryAcquisitionDb = {
    phaseHandoff: { findMany: findMany() },
    taskRun: { findMany: findMany() },
    featureBuild: { findMany: findMany() },
    coworkerMemoryNote: { findMany: findMany() },
    agent: { findMany: findMany() },
    agentThread: { findMany: findMany() },
  };
  const recordNote = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("distills undistilled handoffs, task runs, and builds through recordCoworkerNote", async () => {
    vi.mocked(db.phaseHandoff.findMany).mockResolvedValue([
      {
        id: "handoff-1",
        fromAgentId: "AGT-EA",
        toAgentId: "AGT-BUILD",
        summary: "Keep checkpoint folding running nightly.",
        decisionsMade: ["Use recordCoworkerNote for write-time dedupe."],
        openIssues: [],
        userPreferences: [],
        createdAt: new Date("2026-07-22T01:00:00.000Z"),
      },
    ]);
    vi.mocked(db.taskRun.findMany).mockResolvedValue([
      {
        taskRunId: "task-1",
        title: "Source-local tests",
        status: "completed",
        currentAgentId: "AGT-MKT",
        initiatingAgentId: null,
        progressPayload: { summary: "Source-local tests caught the issue early." },
        completedAt: new Date("2026-07-22T02:00:00.000Z"),
      },
    ]);
    vi.mocked(db.featureBuild.findMany).mockResolvedValue([
      {
        buildId: "FB-1",
        title: "Nightly acquisition",
        phase: "complete",
        claimedByAgentId: "AGT-BUILD",
        diffSummary: "The nightly pass acquired coworker notes from completed builds.",
        changeNarrative: null,
        updatedAt: new Date("2026-07-22T03:00:00.000Z"),
      },
    ]);
    vi.mocked(db.coworkerMemoryNote.findMany).mockResolvedValue([]);
    vi.mocked(db.agent.findMany).mockResolvedValue([
      { id: "agent-cuid-ea", agentId: "AGT-EA" },
      { id: "agent-cuid-mkt", agentId: "AGT-MKT" },
      { id: "agent-cuid-build", agentId: "AGT-BUILD" },
    ]);
    recordNote
      .mockResolvedValueOnce({ ok: true, status: "created" })
      .mockResolvedValueOnce({ ok: true, status: "updated" })
      .mockResolvedValueOnce({ ok: true, status: "unchanged" })
      .mockResolvedValueOnce({ ok: false, error: "rejected" });

    const result = await runMemoryAcquisitionSweep(db, { now: new Date("2026-07-22T04:00:00.000Z"), recordNote });

    expect(recordNote).toHaveBeenCalledWith(expect.objectContaining({
      agentCuid: "agent-cuid-ea",
      noteKind: "context",
      sourceRef: "memory-distill:phase-handoff:handoff-1",
      createdBy: null,
    }));
    expect(recordNote).toHaveBeenCalledWith(expect.objectContaining({
      agentCuid: "agent-cuid-mkt",
      sourceRef: "memory-distill:task-run:task-1",
    }));
    expect(recordNote).toHaveBeenCalledWith(expect.objectContaining({
      agentCuid: "agent-cuid-build",
      sourceRef: "memory-distill:build:FB-1",
    }));
    expect(result).toMatchObject({
      experiencesScanned: 3,
      notesAttempted: 4,
      notesCreated: 1,
      notesUpdated: 1,
      notesUnchanged: 1,
      notesRejected: 1,
      skippedAlreadyDistilled: 0,
      skippedNoAgent: 0,
    });
  });

  it("skips sources already represented by a memory-distill sourceRef", async () => {
    vi.mocked(db.phaseHandoff.findMany).mockResolvedValue([
      {
        id: "handoff-1",
        fromAgentId: "AGT-EA",
        toAgentId: "AGT-BUILD",
        summary: "Use recordCoworkerNote for write-time dedupe.",
        decisionsMade: ["Use the nightly pass to acquire durable build lessons."],
        openIssues: [],
        userPreferences: [],
        createdAt: new Date("2026-07-22T01:00:00.000Z"),
      },
    ]);
    vi.mocked(db.taskRun.findMany).mockResolvedValue([]);
    vi.mocked(db.featureBuild.findMany).mockResolvedValue([]);
    vi.mocked(db.coworkerMemoryNote.findMany).mockResolvedValue([
      { sourceRef: "memory-distill:phase-handoff:handoff-1" },
    ]);
    vi.mocked(db.agent.findMany).mockResolvedValue([{ id: "agent-cuid-ea", agentId: "AGT-EA" }]);

    const result = await runMemoryAcquisitionSweep(db, { recordNote });

    expect(recordNote).not.toHaveBeenCalled();
    expect(result.skippedAlreadyDistilled).toBe(1);
  });

  it("falls back from a slug coworker handle to the canonical Agent row", async () => {
    vi.mocked(db.phaseHandoff.findMany).mockResolvedValue([
      {
        id: "handoff-1",
        fromAgentId: "build-specialist",
        toAgentId: "AGT-WS-BUILD",
        summary: "Use the nightly pass to acquire durable build lessons.",
        decisionsMade: [],
        openIssues: [],
        userPreferences: [],
        createdAt: new Date("2026-07-22T01:00:00.000Z"),
      },
    ]);
    vi.mocked(db.taskRun.findMany).mockResolvedValue([]);
    vi.mocked(db.featureBuild.findMany).mockResolvedValue([]);
    vi.mocked(db.coworkerMemoryNote.findMany).mockResolvedValue([]);
    vi.mocked(db.agent.findMany).mockResolvedValue([{ id: "agent-cuid-build", agentId: "AGT-WS-BUILD" }]);
    recordNote.mockResolvedValue({ ok: true, status: "created" });

    await runMemoryAcquisitionSweep(db, { recordNote });

    expect(recordNote).toHaveBeenCalledWith(expect.objectContaining({ agentCuid: "agent-cuid-build" }));
  });
});

describe("runThreadCheckpointSweep", () => {
  it("advances recent coworker and build threads with bounded recency windows", async () => {
    const db: MemoryAcquisitionDb = {
      phaseHandoff: { findMany: findMany() },
      taskRun: { findMany: findMany() },
      featureBuild: { findMany: findMany() },
      coworkerMemoryNote: { findMany: findMany() },
      agent: { findMany: findMany() },
      agentThread: { findMany: findMany() },
    };
    vi.mocked(db.agentThread.findMany).mockResolvedValue([
      { id: "thread-1", contextKey: "coworker", updatedAt: new Date("2026-07-22T01:00:00.000Z") },
      { id: "thread-2", contextKey: "build:FB-1", updatedAt: new Date("2026-07-22T01:00:00.000Z") },
    ]);
    const advance = vi.fn().mockResolvedValue(undefined);

    const result = await runThreadCheckpointSweep(db, { advance });

    expect(advance).toHaveBeenNthCalledWith(1, "thread-1", 8);
    expect(advance).toHaveBeenNthCalledWith(2, "thread-2", 20);
    expect(result).toEqual({ threadsChecked: 2, advanceAttempts: 2, advanceFailures: 0 });
  });
});
