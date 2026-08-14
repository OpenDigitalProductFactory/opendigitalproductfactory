import { describe, expect, it } from "vitest";

import { classifyConsequentialTool } from "./consequential-tool-policy";

describe("consequential tool policy", () => {
  it("classifies a read without invoking model judgement", () => {
    expect(classifyConsequentialTool({ toolName: "query_backlog", tool: { sideEffect: false } })).toEqual({
      class: "routine-read",
      consequential: false,
      alignmentRequired: false,
      reason: "read-only",
    });
  });

  it("classifies an explicit business-direction mutation as consequential", () => {
    expect(classifyConsequentialTool({
      toolName: "create_digital_product",
      tool: { sideEffect: true },
    }).consequential).toBe(true);
  });

  it("does not charge ordinary bookkeeping mutations for an alignment check", () => {
    expect(classifyConsequentialTool({
      toolName: "update_backlog_item_status",
      tool: { sideEffect: true },
    }).class).toBe("ordinary-mutation");
  });
});
