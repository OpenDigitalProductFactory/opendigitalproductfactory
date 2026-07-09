import { describe, it, expect, vi } from "vitest";
import {
  advanceThreadCheckpoint,
  formatCheckpointMessage,
  CHECKPOINT_FOLD_BATCH,
  CHECKPOINT_SUMMARY_CHAR_CAP,
  type AdvanceDeps,
  type CheckpointMessage,
  type ThreadCheckpointState,
} from "./thread-checkpoint";

function msg(id: number, role: "user" | "assistant", ms: number): CheckpointMessage {
  return { id: `m${id}`, role, content: `${role} message ${id}`, createdAt: new Date(ms) };
}

function makeDeps(over: Partial<AdvanceDeps> & { state: ThreadCheckpointState | null; messages: CheckpointMessage[] }): {
  deps: AdvanceDeps;
  saved: { value: ThreadCheckpointState | null };
  summarizeSpy: ReturnType<typeof vi.fn>;
} {
  const saved = { value: null as ThreadCheckpointState | null };
  const summarizeSpy = vi.fn(async ({ priorSummary, transcript }: { priorSummary: string | null; transcript: string }) =>
    `${priorSummary ? priorSummary + " | " : ""}folded(${transcript.split("\n\n").length})`,
  );
  const deps: AdvanceDeps = {
    loadState: async () => over.state,
    loadMessagesAfter: async (_t, after) =>
      after ? over.messages.filter((m) => m.createdAt.getTime() > after.getTime()) : over.messages,
    saveState: async (_t, s) => {
      saved.value = s;
    },
    summarize: summarizeSpy,
    ...over,
  };
  return { deps, saved, summarizeSpy };
}

const EMPTY_STATE: ThreadCheckpointState = {
  compactedSummary: null,
  compactionWatermarkAt: null,
  compactedTurnCount: 0,
};

describe("advanceThreadCheckpoint", () => {
  it("no-ops when the thread does not exist", async () => {
    const { deps } = makeDeps({ state: null, messages: [] });
    const r = await advanceThreadCheckpoint("t1", 8, deps);
    expect(r).toEqual({ advanced: false, reason: "no-thread" });
  });

  it("no-ops until CHECKPOINT_FOLD_BATCH messages have aged out of the window", async () => {
    // keepRecentCount=8, and only 8+ (BATCH-1) messages → nothing eligible enough
    const messages = Array.from({ length: 8 + (CHECKPOINT_FOLD_BATCH - 1) }, (_, i) =>
      msg(i, i % 2 ? "assistant" : "user", 1000 + i),
    );
    const { deps, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", 8, deps);
    expect(r).toEqual({ advanced: false, reason: "not-enough" });
    expect(summarizeSpy).not.toHaveBeenCalled();
  });

  it("folds aged-out messages, keeping the newest keepRecentCount untouched", async () => {
    const keep = 8;
    const aged = CHECKPOINT_FOLD_BATCH; // exactly enough to fold
    const messages = Array.from({ length: aged + keep }, (_, i) =>
      msg(i, i % 2 ? "assistant" : "user", 1000 + i),
    );
    const { deps, saved } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r.advanced).toBe(true);
    if (!r.advanced) throw new Error("unreachable");
    expect(r.foldedCount).toBe(aged);
    // watermark = createdAt of the newest FOLDED message (index aged-1)
    expect(r.watermarkAt.getTime()).toBe(1000 + (aged - 1));
    expect(saved.value?.compactedTurnCount).toBe(aged);
    expect(saved.value?.compactionWatermarkAt?.getTime()).toBe(1000 + (aged - 1));
  });

  it("never re-reads messages behind the watermark (folds incrementally)", async () => {
    const keep = 8;
    // watermark already at ms=1005; only messages after it are provided by loadMessagesAfter
    const state: ThreadCheckpointState = {
      compactedSummary: "prior",
      compactionWatermarkAt: new Date(1005),
      compactedTurnCount: 6,
    };
    const messages = Array.from({ length: CHECKPOINT_FOLD_BATCH + keep }, (_, i) =>
      msg(100 + i, i % 2 ? "assistant" : "user", 2000 + i),
    );
    const { deps, saved, summarizeSpy } = makeDeps({ state, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r.advanced).toBe(true);
    // prior summary is threaded into the next fold
    expect(summarizeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ priorSummary: "prior" }),
    );
    expect(saved.value?.compactedTurnCount).toBe(6 + CHECKPOINT_FOLD_BATCH);
  });

  it("caps the persisted summary length", async () => {
    const keep = 2;
    const messages = Array.from({ length: CHECKPOINT_FOLD_BATCH + keep }, (_, i) =>
      msg(i, "user", 1000 + i),
    );
    const { deps, saved } = makeDeps({
      state: EMPTY_STATE,
      messages,
      summarize: async () => "x".repeat(CHECKPOINT_SUMMARY_CHAR_CAP + 500),
    });
    await advanceThreadCheckpoint("t1", keep, deps);
    expect(saved.value?.compactedSummary?.length).toBe(CHECKPOINT_SUMMARY_CHAR_CAP);
  });

  it("is non-fatal when summarization throws", async () => {
    const keep = 2;
    const messages = Array.from({ length: CHECKPOINT_FOLD_BATCH + keep }, (_, i) =>
      msg(i, "user", 1000 + i),
    );
    const { deps } = makeDeps({
      state: EMPTY_STATE,
      messages,
      summarize: async () => {
        throw new Error("model down");
      },
    });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r).toEqual({ advanced: false, reason: "error" });
  });
});

describe("formatCheckpointMessage", () => {
  it("returns null when there is no summary (strict no-op)", () => {
    expect(formatCheckpointMessage(null)).toBeNull();
    expect(formatCheckpointMessage({ compactedSummary: null, compactedTurnCount: 0 })).toBeNull();
  });

  it("renders a durable-summary message with the turn count", () => {
    const m = formatCheckpointMessage({ compactedSummary: "did X and Y", compactedTurnCount: 12 });
    expect(m).not.toBeNull();
    expect(m!.role).toBe("user");
    expect(m!.content).toContain("12 earlier turns");
    expect(m!.content).toContain("did X and Y");
  });

  it("uses singular phrasing for a single turn", () => {
    const m = formatCheckpointMessage({ compactedSummary: "s", compactedTurnCount: 1 });
    expect(m!.content).toContain("1 earlier turn]");
  });
});
