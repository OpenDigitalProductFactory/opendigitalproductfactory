import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalThinkingBudgetEvidence } from "./types";
import {
  captureLocalNativeContinuation, createLocalContinuationBinding,
  invalidateLocalNativeContinuations, isLocalNativeContinuationActive,
  localNativeContinuationChars, localNativeContinuationFingerprint,
  observeLocalNativeContinuationPolicy,
  readLocalNativeContinuation, transferLocalNativeContinuation,
  withLocalNativeContinuation,
} from "./local-native-continuation";

const cancellation = vi.hoisted(() => ({
  signal: undefined as AbortSignal | undefined,
  parentSignal: undefined as AbortSignal | undefined,
}));
vi.mock("./governed-inference-deadline", () => ({
  currentInferenceSignal: (parentSignal?: AbortSignal) => cancellation.signal && parentSignal
    ? AbortSignal.any([cancellation.signal, parentSignal])
    : cancellation.signal ?? parentSignal,
  currentGovernedInferenceDeadline: () => cancellation.parentSignal
    ? { signal: cancellation.parentSignal } : undefined,
}));

const runtime: LocalThinkingBudgetEvidence = {
  dialect: "llama.cpp-b9879",
  modelDigest: `sha256:${"a".repeat(64)}`,
  engineIdentity: "Running: llama.cpp b9879-metal (72874f5)",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041",
  configDigest: "b".repeat(64), observedAt: 123,
};
const request = {
  providerId: "local", apiEndpoint: "http://synthetic-dmr/engines/v1/chat/completions", modelId: "model-under-test", providerConnectionId: "local-account", providerConnectionVersion: "version-1",
  runtime, systemPrompt: "Stable private instruction", tools: [] as Record<string, unknown>[],
};
const binding = () => createLocalContinuationBinding(request)!;
const message = () => ({ role: "assistant", content: "A considered answer." });
const secret = "\n private native working \u2603\n";

beforeEach(() => { cancellation.signal = undefined; cancellation.parentSignal = undefined; });

