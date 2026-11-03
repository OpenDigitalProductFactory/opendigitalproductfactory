import { describe, expect, it } from "vitest";
import { completeAgenticResult } from "./agentic-result";
import { createResponseProducer } from "../routing/response-producer";
const source = { providerId: "openai", modelId: "actual", downgraded: false, downgradeMessage: null,
  responseProducer: createResponseProducer({ attemptId: "earlier", providerId: "openai", modelId: "actual", content: "Earlier complete answer" }) };
const context = { totalInputTokens: 20, totalOutputTokens: 10, executedTools: [], suppliedSourceEvidence: true };
describe("agentic completion provenance", () => {
  it("preserves the explicit earlier draft source rather than a later call", () => {
    expect(completeAgenticResult("Earlier complete answer", source, context).responseProducer?.attemptId).toBe("earlier");
  });
  it("clears synthetic output, absent source and a failure even with identical text", () => {
    expect(completeAgenticResult("Approval pending", source, context).responseProducer).toBeUndefined();
    expect(completeAgenticResult("Earlier complete answer", source, context, { synthetic: true }).responseProducer).toBeUndefined();
    expect(completeAgenticResult("Earlier complete answer", null, context).responseProducer).toBeUndefined();
    expect(completeAgenticResult("Earlier complete answer", source, context, { failure: { kind: "policy-or-capability", message: "held" } }).responseProducer).toBeUndefined();
  });
});
