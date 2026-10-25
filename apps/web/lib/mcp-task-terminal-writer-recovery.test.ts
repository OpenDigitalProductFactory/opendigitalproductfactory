import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({
  readers: vi.fn(async () => []),
  writer: vi.fn(async (_args?: { where?: { success?: boolean } }): Promise<Record<string, unknown> | null> => null),
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

describe("canonical design writer refusal", () => {
  function existingFor(error: string, message: string) {
    return { taskRunId: "TR-CANONICAL-DESIGN", status: "input-required", a2aMetadata: {},
      updatedAt: new Date("2026-10-15T22:15:48.811Z"),
      progressPayload: { terminalWriterWait: { ...wait, writerRejection: {
        schemaVersion: 1, error, message, observedAt: wait.observedAt,
      } } } } as never;
  }
  const policy = { writerToolName: wait.writerToolName } as never;
  function writerRow(error: string, message: string) {
    calls.writer.mockImplementation(async (args?: { where?: { success?: boolean } }) => {
      if (args?.where?.success === true) return null;
      return { id: "writer-1", success: false, parameters: {}, result: { success: false, error, message } };
    });
  }

  it("does not reserve another attempt after CANONICAL_DESIGN_REQUIRED", async () => {
    writerRow("CANONICAL_DESIGN_REQUIRED", "The artifact has no marked objective statements.");
    const result = await reserveTerminalWriterReplay({
      existing: existingFor("CANONICAL_DESIGN_REQUIRED", "The artifact has no marked objective statements."),
      parsed: {} as never, terminalToolPolicy: policy,
    });
    expect(result).toBeNull();
    expect(calls.reserve).not.toHaveBeenCalled();
  });

  it("still reserves a correctable writer refusal", async () => {
    writerRow("CLASSIFICATION_REQUIRED", "Classify the item.");
    const result = await reserveTerminalWriterReplay({
      existing: existingFor("CLASSIFICATION_REQUIRED", "Classify the item."),
      parsed: {} as never, terminalToolPolicy: policy,
    });
    expect(result?.wait.writerToolName).toBe(wait.writerToolName);
    expect(calls.reserve).toHaveBeenCalledTimes(1);
  });
});
