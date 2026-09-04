import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AsyncOpRow } from "@/lib/ai-provider-types";
import { ASYNC_INFERENCE_OPERATION_STATUSES } from "@/lib/inference/async-operation-contract";

import { AsyncOperationsTable } from "./AsyncOperationsTable";

function operation(status: AsyncOpRow["status"]): AsyncOpRow {
  return {
    id: `op-${status}`,
    providerId: "gemini",
    modelId: "gemini-3.1-pro",
    contractFamily: "research",
    status,
    progressPct: status === "running" ? 42 : null,
    progressMessage: null,
    errorMessage: status === "failed" ? "Provider rejected the request" : null,
    createdAt: "2026-09-04T12:00:00.000Z",
    startedAt: null,
    completedAt: null,
    expiresAt: "2026-09-04T13:00:00.000Z",
  };
}

describe("AsyncOperationsTable", () => {
  it("renders every canonical lifecycle status explicitly", () => {
    const html = renderToStaticMarkup(
      <AsyncOperationsTable
        operations={ASYNC_INFERENCE_OPERATION_STATUSES.map(operation)}
      />,
    );

    expect(html).toContain("Start needs reconciliation");
    expect(html).toContain("Pending");
    expect(html).toContain("Running");
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
    expect(html).toContain("Cancelled");
    expect(html).toContain("Expired");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="42"');
  });

  it("labels a future expiry as future time rather than elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T12:00:00.000Z"));
    try {
      const html = renderToStaticMarkup(
        <AsyncOperationsTable operations={[operation("pending")]} />,
      );
      expect(html).toContain("expires in 1h");
      expect(html).not.toContain("expires 1h ago");
    } finally {
      vi.useRealTimers();
    }
  });
});
