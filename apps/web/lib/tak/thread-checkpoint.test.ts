import { describe, it, expect, vi } from "vitest";
import {
  advanceThreadCheckpoint,
  buildBoundedResumePacket,
  formatCheckpointMessage,
  CHECKPOINT_FOLD_BATCH,
  CHECKPOINT_FOLD_TOKEN_BUDGET,
  CHECKPOINT_SUMMARY_CHAR_CAP,
  checkpointLoadTake,
  type AdvanceDeps,
  type AdvanceResult,
  type CheckpointMessage,
  type FoldOutcome,
  type ThreadCheckpointState,
} from "./thread-checkpoint";

describe("bounded resume packets", () => {
  it("AC-FEAF-006: downgrades an oversized history to explicit metadata-only continuation", () => {
    const result = buildBoundedResumePacket({
      summary: "bounded summary",
      recentMessages: ["x".repeat(2_000), "y".repeat(2_000)],
      evidenceRefs: ["receipt-1", "receipt-2"],
      maxItems: 4,
      maxBytes: 300,
    });

    expect(result).toMatchObject({
      mode: "metadata-only",
      payload: {
        summary: "bounded summary",
        evidenceRefs: ["receipt-1", "receipt-2"],
        omittedMessageCount: 2,
      },
      metrics: { payloadDowngradeCount: 1 },
    });
    expect(result.payload.recentMessages).toBeUndefined();
    expect(result.reason).toContain("configured resume budget");
    expect(result.serializedBytes).toBeLessThanOrEqual(300);
    expect(result.originalBytes).toBeGreaterThan(4_000);
  });

  it("AC-FEAF-006: returns a bounded handoff reason when evidence metadata alone exceeds the ceiling", () => {
    const result = buildBoundedResumePacket({
      summary: null,
      recentMessages: [],
      evidenceRefs: Array.from({ length: 20 }, (_, index) => `receipt-${index}-${"z".repeat(40)}`),
      maxItems: 4,
      maxBytes: 180,
    });

    expect(result).toMatchObject({
      mode: "handoff-required",
      payload: { omittedMessageCount: 0 },
      metrics: { payloadDowngradeCount: 1 },
    });
    expect(result.reason).toContain("evidence metadata");
    expect(result.serializedBytes).toBeLessThanOrEqual(180);
  });

  it("AC-FEAF-006: keeps the fallback payload within the smallest supported byte ceiling", () => {
    const result = buildBoundedResumePacket({
      summary: null,
      recentMessages: ["oversized"],
      evidenceRefs: ["receipt-1"],
      maxItems: 0,
      maxBytes: 2,
    });

    expect(result).toMatchObject({
      mode: "handoff-required",
      payload: {},
      metrics: { payloadDowngradeCount: 1 },
    });
    expect(result.serializedBytes).toBe(2);
  });

  it("rejects an impossible resume byte ceiling", () => {
    expect(() => buildBoundedResumePacket({
      summary: null,
      recentMessages: [],
      evidenceRefs: [],
      maxItems: 0,
      maxBytes: 1,
    })).toThrowError("maxBytes must be at least 2");
  });

  it("rejects a non-integer or negative item ceiling", () => {
    for (const maxItems of [-1, 0.5]) {
      expect(() => buildBoundedResumePacket({
        summary: null,
        recentMessages: [],
        evidenceRefs: [],
        maxItems,
        maxBytes: 2,
      })).toThrowError("maxItems must be a non-negative integer");
    }
  });

  it("AC-FEAF-006: budgets UTF-8 bytes rather than JavaScript code units", () => {
    const result = buildBoundedResumePacket({
      summary: null,
      recentMessages: ["😀".repeat(40)],
      evidenceRefs: [],
      maxItems: 1,
      maxBytes: 120,
    });

    expect(result.mode).toBe("metadata-only");
    expect(result.originalBytes).toBeGreaterThan(120);
    expect(result.serializedBytes).toBeLessThanOrEqual(120);
  });
});

function msg(id: number, role: "user" | "assistant", ms: number): CheckpointMessage {
  return { id: `m${id}`, role, content: `${role} message ${id}`, createdAt: new Date(ms) };
}

function makeDeps(over: Partial<AdvanceDeps> & { state: ThreadCheckpointState | null; messages: CheckpointMessage[] }): {
  deps: AdvanceDeps;
  saved: { value: ThreadCheckpointState | null };
  summarizeSpy: ReturnType<typeof vi.fn>;
  outcomes: FoldOutcome[];
  takes: Array<number | undefined>;
} {
  const saved = { value: null as ThreadCheckpointState | null };
  const outcomes: FoldOutcome[] = [];
  const takes: Array<number | undefined> = [];
  const summarizeSpy = vi.fn(async ({ priorSummary, transcript }: { priorSummary: string | null; transcript: string }) =>
    `${priorSummary ? priorSummary + " | " : ""}folded(${transcript.split("\n\n").length})`,
  );
  const deps: AdvanceDeps = {
    loadState: async () => saved.value ?? over.state,
    // Mirrors the prisma binding: strictly-newer-than-watermark, oldest-first, bounded by `take`.
    loadMessagesAfter: async (_t, after, take) => {
      takes.push(take);
      const newer = after ? over.messages.filter((m) => m.createdAt.getTime() > after.getTime()) : over.messages;
      return typeof take === "number" ? newer.slice(0, take) : newer;
    },
    saveState: async (_t, s) => {
      saved.value = s;
    },
    summarize: summarizeSpy,
    recordFoldOutcome: async (outcome) => {
      outcomes.push(outcome);
    },
    ...over,
  };
  return { deps, saved, summarizeSpy, outcomes, takes };
}

