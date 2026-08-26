import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMetrics: vi.fn(),
  countCapabilities: vi.fn(),
}));

vi.mock("@/lib/tool-execution-data", () => ({
  getToolExecutionMetrics: mocks.getMetrics,
}));

vi.mock("@dpf/db", () => ({
  prisma: { platformCapability: { count: mocks.countCapabilities } },
}));

vi.mock("@/components/ui/report-kit", () => ({
  Notice: ({ children }: { children?: React.ReactNode }) => <aside data-report-notice>{children}</aside>,
  StatCard: ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div data-report-stat={`${label}:${String(value)}`} />
  ),
}));

vi.mock("./TopToolsTable", () => ({
  TopToolsTable: ({ rows }: { rows: unknown[] }) => <div data-top-tools-count={rows.length} />,
}));

import OperationalMetricsPage from "./page";

describe("OperationalMetricsPage", () => {
  it("composes theme-safe reporting primitives", async () => {
    mocks.countCapabilities.mockResolvedValue(1);
    mocks.getMetrics.mockResolvedValue({
      totalExecutions: 20,
      byAuditClass: { ledger: 8, journal: 2, metrics_only: 10 },
      successRate: 0.95,
      avgDurationMs: 721,
      recentErrorRate: 0.05,
      topTools: [{ toolName: "registry_read", count: 7, successRate: 1 }],
    });

    const html = renderToStaticMarkup(await OperationalMetricsPage());

    expect(html.match(/data-report-stat=/g)).toHaveLength(6);
    expect(html).toContain('data-report-notice="true"');
    expect(html).toContain('data-top-tools-count="1"');
    expect(html).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});
