import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(false),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledJob: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    modelProvider: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai-provider-data", () => ({
  getProviders: vi.fn().mockResolvedValue([]),
  getTokenSpendByProvider: vi.fn().mockResolvedValue([]),
  getTokenSpendByAgent: vi.fn().mockResolvedValue([]),
  getScheduledJobs: vi.fn().mockResolvedValue([]),
  groupByEndpointTypeAndCategory: vi.fn().mockReturnValue([]),
  getProviderModelSummaries: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  syncProviderRegistry: vi.fn(),
  detectMcpServers: vi.fn().mockResolvedValue([]),
  runProviderCatalogReconciliationIfDue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/ollama", () => ({
  checkBundledProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/components/platform/DetectedServicesBanner", () => ({
  DetectedServicesBanner: () => <div>detected-services-banner</div>,
}));

vi.mock("@/components/platform/TokenSpendPanel", () => ({
  TokenSpendPanel: () => <div>token-spend-panel</div>,
}));

vi.mock("@/components/platform/ScheduledJobsTable", () => ({
  ScheduledJobsTable: () => <div>scheduled-jobs-table</div>,
}));

vi.mock("@/components/platform/SyncProvidersButton", () => ({
  SyncProvidersButton: () => <div>sync-providers-button</div>,
}));

vi.mock("@/components/platform/ServiceSection", () => ({
  ServiceSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/platform/ServiceRow", () => ({
  ServiceRow: () => <div>service-row</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ProvidersPage", () => {
  it("renders provider and routing content without MCP service operations or tool inventory", async () => {
    const { default: ProvidersPage } = await import("./page");
    const html = renderToStaticMarkup(await ProvidersPage());

    expect(html).toContain("Providers &amp; Routing");
    expect(html).toContain("detected-services-banner");
    expect(html).toContain("token-spend-panel");
    expect(html).toContain("scheduled-jobs-table");
    expect(html).not.toContain("Activated MCP Services");
    expect(html).not.toContain("Tool Inventory");
    expect(html).toContain('href="/platform/tools/services"');
  });
});
