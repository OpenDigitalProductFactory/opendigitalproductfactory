import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CapabilityJournalClient } from "./CapabilityJournalClient";
import type { ToolExecutionRow } from "@/lib/tool-execution-data";

const execution: ToolExecutionRow = {
  id: "tool-exec-2",
  threadId: "thread-2",
  agentId: "build-specialist",
  agentIdentityRef: "gaid:priv:dpf.internal:build-specialist",
  userId: "user-1",
  toolName: "run_sandbox_tests",
  parameters: { buildId: "BUILD-1" },
  result: { success: true },
  success: true,
  executionMode: "immediate",
  routeContext: "/build",
  durationMs: 1200,
  createdAt: "2026-05-20T16:00:00.000Z",
  auditClass: "ledger",
  capabilityId: "build:verify",
  summary: null,
};

describe("CapabilityJournalClient", () => {
  it("expands the execution referenced by an Agent Card receipt link", () => {
    const html = renderToStaticMarkup(
      <CapabilityJournalClient
        executions={[execution]}
        initialFocusExecutionId="tool-exec-2"
      />,
    );

    expect(html).toContain("Parameters");
    expect(html).toContain("BUILD-1");
    expect(html).toContain("Thread: ");
    expect(html).toContain("thread-2");
  });
});
