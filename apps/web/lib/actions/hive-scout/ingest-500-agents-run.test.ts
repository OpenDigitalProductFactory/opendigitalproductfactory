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
