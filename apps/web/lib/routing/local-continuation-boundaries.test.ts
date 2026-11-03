import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./chat-message-types";
import type { LocalThinkingBudgetEvidence } from "./types";
import {
  captureLocalNativeContinuation,
  createLocalContinuationBinding,
  localNativeContinuationChars,
  localNativeContinuationFingerprint,
  readLocalNativeContinuation,
  transferLocalNativeContinuation,
  withLocalNativeContinuation,
} from "./local-native-continuation";
import { compactAgenticMessages, estimateContextTokens } from "@/lib/tak/context-pressure";
import { classifyInferencePayload } from "@/lib/inference/data-screening/classify-payload";
import { screenInferencePayload } from "@/lib/inference/data-screening/screen-inference-payload";
import {
  createRoutedInferenceScreen,
  rescreenRoutedInferencePayload,
} from "@/lib/inference/data-screening/routed-screening";

// Synthetic private bytes only. The installed template fingerprint is shared
// with the leaf regression fixture; these tests never invoke a provider.
const PRIVATE_STATE = "SYNTHETIC_NATIVE_BOUNDARY_CALCULATION_0123456789";
const SYSTEM_PROMPT = "Stable synthetic instruction.";
const runtime: LocalThinkingBudgetEvidence = {
  dialect: "llama.cpp-b9879",
  modelDigest: `sha256:${"a".repeat(64)}`,
  engineIdentity: "Running: llama.cpp b9879-metal (72874f5)",
  templateDigest: "c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041",
  configDigest: "b".repeat(64),
  observedAt: 123,
};
const request = {
  providerId: "local",
  apiEndpoint: "http://synthetic-dmr/engines/v1/chat/completions",
  modelId: "model-under-test",
  providerConnectionId: "local-account",
  runtime,
  systemPrompt: SYSTEM_PROMPT,
  tools: [] as Record<string, unknown>[],
};

function binding() {
  return createLocalContinuationBinding(request)!;
}

function assistant(content = "The calculated value is 63."): ChatMessage {
  return { role: "assistant", content };
}

function classify(messages: ChatMessage[]) {
  return classifyInferencePayload({
    messages,
    systemPrompt: SYSTEM_PROMPT,
    taskType: "conversation",
  });
}

describe("local native continuation at context boundaries", () => {
  it("counts private continuation bytes in pressure while the invocation owns them", async () => {
    const message = assistant();
    const ordinaryChars = SYSTEM_PROMPT.length + String(message.content).length;
    await withLocalNativeContinuation(async () => {
      captureLocalNativeContinuation(message, PRIVATE_STATE, binding());
      expect(estimateContextTokens([message], SYSTEM_PROMPT)).toBe(
        Math.ceil((ordinaryChars + PRIVATE_STATE.length) / 4),
      );
      expect(JSON.stringify(message)).not.toContain(PRIVATE_STATE);
    });
    expect(estimateContextTokens([message], SYSTEM_PROMPT)).toBe(Math.ceil(ordinaryChars / 4));
  });

  it("transfers unchanged history to its compaction projections without exposing the carrier", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const message = assistant();
      const history: ChatMessage[] = [{ role: "user", content: "Calculate the value." }, message];
      const before = JSON.stringify(history);
      captureLocalNativeContinuation(message, PRIVATE_STATE, identity);

      const compacted = compactAgenticMessages(history);

      expect(JSON.stringify(compacted)).toBe(before);
      expect(readLocalNativeContinuation(compacted[1]!, identity)).toBe(PRIVATE_STATE);
      expect(localNativeContinuationFingerprint(compacted[1]!)).toBe(
        localNativeContinuationFingerprint(message),
      );
      expect(estimateContextTokens(compacted, SYSTEM_PROMPT)).toBe(
        estimateContextTokens(history, SYSTEM_PROMPT),
      );
      expect(JSON.stringify(compacted)).not.toContain(PRIVATE_STATE);
    });
  });

  it("invalidates even unchanged original carriers when any earlier text is truncated", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const oldAnswer = assistant("x".repeat(4_100));
      const latestAnswer = assistant();
      const history: ChatMessage[] = [
        { role: "user", content: "Use the earlier calculation." }, oldAnswer, latestAnswer,
      ];
      captureLocalNativeContinuation(oldAnswer, PRIVATE_STATE, identity);
      captureLocalNativeContinuation(latestAnswer, "SYNTHETIC_LATEST_STATE", identity);

      const compacted = compactAgenticMessages(history);

      expect(String(compacted[1]!.content)).toContain("[truncated");
      expect(compacted[2]!.content).toBe(latestAnswer.content);
      for (const message of [...history, ...compacted]) {
        expect(localNativeContinuationFingerprint(message)).toBeUndefined();
        expect(localNativeContinuationChars(message)).toBe(0);
      }
    });
  });

  it("invalidates original and retained carriers when a tool result is shortened", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const toolCall: ChatMessage = {
        role: "assistant", content: "",
        toolCalls: [{ id: "read-1", name: "read_synthetic", arguments: { page: 1 } }],
      };
      const latestAnswer = assistant();
      captureLocalNativeContinuation(latestAnswer, PRIVATE_STATE, identity);
      const history: ChatMessage[] = [
        { role: "user", content: "Inspect the synthetic result." },
        toolCall,
        { role: "tool", toolCallId: "read-1", content: "x".repeat(1_600) },
        latestAnswer,
      ];

      const compacted = compactAgenticMessages(history);

      expect(String(compacted[2]!.content)).toContain("[truncated");
      expect(compacted[1]!.toolCalls).toEqual(toolCall.toolCalls);
      expect(readLocalNativeContinuation(latestAnswer, identity)).toBeUndefined();
      expect(readLocalNativeContinuation(compacted[3]!, identity)).toBeUndefined();
    });
  });

  it("invalidates all original carriers when middle history is dropped", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const history: ChatMessage[] = [
        { role: "user", content: "Complete the calculation." },
        ...Array.from({ length: 26 }, (_, index) => assistant(`Synthetic step ${index}.`)),
      ];
      for (const message of history.slice(1)) captureLocalNativeContinuation(message, PRIVATE_STATE, identity);

      const compacted = compactAgenticMessages(history);

      expect(compacted.length).toBeLessThan(history.length);
      expect(compacted[0]!.content).toBe(history[0]!.content);
      expect(compacted.at(-1)!.content).toBe(history.at(-1)!.content);
      for (const message of [...history, ...compacted]) {
        expect(readLocalNativeContinuation(message, identity)).toBeUndefined();
      }
    });
  });

  it("invalidates retained reasoning after removing an orphan tool result", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const message = assistant();
      captureLocalNativeContinuation(message, PRIVATE_STATE, identity);
      const history: ChatMessage[] = [
        { role: "user", content: "Continue the calculation." },
        { role: "tool", toolCallId: "missing-call", content: "Synthetic orphan result." },
        message,
      ];

      const compacted = compactAgenticMessages(history);

      expect(compacted.map(item => item.role)).toEqual(["user", "assistant"]);
      expect(readLocalNativeContinuation(message, identity)).toBeUndefined();
      expect(readLocalNativeContinuation(compacted[1]!, identity)).toBeUndefined();
    });
  });
});