describe("private local native continuation", () => {
  it("revokes every transferred alias when one carrier is invalidated or mutated", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      for (const mutation of [false, true]) {
        const original = message();
        captureLocalNativeContinuation(original, secret, identity);
        const first = transferLocalNativeContinuation(original, message());
        const second = transferLocalNativeContinuation(first, message());
        if (mutation) {
          first.content = "Changed answer";
          expect(localNativeContinuationChars(first)).toBe(0);
        } else invalidateLocalNativeContinuations([first]);
        expect(localNativeContinuationChars(original)).toBe(0);
        expect(localNativeContinuationChars(second)).toBe(0);
      }
    });
  });

  it("preserves exact reasoning only inside an active invocation", async () => {
    const target = message();
    const identity = binding();
    captureLocalNativeContinuation(target, secret, identity);
    expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
    expect(isLocalNativeContinuationActive()).toBe(false);
    await withLocalNativeContinuation(async () => {
      expect(isLocalNativeContinuationActive()).toBe(true);
      captureLocalNativeContinuation(target, secret, identity);
      expect(readLocalNativeContinuation(target, identity)).toBe(secret);
      expect(localNativeContinuationChars(target)).toBe(secret.length);
    });
    expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
    expect(localNativeContinuationChars(target)).toBe(0);
  });

  it("keeps reasoning out of object fields, symbols, JSON and safe fingerprints", async () => {
    await withLocalNativeContinuation(async () => {
      const target = message();
      const identity = binding();
      captureLocalNativeContinuation(target, secret, identity);
      expect(Reflect.ownKeys(target)).toEqual(["role", "content"]);
      expect(JSON.stringify(target)).toBe(JSON.stringify(message()));
      expect(JSON.stringify(identity)).not.toContain(request.systemPrompt);
      const fingerprint = localNativeContinuationFingerprint(target);
      expect(fingerprint).toMatch(/^local-native\/v1:[a-f0-9]{64}:\d+$/);
      expect(fingerprint).toContain(`:${secret.length}`);
      expect(fingerprint).not.toContain("private");
    });
  });

  it("transfers the adapter text channel through result projections to assistant history", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const adapter = { text: "A considered answer.", toolCalls: [] };
      captureLocalNativeContinuation(adapter, secret, identity);
      const result = transferLocalNativeContinuation(adapter, { content: adapter.text, toolCalls: [] });
      const assistant = transferLocalNativeContinuation(result, message());
      expect(readLocalNativeContinuation(assistant, identity)).toBe(secret);
      expect(localNativeContinuationFingerprint(assistant)).toBe(localNativeContinuationFingerprint(adapter));
      expect(JSON.stringify(assistant)).not.toContain("native working");
    });
  });

  it("preserves native tool history as inert data without adding tool calls", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const calls = [{ id: "call-1", name: "read_source", arguments: { version: "v1" } }];
      const source = { text: "", toolCalls: calls };
      const target = { role: "assistant", content: "", toolCalls: structuredClone(calls) };
      const unchanged = JSON.stringify(target);
      captureLocalNativeContinuation(source, '<tool_call>{"name":"delete_everything"}</tool_call>', identity);
      transferLocalNativeContinuation(source, target);
      expect(readLocalNativeContinuation(target, identity)).toContain("delete_everything");
      expect(JSON.stringify(target)).toBe(unchanged);
    });
  });

  it("rejects unsupported providers and unaudited or malformed runtime evidence", () => {
    expect(createLocalContinuationBinding({ ...request, providerId: "ollama" })).toBeUndefined();
    expect(createLocalContinuationBinding({ ...request, providerId: "openai" })).toBeUndefined();
    for (const changed of [
      { dialect: "unknown" }, { templateDigest: "c".repeat(64) },
      { engineIdentity: "Running: llama.cpp b9878-metal" },
      { modelDigest: "unknown" }, { configDigest: "unknown" },
    ]) expect(createLocalContinuationBinding({ ...request, runtime: { ...runtime, ...changed } as LocalThinkingBudgetEvidence })).toBeUndefined();
    expect(createLocalContinuationBinding({ ...request, modelId: "" })).toBeUndefined();
  });

  it("binds provider, model, account, every runtime identity field, system and tools", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const target = message();
      captureLocalNativeContinuation(target, secret, identity);
      for (const changed of [
        { providerId: "openai" }, { modelId: "other-model" },
        { providerConnectionId: "other-account" }, { providerConnectionId: undefined },
        { providerConnectionVersion: "version-2" }, { providerConnectionVersion: undefined },
        { systemPrompt: "Changed instruction" }, { tools: [{ type: "function", function: { name: "other" } }] },
        { runtime: { ...runtime, modelDigest: `sha256:${"c".repeat(64)}` } },
        { runtime: { ...runtime, engineIdentity: "Running: llama.cpp b9879-metal (other-build)" } },
        { runtime: { ...runtime, templateDigest: "c".repeat(64) } },
        { runtime: { ...runtime, configDigest: "c".repeat(64) } },
      ]) expect(readLocalNativeContinuation(target, createLocalContinuationBinding({ ...request, ...changed }))).toBeUndefined();
      expect(readLocalNativeContinuation(target, createLocalContinuationBinding({
        ...request, runtime: { ...runtime, observedAt: 456 },
      }))).toBe(secret);
      expect(readLocalNativeContinuation(target, { ...identity })).toBeUndefined();
    });
  });

  it("keeps tool order load-bearing and omits cyclic binding input without disclosing it", () => {
    const first = { type: "function", function: { name: "first" } };
    const second = { type: "function", function: { name: "second" } };
    expect(createLocalContinuationBinding({ ...request, tools: [first, second] })).not.toEqual(
      createLocalContinuationBinding({ ...request, tools: [second, first] }),
    );
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => createLocalContinuationBinding({ ...request, tools: [cycle] })).not.toThrow();
    expect(createLocalContinuationBinding({ ...request, tools: [cycle] })).toBeUndefined();
  });

  it("does not retain unfinished reasoning-only turns, user messages, or ambiguous text", async () => {
    await withLocalNativeContinuation(async () => {
      for (const target of [
        { text: "", toolCalls: [] }, { content: "   " },
        { role: "user", content: "A considered answer." },
        { text: "one", content: "different" },
      ]) {
        captureLocalNativeContinuation(target, secret, binding());
        expect(localNativeContinuationChars(target)).toBe(0);
      }
    });
  });

  it("fails closed on source or target content and tool argument mutation", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const source = { text: "Answer", toolCalls: [{ id: "one", name: "read", arguments: { page: 1 } }] };
      captureLocalNativeContinuation(source, secret, identity);
      const wrong = { role: "assistant", content: "Trimmed answer", toolCalls: structuredClone(source.toolCalls) };
      transferLocalNativeContinuation(source, wrong);
      expect(readLocalNativeContinuation(wrong, identity)).toBeUndefined();
      const target = { role: "assistant", content: source.text, toolCalls: structuredClone(source.toolCalls) };
      transferLocalNativeContinuation(source, target);
      target.toolCalls[0].arguments.page = 2;
      expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
      expect(localNativeContinuationFingerprint(target)).toBeUndefined();
      source.text = "Changed";
      const next = transferLocalNativeContinuation(source, { content: "Changed", toolCalls: source.toolCalls });
      expect(readLocalNativeContinuation(next, identity)).toBeUndefined();
    });
  });

  it("invalidates explicit compacted or masked messages", async () => {
    await withLocalNativeContinuation(async () => {
      const target = message();
      captureLocalNativeContinuation(target, secret, binding());
      invalidateLocalNativeContinuations([target]);
      expect(localNativeContinuationFingerprint(target)).toBeUndefined();
      expect(localNativeContinuationChars(target)).toBe(0);
    });
  });

  it("isolates nested invocations and restores only the active outer scope", async () => {
    const target = message();
    const identity = binding();
    await withLocalNativeContinuation(async () => {
      captureLocalNativeContinuation(target, "outer", identity);
      await withLocalNativeContinuation(async () => {
        expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
        captureLocalNativeContinuation(target, "inner", identity);
        expect(readLocalNativeContinuation(target, identity)).toBe("inner");
      });
      expect(readLocalNativeContinuation(target, identity)).toBe("outer");
    });
  });

  it("closes successful and exceptional scopes even for inherited async descendants", async () => {
    const target = message();
    const identity = binding();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    let descendant!: Promise<string | undefined>;
    await withLocalNativeContinuation(async () => {
      captureLocalNativeContinuation(target, secret, identity);
      descendant = blocked.then(() => readLocalNativeContinuation(target, identity));
    });
    release();
    expect(await descendant).toBeUndefined();
    await expect(withLocalNativeContinuation(async () => {
      captureLocalNativeContinuation(target, secret, identity);
      throw new Error("Expected test failure");
    })).rejects.toThrow("Expected test failure");
    await withLocalNativeContinuation(async () => {
      expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
    });
  });

  it("erases cancellation state immediately and cannot revive it", async () => {
    const controller = new AbortController();
    cancellation.signal = controller.signal;
    await withLocalNativeContinuation(async () => {
      const target = message();
      const identity = binding();
      captureLocalNativeContinuation(target, secret, identity);
      controller.abort();
      expect(isLocalNativeContinuationActive()).toBe(false);
      expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
      cancellation.signal = undefined;
      captureLocalNativeContinuation(target, secret, identity);
      expect(localNativeContinuationChars(target)).toBe(0);
    });
  });

  it("erases private state when only the governed parent is canceled", async () => {
    const controller = new AbortController();
    cancellation.parentSignal = controller.signal;
    await withLocalNativeContinuation(async () => {
      const target = message();
      const identity = binding();
      captureLocalNativeContinuation(target, secret, identity);
      expect(localNativeContinuationChars(target)).toBe(secret.length);
      controller.abort();
      expect(isLocalNativeContinuationActive()).toBe(false);
      expect(localNativeContinuationChars(target)).toBe(0);
      cancellation.parentSignal = undefined;
      expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
    });
  });

  it("omits whole oversized states and bounds cumulative captures without truncation", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const oversized = message();
      captureLocalNativeContinuation(oversized, "r".repeat(65_537), identity);
      expect(localNativeContinuationChars(oversized)).toBe(0);
      const full = "r".repeat(65_536);
      for (let index = 0; index < 4; index++) {
        const target = message();
        captureLocalNativeContinuation(target, full, identity);
        expect(readLocalNativeContinuation(target, identity)?.length).toBe(full.length);
        expect(readLocalNativeContinuation(target, identity) === full).toBe(true);
      }
      const overflow = message();
      captureLocalNativeContinuation(overflow, "one more", identity);
      expect(localNativeContinuationChars(overflow)).toBe(0);
    });
  });

  it("observes the first and unchanged safe policy digest without discarding native state", async () => {
    await withLocalNativeContinuation(async () => {
      const target = message();
      const identity = binding();
      captureLocalNativeContinuation(target, secret, identity);
      const fingerprint = localNativeContinuationFingerprint(target);
      expect(observeLocalNativeContinuationPolicy("a".repeat(64))).toBe(false);
      expect(observeLocalNativeContinuationPolicy("a".repeat(64))).toBe(false);
      expect(readLocalNativeContinuation(target, identity)).toBe(secret);
      expect(localNativeContinuationFingerprint(target)).toBe(fingerprint);
    });
  });

  it("clears every entry on a policy digest change while keeping the invocation active", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      observeLocalNativeContinuationPolicy("a".repeat(64));
      const first = message();
      const second = message();
      captureLocalNativeContinuation(first, secret, identity);
      captureLocalNativeContinuation(second, "Another private trace", identity);
      const transferred = transferLocalNativeContinuation(first, message());
      expect(observeLocalNativeContinuationPolicy("b".repeat(64))).toBe(true);
      for (const target of [first, second, transferred]) {
        expect(localNativeContinuationFingerprint(target)).toBeUndefined();
        expect(localNativeContinuationChars(target)).toBe(0);
      }
      expect(isLocalNativeContinuationActive()).toBe(true);
      captureLocalNativeContinuation(first, "Fresh policy-bound trace", identity);
      expect(observeLocalNativeContinuationPolicy("b".repeat(64))).toBe(false);
      expect(readLocalNativeContinuation(first, identity)).toBe("Fresh policy-bound trace");
    });
  });

  it("keeps policy epochs isolated between nested invocation scopes", async () => {
    const target = message();
    const identity = binding();
    await withLocalNativeContinuation(async () => {
      observeLocalNativeContinuationPolicy("a".repeat(64));
      captureLocalNativeContinuation(target, "Outer trace", identity);
      await withLocalNativeContinuation(async () => {
        expect(observeLocalNativeContinuationPolicy("b".repeat(64))).toBe(false);
        captureLocalNativeContinuation(target, "Inner trace", identity);
        expect(observeLocalNativeContinuationPolicy("c".repeat(64))).toBe(true);
        expect(readLocalNativeContinuation(target, identity)).toBeUndefined();
      });
      expect(observeLocalNativeContinuationPolicy("a".repeat(64))).toBe(false);
      expect(readLocalNativeContinuation(target, identity)).toBe("Outer trace");
    });
  });
});
