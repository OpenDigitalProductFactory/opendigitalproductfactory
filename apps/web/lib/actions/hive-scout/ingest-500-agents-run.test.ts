import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    eaReferenceModelElement: {
      findMany: vi.fn(),
    },
    skillDefinition: {
      findMany: vi.fn(),
    },
    agent: {
      findMany: vi.fn(),
    },
    backlogItem: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    backlogItemActivity: {
      create: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    rawSource: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    platformConfig: {
      findUnique: vi.fn(),
    },
    digitalProduct: {
      findUnique: vi.fn(),
    },
    taxonomyNode: {
      findUnique: vi.fn(),
    },
  },
  loadPrompt: vi.fn(),
  sendQueueNotification: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/tak/prompt-loader", () => ({ loadPrompt: mocks.loadPrompt }));
vi.mock("@/lib/queue/notification-adapter", () => ({
  sendQueueNotification: mocks.sendQueueNotification,
}));

import { runHiveScoutIngest } from "./ingest-500-agents";

const SAMPLE_README = `# 500+ AI Agent Projects

## Use Case Table

| Use Case | Industry | Description | Code Github |
| --- | --- | --- | --- |
| **Threat Hunter Agent** | Cybersecurity | Investigates security telemetry. | [![GitHub](https://img.shields.io/badge/Code-GitHub-black)](https://github.com/example/threat-hunter) |
`;

describe("runHiveScoutIngest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prisma.eaReferenceModelElement.findMany.mockResolvedValue([{ name: "Operate" }]);
    mocks.prisma.skillDefinition.findMany.mockResolvedValue([]);
    mocks.prisma.agent.findMany.mockResolvedValue([]);
    mocks.prisma.backlogItem.findUnique.mockResolvedValue(null);
    mocks.prisma.backlogItem.create.mockResolvedValue({ id: "backlog-row-1", itemId: "HS-1" });
    mocks.prisma.backlogItemActivity.create.mockResolvedValue({ id: "activity-1" });
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.rawSource.upsert.mockResolvedValue({ id: "raw-fixed-id" });
    mocks.prisma.digitalProduct.findUnique.mockResolvedValue({ id: "dp-ai-workforce" });
    mocks.prisma.taxonomyNode.findUnique.mockResolvedValue({ id: "tn-workforce-services" });
    mocks.loadPrompt.mockResolvedValue("{{NAME}} {{SOURCE_URL}}");
  });

  it("writes backlog evidence for each created suggestion with task provenance when context is provided", async () => {
    await runHiveScoutIngest({
      fetcher: async () => SAMPLE_README,
      actorAgentId: "external-catalog-scout",
      taskRunId: "TR-SCHED-HIVE1",
    } as never);

    expect(mocks.prisma.backlogItem.create).toHaveBeenCalledOnce();
    expect(mocks.prisma.backlogItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        digitalProductId: "dp-ai-workforce",
        taxonomyNodeId: "tn-workforce-services",
      }),
    });
    expect(mocks.prisma.backlogItemActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        backlogItemId: "backlog-row-1",
        kind: "evidence",
        recordedByAgentId: "external-catalog-scout",
        payload: expect.objectContaining({
          taskRunId: "TR-SCHED-HIVE1",
          catalog: "500-AI-Agents-Projects",
          sourceUrl: "https://github.com/example/threat-hunter",
        }),
      }),
    });
  });
});

describe("runHiveScoutIngest — RawSource upsert", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prisma.eaReferenceModelElement.findMany.mockResolvedValue([{ name: "Operate" }]);
    mocks.prisma.skillDefinition.findMany.mockResolvedValue([]);
    mocks.prisma.agent.findMany.mockResolvedValue([]);
    mocks.prisma.backlogItem.findUnique.mockResolvedValue(null);
    mocks.prisma.backlogItem.create.mockResolvedValue({ id: "backlog-row-1", itemId: "HS-1" });
    mocks.prisma.backlogItemActivity.create.mockResolvedValue({ id: "activity-1" });
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.rawSource.findUnique.mockResolvedValue(null);
    mocks.prisma.rawSource.upsert.mockResolvedValue({ id: "raw-fixed-id" });
    mocks.prisma.platformConfig.findUnique.mockImplementation(async (args?: unknown) => {
      const key = (args as { where?: { key?: string } } | undefined)?.where?.key;
      return key === "hive-scout.market.enabled" ? { key, value: false } : null;
    });
    mocks.prisma.digitalProduct.findUnique.mockResolvedValue({ id: "dp-ai-workforce" });
    mocks.prisma.taxonomyNode.findUnique.mockResolvedValue({ id: "tn-workforce-services" });
    mocks.loadPrompt.mockResolvedValue("{{NAME}} {{SOURCE_URL}}");
  });

  it("upserts one RawSource per gap entry with the canonical sourceKey", async () => {
    await runHiveScoutIngest({
      fetcher: async () => SAMPLE_README,
      actorAgentId: "external-catalog-scout",
      taskRunId: "TR-SCHED-HIVE1",
    } as never);

    expect(mocks.prisma.rawSource.upsert).toHaveBeenCalledOnce();
    const [firstCall] = mocks.prisma.rawSource.upsert.mock.calls;
    expect(firstCall[0]).toMatchObject({
      where: { sourceKey: "hive-scout:500-ai-agents:github-com-example-threat-hunter" },
      create: expect.objectContaining({
        sourceType: "external-url",
        license: "MIT",
        title: "Threat Hunter Agent",
        url: "https://github.com/example/threat-hunter",
        organizationId: null,
        isKernel: false,
      }),
    });
    expect(firstCall[0].create.retrievedAt).toBeInstanceOf(Date);
  });

  it("surfaces rawSourceId on the BacklogItemActivity payload", async () => {
    await runHiveScoutIngest({
      fetcher: async () => SAMPLE_README,
      actorAgentId: "external-catalog-scout",
      taskRunId: "TR-SCHED-HIVE1",
    } as never);

    expect(mocks.prisma.backlogItemActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          rawSourceId: "raw-fixed-id",
        }),
      }),
    });
  });

  it("invokes upsert with the same sourceKey across two runs (idempotence by unique key)", async () => {
    await runHiveScoutIngest({ fetcher: async () => SAMPLE_README } as never);
    await runHiveScoutIngest({ fetcher: async () => SAMPLE_README } as never);

    const keys = mocks.prisma.rawSource.upsert.mock.calls.map(
      (call: unknown[]) => (call[0] as { where: { sourceKey: string } }).where.sourceKey,
    );
    expect(keys).toEqual([
      "hive-scout:500-ai-agents:github-com-example-threat-hunter",
      "hive-scout:500-ai-agents:github-com-example-threat-hunter",
    ]);
  });
});

