import { describe, expect, it } from "vitest";
import { assertResponsesCompleted } from "./responses-readiness";

describe("Responses readiness completion", () => {
  it("requires a completed inference, not merely HTTP 200 or a text delta", () => {
    expect(() => assertResponsesCompleted("", true)).toThrow();
    expect(() => assertResponsesCompleted('data: {"type":"response.output_text.delta","delta":"OK"}\n', true)).toThrow();
    expect(() => assertResponsesCompleted('data: {"type":"response.completed","response":{"status":"completed"}}\n', true)).not.toThrow();
  });
  it.each(["failed", "incomplete", "cancelled"])("rejects %s inference", (status) => {
    expect(() => assertResponsesCompleted(JSON.stringify({ status }), false)).toThrow();
    expect(() => assertResponsesCompleted(`data: ${JSON.stringify({ type: `response.${status}`, response: { status } })}\n`, true)).toThrow();
  });
  it("accepts completed JSON responses and rejects malformed payloads", () => {
    expect(() => assertResponsesCompleted('{"status":"completed"}', false)).not.toThrow();
    expect(() => assertResponsesCompleted("not json", false)).toThrow();
  });
});
