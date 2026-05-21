import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/inference/routed-inference", () => ({
  routeAndCall: vi.fn().mockResolvedValue({
    content: "Earlier turns discussed project setup and design decisions.",
    providerId: "anthropic-sub",
    modelId: "claude-haiku-4-5-20251001",
    inputTokens: 200,
    outputTokens: 30,
  }),
}));

import {
  shouldCompact,
  compactOldest,
  applyRollingCompaction,
  COMPACTION_THRESHOLD,
  COMPACTION_BATCH,
} from "./thread-compaction";
import type { ChatMessage } from "@/lib/ai-inference";

function makeMessages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `Message ${i + 1}`,
  }));
}

describe("shouldCompact", () => {
  it("returns false when message count is at or below threshold", () => {
    expect(shouldCompact(makeMessages(COMPACTION_THRESHOLD))).toBe(false);
    expect(shouldCompact(makeMessages(COMPACTION_THRESHOLD - 1))).toBe(false);
    expect(shouldCompact([])).toBe(false);
  });

  it("returns true when message count exceeds threshold", () => {
    expect(shouldCompact(makeMessages(COMPACTION_THRESHOLD + 1))).toBe(true);
    expect(shouldCompact(makeMessages(30))).toBe(true);
  });
});

describe("compactOldest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a shorter list with a summary prepended", async () => {
    const messages = makeMessages(25);
    const result = await compactOldest(messages);

    // Result length: 1 summary + (25 - COMPACTION_BATCH) remaining
    expect(result).toHaveLength(1 + (25 - COMPACTION_BATCH));
  });

  it("first message is the summary with [THREAD SUMMARY] prefix", async () => {
    const messages = makeMessages(25);
    const result = await compactOldest(messages);
    expect(result[0]!.role).toBe("user");
    expect(typeof result[0]!.content).toBe("string");
    expect(result[0]!.content as string).toMatch(/\[THREAD SUMMARY/);
  });

  it("preserves the tail messages unchanged after the summary", async () => {
    const messages = makeMessages(25);
    const result = await compactOldest(messages);
    const tail = result.slice(1);
    const expected = messages.slice(COMPACTION_BATCH);
    expect(tail).toEqual(expected);
  });

  it("returns original messages unchanged when summarization throws", async () => {
    const { routeAndCall } = await import("@/lib/inference/routed-inference");
    vi.mocked(routeAndCall).mockRejectedValueOnce(new Error("provider error"));

    const messages = makeMessages(25);
    const result = await compactOldest(messages);
    // Falls back to original messages
    expect(result).toEqual(messages);
  });
});

describe("applyRollingCompaction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not modify messages below the threshold", async () => {
    const messages = makeMessages(COMPACTION_THRESHOLD);
    const result = await applyRollingCompaction(messages);
    expect(result).toEqual(messages);
  });

  it("compacts at 21 turns, leaving the result under the threshold", async () => {
    const messages = makeMessages(21);
    const result = await applyRollingCompaction(messages);
    expect(result.length).toBeLessThanOrEqual(COMPACTION_THRESHOLD);
  });

  it("fires again at 30 turns (simulating prior compaction already applied)", async () => {
    // 30-message thread needs two compaction rounds if BATCH=10 and THRESHOLD=20
    const messages = makeMessages(30);
    const result = await applyRollingCompaction(messages);
    expect(result.length).toBeLessThanOrEqual(COMPACTION_THRESHOLD);
  });
});
