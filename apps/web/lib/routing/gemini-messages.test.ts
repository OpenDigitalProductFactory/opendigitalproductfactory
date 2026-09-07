import { describe, expect, it } from "vitest";
import { formatMessagesForGemini } from "./gemini-messages";
import type { ChatMessage } from "../ai-inference";

describe("Gemini tool history", () => {
  it("preserves parallel call/result order and the signature on its original part", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "", toolCalls: [
        { id: "a", name: "read_a", arguments: { version: "v1" }, gemini: { modelId: "gemini-3", thoughtSignature: "opaque" } },
        { id: "b", name: "read_b", arguments: {}, gemini: { modelId: "gemini-3" } },
      ] },
      { role: "tool", toolCallId: "a", content: "first" },
      { role: "tool", toolCallId: "b", content: '{"success":false,"error":"approval_required","envelopeId":"approval-1"}' },
    ];
    const output = formatMessagesForGemini(messages, "gemini-3");
    expect(output).toEqual([
      { role: "model", parts: [
        { functionCall: { name: "read_a", args: { version: "v1" } }, thoughtSignature: "opaque" },
        { functionCall: { name: "read_b", args: {} } },
      ] },
      { role: "user", parts: [
        { functionResponse: { name: "read_a", response: { output: "first" } } },
        { functionResponse: { name: "read_b", response: { success: false, error: "approval_required", envelopeId: "approval-1" } } },
      ] },
    ]);
    expect(messages[0]!.toolCalls![0]!.arguments).toEqual({ version: "v1" });
  });

  it("transfers legacy/cross-provider evidence without inventing a native call id", () => {
    const output = formatMessagesForGemini([
      { role: "assistant", content: "", toolCalls: [{ id: "codex-local-id", name: "read_source", arguments: {} }] },
      { role: "tool", toolCallId: "codex-local-id", content: '{"source":"bound artifact"}' },
    ], "gemini-3");
    expect(output[0]!.parts[0]).toEqual({ functionCall: { name: "read_source", args: {} }, thoughtSignature: "context_engineering_is_the_way_to_go" });
    expect(output[1]!.parts[0]).toEqual({ functionResponse: { name: "read_source", response: { source: "bound artifact" } } });
  });

  it("refuses an orphaned result rather than dropping or misattributing its evidence", () => {
    expect(() => formatMessagesForGemini([{ role: "tool", toolCallId: "missing", content: "evidence" }], "gemini-3"))
      .toThrow("no preceding correlated call");
  });
});
