import { describe, expect, it } from "vitest";
import { selectLoadableTools } from "./tool-intent";

describe("task-specific tool discovery", () => {
  const tools = [
    { name: "apply_account_handover", description: "Move platform account ownership during recovery." },
    { name: "report_quality_issue", description: "Report a platform issue." },
    { name: "request_self_upgrade", description: "Request a governed platform self upgrade." },
    { name: "get_self_upgrade_queue_status", description: "Read the self upgrade queue." },
    { name: "issue_organization_join_file", description: "Join an organization on this platform." },
  ];

  it("does not pad an upgrade search with unrelated platform tools", () => {
    const result = selectLoadableTools(tools, { query: "platform recovery broken self upgrade emergency procedure" });
    expect(result.map((tool) => tool.name)).toEqual([
      "request_self_upgrade", "get_self_upgrade_queue_status",
    ]);
  });

  it("retains exact-name access even when the query names a different task", () => {
    expect(selectLoadableTools(tools, { names: ["report_quality_issue"], query: "upgrade" })[0]?.name)
      .toBe("report_quality_issue");
  });

  it("preserves requested priority at the batch boundary", () => {
    expect(selectLoadableTools(tools, { names: ["request_self_upgrade", "report_quality_issue"] }, 1)[0]?.name)
      .toBe("request_self_upgrade");
  });

  it("never invents a tool outside the authorized pool", () => {
    expect(selectLoadableTools([], { names: ["request_self_upgrade"], query: "upgrade" })).toEqual([]);
  });
});