describe("runHiveScoutIngest — market-aperture pass (BI-B8E4317D)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prisma.eaReferenceModelElement.findMany.mockResolvedValue([{ name: "Operate" }]);
    mocks.prisma.skillDefinition.findMany.mockResolvedValue([]);
    mocks.prisma.agent.findMany.mockResolvedValue([]);
    mocks.prisma.backlogItem.findUnique.mockResolvedValue(null);
    mocks.prisma.backlogItem.create.mockResolvedValue({ id: "backlog-row-1", itemId: "HS-1" });
    mocks.prisma.backlogItemActivity.create.mockResolvedValue({ id: "activity-1" });
    mocks.prisma.user.findMany.mockResolvedValue([]);
    mocks.prisma.rawSource.findUnique.mockResolvedValue(null);
    mocks.prisma.rawSource.upsert.mockResolvedValue({ id: "raw-fixed-id" });
    // Market pass ENABLED: no config rows -> defaults (enabled, seeded list).
    mocks.prisma.platformConfig.findUnique.mockResolvedValue(null);
    mocks.prisma.digitalProduct.findUnique.mockResolvedValue({ id: "dp-ai-workforce" });
    mocks.prisma.taxonomyNode.findUnique.mockResolvedValue({ id: "tn-workforce-services" });
    mocks.loadPrompt.mockResolvedValue("{{NAME}} {{SOURCE_URL}}");
  });

  it("fetches every default market source, cites a RawSource per source, and returns changed material", async () => {
    const fetchedUrls: string[] = [];
    const result = await runHiveScoutIngest({
      fetcher: async (url: string) => {
        fetchedUrls.push(url);
        if (url.includes("github")) return SAMPLE_README;
        return `<html><body><h1>Release notes</h1><p>New effortless flow for ${url}</p></body></html>`;
      },
    } as never);

    const market = result.marketSources;
    expect(market).toBeDefined();
    expect(market?.enabled).toBe(true);
    expect(market?.attempted).toBeGreaterThan(0);
    expect(market?.fetched).toBe(market?.attempted);
    expect(market?.failed).toBe(0);
    // First run: no prior locator hash, so every source counts as changed.
    expect(market?.changed).toBe(market?.attempted);
    expect(market?.material.length).toBe(market?.fetched);
    for (const item of market?.material ?? []) {
      expect(item.url).toMatch(/^https?:\/\//);
      expect(item.excerpt).toContain("Release notes");
      expect(item.excerpt).not.toContain("<");
    }
    // The catalog README fetch plus one fetch per market source.
    expect(fetchedUrls.length).toBe(1 + (market?.attempted ?? 0));

    const marketKeys = mocks.prisma.rawSource.upsert.mock.calls
      .map((call: unknown[]) => (call[0] as { where: { sourceKey: string } }).where.sourceKey)
      .filter((key: string) => key.startsWith("hive-scout:market:"));
    expect(marketKeys.length).toBe(market?.fetched);
  });

  it("marks a source unchanged when the stored locator hash matches, and captures per-source failures without failing the run", async () => {
    const { marketContentHash, extractMarketText, DEFAULT_MARKET_SOURCES } = await import("./market-sources");
    const stableBody = "<html><body>Stable content</body></html>";
    const stableHash = marketContentHash(extractMarketText(stableBody));
    mocks.prisma.rawSource.findUnique.mockResolvedValue({
      locator: { kind: "hive-scout-market", url: "x", contentHash: stableHash, fetchedAt: "2026-08-15T00:00:00.000Z" },
    });

    const failingUrl = DEFAULT_MARKET_SOURCES[0]!.url;
    const result = await runHiveScoutIngest({
      fetcher: async (url: string) => {
        if (url.includes("github")) return SAMPLE_README;
        if (url === failingUrl) throw new Error("HTTP 403");
        return stableBody;
      },
    } as never);

    const market = result.marketSources;
    expect(market?.failed).toBe(1);
    expect(market?.failures[0]).toMatchObject({ key: DEFAULT_MARKET_SOURCES[0]!.key, error: "HTTP 403" });
    expect(market?.changed).toBe(0);
    expect(market?.fetched).toBe((market?.attempted ?? 0) - 1);
    // Catalog result is untouched by market-source failures.
    expect(result.catalogEntries).toBe(1);
  });
});