describe("local native continuation at screening boundaries", () => {
  it("cannot revive an original loop carrier after its compaction clone was masked", async () => {
    await withLocalNativeContinuation(async () => {
      const original = assistant();
      const history: ChatMessage[] = [{ role: "user", content: "Draft for synthetic@example.com." }, original];
      captureLocalNativeContinuation(original, PRIVATE_STATE, binding());
      const assembled = compactAgenticMessages(history);
      expect(localNativeContinuationChars(assembled[1]!)).toBe(PRIVATE_STATE.length);
      createRoutedInferenceScreen({ messages: assembled, systemPrompt: SYSTEM_PROMPT,
        taskType: "conversation", routeContext: { sensitivity: "internal" }, sensitiveDetailUse: "replaceable" });
      expect(localNativeContinuationChars(original)).toBe(0);
      expect(localNativeContinuationChars(compactAgenticMessages(history)[1]!)).toBe(0);
    });
  });

  it.each(["assetVersion", "classificationVersion", "authorityVersion", "policyBundleVersion"] as const)(
    "discards prior private state when live %s changes, including final dispatch rescreening", async key => {
      await withLocalNativeContinuation(async () => {
        const versions = { assetVersion: "a1", classificationVersion: "c1", authorityVersion: "u1", policyBundleVersion: "p1" };
        const message = assistant();
        const input = { messages: [message], systemPrompt: SYSTEM_PROMPT, taskType: "conversation",
          policyVersionSource: () => ({ ...versions }) };
        screenInferencePayload(input);
        captureLocalNativeContinuation(message, PRIVATE_STATE, binding());
        const alias = transferLocalNativeContinuation(message, { ...message });
        screenInferencePayload({ ...input, messages: [message, { role: "user", content: "Continue the calculation." }] });
        expect(localNativeContinuationChars(message)).toBe(PRIVATE_STATE.length);
        versions[key] += "-changed";
        const refreshed = screenInferencePayload(input);
        expect(localNativeContinuationChars(message)).toBe(0);
        expect(localNativeContinuationChars(alias)).toBe(0);
        expect(refreshed.receipt.inputHash).toBe(classify([message]).receipt.inputHash);
        expect(JSON.stringify(refreshed.receipt)).not.toContain(PRIVATE_STATE);
      });
    },
  );

  it("does not confuse a new payload hash with a screening policy change", async () => {
    await withLocalNativeContinuation(async () => {
      const message = assistant();
      const input = { messages: [message], systemPrompt: SYSTEM_PROMPT, taskType: "conversation" };
      screenInferencePayload(input);
      captureLocalNativeContinuation(message, PRIVATE_STATE, binding());
      const first = screenInferencePayload(input);
      const second = screenInferencePayload({ ...input, messages: [message, { role: "user", content: "Verify the sum." }] });
      expect(second.receipt.inputHash).not.toBe(first.receipt.inputHash);
      expect(localNativeContinuationChars(message)).toBe(PRIVATE_STATE.length);
    });
  });

  it("changes the payload digest for distinct private states while leaving receipts and JSON raw-free", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const first = assistant();
      const second = assistant();
      captureLocalNativeContinuation(first, PRIVATE_STATE, identity);
      captureLocalNativeContinuation(second, PRIVATE_STATE.replace("0123456789", "9876543210"), identity);

      const firstScreen = classify([first]);
      const secondScreen = classify([second]);

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
      expect(firstScreen.receipt.inputHash).not.toBe(secondScreen.receipt.inputHash);
      expect(firstScreen.receipt.rawPayloadStored).toBe(false);
      expect(firstScreen.dataClasses).toEqual(secondScreen.dataClasses);
      expect(firstScreen.matches).toEqual(secondScreen.matches);
      expect(JSON.stringify(firstScreen)).not.toContain(PRIVATE_STATE);
      expect(JSON.stringify(secondScreen)).not.toContain("SYNTHETIC_NATIVE_BOUNDARY_CALCULATION");
    });
  });

  it("keeps the payload digest stable when unchanged messages transfer the same private state", async () => {
    await withLocalNativeContinuation(async () => {
      const original = assistant();
      captureLocalNativeContinuation(original, PRIVATE_STATE, binding());
      const projection = transferLocalNativeContinuation(original, { ...original });

      expect(classify([projection]).receipt.inputHash).toBe(classify([original]).receipt.inputHash);
      expect(localNativeContinuationChars(projection)).toBe(PRIVATE_STATE.length);
      expect(JSON.stringify(classify([projection]).receipt)).not.toContain(PRIVATE_STATE);
    });
  });

  it("returns to the ordinary digest after the owning invocation closes", async () => {
    const message = assistant();
    const ordinaryHash = classify([message]).receipt.inputHash;
    await withLocalNativeContinuation(async () => {
      captureLocalNativeContinuation(message, PRIVATE_STATE, binding());
      expect(classify([message]).receipt.inputHash).not.toBe(ordinaryHash);
    });
    expect(classify([message]).receipt.inputHash).toBe(ordinaryHash);
    expect(JSON.stringify(classify([message]))).not.toContain(PRIVATE_STATE);
  });

  it("preserves an unmasked routed payload and its continuation-aware receipt", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const message = assistant();
      captureLocalNativeContinuation(message, PRIVATE_STATE, identity);
      const routed = createRoutedInferenceScreen({
        messages: [message], systemPrompt: SYSTEM_PROMPT,
        taskType: "conversation", routeContext: { sensitivity: "internal" },
      });

      expect(routed.screen.receipt.transformation).toBe("none");
      expect(readLocalNativeContinuation(routed.screenInput.messages[0]!, identity)).toBe(PRIVATE_STATE);
      expect(routed.screen.receipt.inputHash).toBe(classify([message]).receipt.inputHash);
      expect(JSON.stringify(routed.screen.receipt)).not.toContain(PRIVATE_STATE);
    });
  });

  it("erases original and projected continuations before masking and recomputes the dispatch receipt", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const message = assistant();
      captureLocalNativeContinuation(message, PRIVATE_STATE, identity);
      const routed = createRoutedInferenceScreen({
        messages: [{ role: "user", content: "Draft a greeting for synthetic@example.com." }, message],
        systemPrompt: SYSTEM_PROMPT, taskType: "conversation",
        routeContext: { sensitivity: "internal" }, sensitiveDetailUse: "replaceable",
      });

      expect(routed.screen.receipt.transformation).toBe("tokenized");
      expect(JSON.stringify(routed.screenInput)).not.toContain("synthetic@example.com");
      expect(JSON.stringify(routed.screenInput)).not.toContain(PRIVATE_STATE);
      expect(JSON.stringify(routed.screen.receipt)).not.toContain(PRIVATE_STATE);
      expect(readLocalNativeContinuation(message, identity)).toBeUndefined();
      expect(localNativeContinuationChars(routed.screenInput.messages[1]!)).toBe(0);
      expect(routed.screen.receipt.inputHash).toBe(classify(routed.screenInput.messages).receipt.inputHash);
    });
  });

  it("does not attach discarded private state to a replacement payload during rescreening", async () => {
    await withLocalNativeContinuation(async () => {
      const identity = binding();
      const original = assistant();
      captureLocalNativeContinuation(original, PRIVATE_STATE, identity);
      const routed = createRoutedInferenceScreen({
        messages: [original], systemPrompt: SYSTEM_PROMPT,
        taskType: "conversation", routeContext: { sensitivity: "internal" },
      });
      const replacement = { ...original, content: "A revised synthetic answer." };

      const rescreened = rescreenRoutedInferencePayload(routed.screenInput, { messages: [replacement] });

      expect(readLocalNativeContinuation(rescreened.screenInput.messages[0]!, identity)).toBeUndefined();
      expect(rescreened.receipt.inputHash).not.toBe(routed.screen.receipt.inputHash);
      expect(rescreened.receipt.inputHash).toBe(classify([replacement]).receipt.inputHash);
      expect(JSON.stringify(rescreened)).not.toContain(PRIVATE_STATE);
    });
  });
});
