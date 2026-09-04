import { describe, expect, it } from "vitest";

import {
  assertAsyncOperationTransition,
  canonicalAsyncOperationBindingDigest,
  canonicalAsyncOperationRequestDigest,
  parseAsyncInferenceOperationStatus,
  type AsyncOperationBinding,
} from "./async-operation-contract";

const taskRunBinding: AsyncOperationBinding = {
  kind: "task-run",
  taskRunId: "task-run-row-1",
  requestKey: "initiative-review:BI-ASYNC:1",
  requestDigest: "a".repeat(64),
};

describe("async operation lifecycle contract", () => {
  it.each([
    "pending",
    "start_indeterminate",
    "running",
    "completed",
    "failed",
    "cancelled",
    "expired",
  ] as const)("accepts canonical status %s", (status) => {
    expect(parseAsyncInferenceOperationStatus(status)).toBe(status);
  });

  it.each(["queued", "in_progress", "succeeded", "unknown", "", null, 1])(
    "rejects non-canonical status %j",
    (status) => {
      expect(() => parseAsyncInferenceOperationStatus(status)).toThrow(
        "Invalid async inference operation status",
      );
    },
  );

  it("produces a stable digest and keeps TaskRun and Workroom authority distinct", () => {
    const same = { ...taskRunBinding };
    const workroom: AsyncOperationBinding = {
      kind: "workroom",
      workroomId: "workroom-row-1",
      requestKey: taskRunBinding.requestKey,
      requestDigest: taskRunBinding.requestDigest,
    };

    expect(canonicalAsyncOperationBindingDigest(taskRunBinding)).toBe(
      canonicalAsyncOperationBindingDigest(same),
    );
    expect(canonicalAsyncOperationBindingDigest(taskRunBinding)).not.toBe(
      canonicalAsyncOperationBindingDigest(workroom),
    );
  });

  it("binds the exact canonical screened context without depending on object key order", () => {
    const base = {
      providerId: "gemini",
      modelId: "deep-research",
      contractFamily: "research",
      screenedRequestDigest: "d".repeat(64),
      binding: taskRunBinding,
    };
    const first = canonicalAsyncOperationRequestDigest({
      ...base,
      screenedRequestContext: {
        executionPlan: { maxTokens: 4096, executionAdapter: "async" },
        messages: [{ role: "user", content: "research" }],
      },
    });
    const reordered = canonicalAsyncOperationRequestDigest({
      ...base,
      screenedRequestContext: {
        messages: [{ content: "research", role: "user" }],
        executionPlan: { executionAdapter: "async", maxTokens: 4096 },
      },
    });
    const drifted = canonicalAsyncOperationRequestDigest({
      ...base,
      screenedRequestContext: {
        messages: [{ content: "research", role: "user" }],
        executionPlan: { executionAdapter: "async", maxTokens: 8192 },
      },
    });

    expect(first).toBe(reordered);
    expect(first).not.toBe(drifted);
  });

  it.each([
    ["pending", "running"],
    ["pending", "start_indeterminate"],
    ["pending", "cancelled"],
    ["pending", "expired"],
    ["running", "running"],
    ["running", "completed"],
    ["running", "failed"],
    ["running", "cancelled"],
    ["running", "expired"],
    ["start_indeterminate", "running"],
    ["start_indeterminate", "failed"],
    ["start_indeterminate", "cancelled"],
    ["start_indeterminate", "expired"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(assertAsyncOperationTransition(from, to)).toEqual({ from, to });
  });

  it.each([
    ["pending", "completed"],
    ["start_indeterminate", "pending"],
    ["running", "pending"],
    ["completed", "running"],
    ["failed", "running"],
    ["cancelled", "running"],
    ["expired", "running"],
  ] as const)("rejects illegal transition %s -> %s", (from, to) => {
    expect(() => assertAsyncOperationTransition(from, to)).toThrow(
      `Illegal async inference operation transition: ${from} -> ${to}`,
    );
  });
});
