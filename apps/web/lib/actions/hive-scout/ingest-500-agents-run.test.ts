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
      upsert: vi.fn(),
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
    mocks.loadPrompt.mockResolvedValue("{{NAME}} {{SOURCE_URL}}");
  });

  it("writes backlog evidence for each created suggestion with task provenance when context is provided", async () => {
    await runHiveScoutIngest({
      fetcher: async () => SAMPLE_README,
      actorAgentId: "external-catalog-scout",
      taskRunId: "TR-SCHED-HIVE1",
    } as never);

    expect(mocks.prisma.backlogItem.create).toHaveBeenCalledOnce();
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
    mocks.prisma.rawSource.upsert.mockResolvedValue({ id: "raw-fixed-id" });
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
