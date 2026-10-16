import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  readers: vi.fn(async () => []),
  writer: vi.fn(async () => null),
  reserve: vi.fn(async () => true),
}));
vi.mock("@dpf/db", () => ({ prisma: { toolExecution: {
  findMany: calls.readers, findFirst: calls.writer,
} } }));
vi.mock("./observability/heartbeat", () => ({ reserveTaskRunGenerationWorking: calls.reserve }));
vi.mock("./mcp-task-capacity-contract", () => ({ remoteTaskRequestMatches: () => true }));

import { reserveTerminalWriterReplay } from "./mcp-task-terminal-writer-recovery";

const wait = { schemaVersion: 1, kind: "missing-terminal-writer", writerToolName: "record_initiative_design_review",
  resumeMode: "same-taskrun", attempt: 1, observedAt: "2026-10-15T22:15:48.811Z" };

beforeEach(() => vi.clearAllMocks());

describe("uncertain execution reservation fence", () => {
  it.each([
    { schemaVersion: 1, kind: "execution-uncertain", settlement: "unknown" },
    { schemaVersion: 99, settlement: "unknown" },
  ])("does not reserve another inference with budget remaining (%j)", async (uncertainty) => {
    const progress = { originalEvidence: "retained", terminalWriterWait: wait, executionUncertainty: uncertainty };
    const snapshot = structuredClone(progress);
    const result = await reserveTerminalWriterReplay({
      existing: { taskRunId: "TR-UNCERTAIN-ORIGINAL", status: "input-required", progressPayload: progress,
        a2aMetadata: {}, updatedAt: new Date("2026-10-15T22:15:48.811Z") } as never,
      parsed: {} as never,
      terminalToolPolicy: { writerToolName: wait.writerToolName } as never,
    });
    expect(result).toBeNull();
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.readers).not.toHaveBeenCalled();
    expect(progress).toEqual(snapshot);
    expect(progress.terminalWriterWait.attempt).toBe(1);
  });
});
