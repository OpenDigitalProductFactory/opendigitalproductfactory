import { expect, it } from "vitest";
import { governedExecuteTool } from "./mcp-governed-execute";

export function registerWorkroomAliasCases(evidence: {
  executionCalls: () => unknown[][];
  auditRows: () => Record<string, unknown>[];
}): void {
  it.each(["create_workroom", "create_work_capsule"])("preserves capability denial for %s", async (toolName) => {
    const result = await governedExecuteTool({
      toolName, rawParams: {}, userId: "u",
      userContext: { platformRole: "viewer", isSuperuser: false }, source: "rest",
    });
    expect(result.error).toBe("forbidden_capability");
    expect(evidence.executionCalls()).toHaveLength(0);
  });
  it("resolves a held Workroom alias before governance and dispatch", async () => {
    const result = await governedExecuteTool({
      toolName: "list_work_capsules", rawParams: { limit: 5 }, userId: "u",
      userContext: { platformRole: "ceo", isSuperuser: true }, source: "external-jsonrpc",
    });
    expect(result.success).toBe(true);
    expect(evidence.executionCalls()[0]?.[0]).toBe("list_workrooms");
    expect(evidence.auditRows()[0]?.toolName).toBe("list_workrooms");
  });
}
