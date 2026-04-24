import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ToolExecutionLogClient } from "./ToolExecutionLogClient";

describe("ToolExecutionLogClient", () => {
  it("shows the GAID identity reference when present", () => {
    const html = renderToStaticMarkup(
      <ToolExecutionLogClient
        executions={[
          {
            id: "exec-1",
            threadId: "thread-1",
            agentId: "hr-specialist",
            agentIdentityRef: "gaid:priv:dpf.internal:hr-specialist",
            userId: "user-1",
            toolName: "create_backlog_item",
            parameters: {},
            result: {},
            success: true,
            executionMode: "immediate",
            routeContext: "/employee",
            durationMs: 100,
            createdAt: "2026-04-23T00:00:00.000Z",
            auditClass: "ledger",
            capabilityId: "backlog:write",
            summary: null,
          },
        ]}
      />,
    );

    expect(html).toContain("gaid:priv:dpf.internal:hr-specialist");
  });
});
