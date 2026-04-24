// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ToolExecutionLogClient } from "./ToolExecutionLogClient";

async function renderClient(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(element);
  });

  const html = container.innerHTML;

  await act(async () => {
    root.unmount();
  });

  container.remove();
  return html;
}

describe("ToolExecutionLogClient", () => {
  it("shows the GAID identity reference when present", async () => {
    const html = await renderClient(
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