/** Number of "Who: text" entries in a rendered transcript. */
function transcriptEntries(transcript: string): number {
  return transcript.split("\n\n").length;
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
    expect(r).toMatchObject({ advanced: false, reason: "error" });
  });
});

// BI-FDECBE0A re-opened (design 2026-09-16 §1 D1, §7 Phase 2): the fold that
// bounds a thread must itself be bounded, and its failures must be visible.
describe("advanceThreadCheckpoint — bounded fold (D1)", () => {
  const keep = 8;
  function thread(count: number, chars = 40): CheckpointMessage[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 ? "assistant" : "user",
      content: `${i % 2 ? "assistant" : "user"} message ${i} `.padEnd(chars, "x"),
      createdAt: new Date(1000 + i),
    }));
  }

  it("AC-3: loads a bounded page per advance — one batch plus the recency window, never the whole span", async () => {
    const { deps, takes, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages: thread(1_100) });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r.advanced).toBe(true);
    expect(takes).toEqual([checkpointLoadTake(keep)]);
    expect(checkpointLoadTake(keep)).toBe(CHECKPOINT_FOLD_BATCH + keep);
    // The summarizer never sees more than one batch.
    const [{ transcript }] = summarizeSpy.mock.calls[0]!;
    expect(transcriptEntries(transcript)).toBe(CHECKPOINT_FOLD_BATCH);
  });

  it("AC-3: folds at most one batch per advance and moves the watermark to the end of THAT batch", async () => {
    const messages = thread(1_100);
    const { deps, saved } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    if (!r.advanced) throw new Error(`expected advance, got ${r.reason}`);
    expect(r.foldedCount).toBe(CHECKPOINT_FOLD_BATCH);
    expect(r.watermarkAt.getTime()).toBe(messages[CHECKPOINT_FOLD_BATCH - 1]!.createdAt.getTime());
    expect(saved.value?.compactedTurnCount).toBe(CHECKPOINT_FOLD_BATCH);
    expect(r.moreEligible).toBe(true);
  });

  it("AC-1/AC-3: a 1,100-message thread converges across repeated advances instead of failing forever", async () => {
    const messages = thread(1_100);
    const { deps, saved, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages });
    let last: AdvanceResult | null = null;
    let advances = 0;
    let previousWatermark = 0;
    for (;;) {
      last = await advanceThreadCheckpoint("t1", keep, deps);
      if (!last.advanced) break;
      advances += 1;
      expect(last.foldedCount).toBeLessThanOrEqual(CHECKPOINT_FOLD_BATCH);
      expect(last.watermarkAt.getTime()).toBeGreaterThan(previousWatermark);
      previousWatermark = last.watermarkAt.getTime();
      if (advances > 1_000) throw new Error("did not converge");
    }
    // 1,092 aged-out messages fold in batches of 10; the final 2 wait for more to accumulate.
    const eligible = 1_100 - keep;
    const fullBatches = Math.floor(eligible / CHECKPOINT_FOLD_BATCH);
    expect(last).toEqual({ advanced: false, reason: "not-enough" });
    expect(advances).toBe(fullBatches);
    expect(summarizeSpy).toHaveBeenCalledTimes(fullBatches);
    expect(saved.value?.compactedTurnCount).toBe(fullBatches * CHECKPOINT_FOLD_BATCH);
    expect(saved.value?.compactedSummary).not.toBeNull();
    // The prior summary is threaded through every fold (recursive summarization).
    expect(summarizeSpy.mock.calls.at(-1)![0].priorSummary).not.toBeNull();
  });

  it("AC-4: bounds summarizer input in estimated tokens — whole messages that fit, fewer than a batch when they are large", async () => {
    // ~1,000 estimated tokens each: only budget/1,000 whole messages fit in one fold.
    const perMessageChars = 4_000;
    const messages = thread(40, perMessageChars);
    const { deps, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    if (!r.advanced) throw new Error(`expected advance, got ${r.reason}`);
    const expectedFit = Math.floor(CHECKPOINT_FOLD_TOKEN_BUDGET / Math.ceil((perMessageChars + 6) / 4));
    expect(expectedFit).toBeLessThan(CHECKPOINT_FOLD_BATCH);
    expect(r.foldedCount).toBe(expectedFit);
    const [{ transcript }] = summarizeSpy.mock.calls[0]!;
    expect(transcriptEntries(transcript)).toBe(expectedFit);
    expect(Math.ceil(transcript.length / 4)).toBeLessThanOrEqual(CHECKPOINT_FOLD_TOKEN_BUDGET);
    expect(r.skipped).toEqual([]);
  });

  it("AC-4: the observed 17,027-char maximum message fits the budget and is folded whole, not skipped", async () => {
    const messages = thread(30, 60);
    messages[0] = { ...messages[0]!, content: "x".repeat(17_027) };
    const { deps, outcomes } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    if (!r.advanced) throw new Error(`expected advance, got ${r.reason}`);
    expect(r.skipped).toEqual([]);
    expect(outcomes).toEqual([]);
    expect(r.foldedCount).toBeGreaterThanOrEqual(1);
  });

  it("AC-4: a single message larger than the whole budget is SKIPPED with a recorded reason, and the watermark still moves past it", async () => {
    const oversizedChars = CHECKPOINT_FOLD_TOKEN_BUDGET * 4 + 1_000;
    const messages = thread(30, 60);
    messages[0] = { ...messages[0]!, content: "y".repeat(oversizedChars) };
    const { deps, saved, outcomes, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    if (!r.advanced) throw new Error(`expected advance, got ${r.reason}`);

    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0]).toMatchObject({ messageId: "m0", chars: oversizedChars, budgetTokens: CHECKPOINT_FOLD_TOKEN_BUDGET });
    expect(r.skipped[0]!.estimatedTokens).toBeGreaterThan(CHECKPOINT_FOLD_TOKEN_BUDGET);
    // Durable, queryable signal carrying the reason — never a silent stall.
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: "message-skipped", threadId: "t1", reason: "exceeds-token-budget", messageId: "m0" }),
    ]);
    // The rest of the batch still folds, the omission is announced to the summarizer,
    // and the watermark passes the skipped message so it can never wedge the thread.
    expect(summarizeSpy).toHaveBeenCalledTimes(1);
    const [{ transcript }] = summarizeSpy.mock.calls[0]!;
    expect(transcript).toContain("omitted");
    expect(transcript).not.toContain("yyyyyyyy");
    expect(saved.value?.compactionWatermarkAt!.getTime()).toBeGreaterThan(messages[0]!.createdAt.getTime());
    expect(saved.value?.compactedTurnCount).toBe(r.foldedCount + 1);
  });

  it("AC-4: when every eligible message is oversized the watermark still advances and the checkpoint announces the omission", async () => {
    const oversizedChars = CHECKPOINT_FOLD_TOKEN_BUDGET * 4 + 1_000;
    const messages = thread(CHECKPOINT_FOLD_BATCH + keep, 60).map((m, i) =>
      i < CHECKPOINT_FOLD_BATCH ? { ...m, content: "z".repeat(oversizedChars) } : m,
    );
    const { deps, saved, outcomes, summarizeSpy } = makeDeps({ state: EMPTY_STATE, messages });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    if (!r.advanced) throw new Error(`expected advance, got ${r.reason}`);
    expect(r.foldedCount).toBe(0);
    expect(r.skipped).toHaveLength(CHECKPOINT_FOLD_BATCH);
    expect(outcomes).toHaveLength(CHECKPOINT_FOLD_BATCH);
    expect(summarizeSpy).not.toHaveBeenCalled();
    expect(saved.value?.compactionWatermarkAt!.getTime()).toBe(messages[CHECKPOINT_FOLD_BATCH - 1]!.createdAt.getTime());
    expect(saved.value?.compactedTurnCount).toBe(CHECKPOINT_FOLD_BATCH);
    expect(saved.value?.compactedSummary).toContain("omitted");
  });

  it("AC-5: a summarizer failure is returned WITH its stage and message and recorded durably — the catch stays, the silence goes", async () => {
    const { deps, outcomes, saved } = makeDeps({
      state: EMPTY_STATE,
      messages: thread(30),
      summarize: async () => {
        throw new Error("model down");
      },
    });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r).toEqual({ advanced: false, reason: "error", stage: "summarize", message: "model down" });
    expect(outcomes).toEqual([
      expect.objectContaining({ kind: "fold-failed", threadId: "t1", stage: "summarize", message: "model down" }),
    ]);
    expect(saved.value).toBeNull();
  });

  it("AC-5: a store failure is attributed to its stage", async () => {
    const { deps, outcomes } = makeDeps({
      state: EMPTY_STATE,
      messages: thread(30),
      saveState: async () => {
        throw new Error("db gone");
      },
    });
    const r = await advanceThreadCheckpoint("t1", keep, deps);
    expect(r).toEqual({ advanced: false, reason: "error", stage: "save", message: "db gone" });
    expect(outcomes[0]).toMatchObject({ kind: "fold-failed", stage: "save", message: "db gone" });
  });

  it("AC-5: a failing outcome recorder never breaks the advance or the turn", async () => {
    const { deps } = makeDeps({
      state: EMPTY_STATE,
      messages: thread(30),
      summarize: async () => {
        throw new Error("model down");
      },
      recordFoldOutcome: async () => {
        throw new Error("signal store down");
      },
    });
    await expect(advanceThreadCheckpoint("t1", keep, deps)).resolves.toMatchObject({ advanced: false, reason: "error", stage: "summarize" });
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
