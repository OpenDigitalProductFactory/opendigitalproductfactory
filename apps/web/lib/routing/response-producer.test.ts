import { describe, expect, it } from "vitest";
import { createResponseProducer, preserveResponseProducer, responseContentDigest } from "./response-producer";
const input = { attemptId: "attempt-1", providerId: "openai", modelId: "actual", content: "Verified answer" };
describe("response producer preservation", () => {
  it("keeps trim-only formatting while the saved-byte digest remains exact", () => {
    const producer = createResponseProducer({ ...input, content: "  Verified answer\n" });
    expect(preserveResponseProducer(producer, "Verified answer", input)).toEqual(producer);
    expect(responseContentDigest("Verified answer ")).not.toBe(responseContentDigest("Verified answer"));
  });
  it("does not credit material replacement or a different provider/model", () => {
    const producer = createResponseProducer(input);
    expect(preserveResponseProducer(producer, "Synthetic fallback", input)).toBeUndefined();
    expect(preserveResponseProducer(producer, input.content, { ...input, modelId: "different" })).toBeUndefined();
    expect(preserveResponseProducer(producer, input.content, { ...input, providerId: "different" })).toBeUndefined();
  });
  it("does not bind blank or missing output", () => {
    expect(createResponseProducer({ ...input, content: "  " })).toBeUndefined();
    expect(preserveResponseProducer(undefined, input.content, input)).toBeUndefined();
  });
});
