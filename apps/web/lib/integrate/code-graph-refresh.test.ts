import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-provider-types", () => ({
  computeNextRunAt: vi.fn().mockReturnValue(new Date("2026-04-19T12:15:00.000Z")),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledJob: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: {
    send: vi.fn(),
  },
}));

import { prisma } from "@dpf/db";
import { inngest } from "@/lib/queue/inngest-client";
import {
  CODE_GRAPH_EVENT_NAME,
  CODE_GRAPH_GRAPH_KEY,
  CODE_GRAPH_JOB_ID,
  planCodeGraphRefresh,
  queueCodeGraphReconcile,
  registerCodeGraphScheduledJob,
} from "./code-graph-refresh";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.scheduledJob.upsert).mockResolvedValue({} as never);
  vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);
});

describe("planCodeGraphRefresh", () => {
  it("returns noop when the indexed head already matches HEAD", () => {
    const result = planCodeGraphRefresh({
      currentHeadSha: "abc123",
      lastIndexedHeadSha: "abc123",
      changedFiles: ["apps/web/lib/integrate/change-impact.ts"],
      diffFailed: false,
      forceFull: false,
    });

    expect(result.mode).toBe("noop");
    expect(result.changedFiles).toEqual([]);
  });

  it("returns incremental when HEAD changed and tracked files changed", () => {
    const result = planCodeGraphRefresh({
      currentHeadSha: "def456",
      lastIndexedHeadSha: "abc123",
      changedFiles: [
        "apps/web/lib/integrate/change-impact.ts",
        "packages/db/prisma/schema.prisma",
      ],
      diffFailed: false,
      forceFull: false,
    });

    expect(result.mode).toBe("incremental");
    expect(result.changedFiles).toEqual([
      "apps/web/lib/integrate/change-impact.ts",
      "packages/db/prisma/schema.prisma",
    ]);
  });

  it("returns full when there is no prior indexed head", () => {
    const result = planCodeGraphRefresh({
      currentHeadSha: "def456",
      lastIndexedHeadSha: null,
      changedFiles: ["apps/web/lib/integrate/change-impact.ts"],
      diffFailed: false,
      forceFull: false,
    });

    expect(result.mode).toBe("full");
  });

  it("returns full when diff computation failed", () => {
    const result = planCodeGraphRefresh({
      currentHeadSha: "def456",
      lastIndexedHeadSha: "abc123",
      changedFiles: [],
      diffFailed: true,
      forceFull: false,
    });

    expect(result.mode).toBe("full");
  });
});

describe("registerCodeGraphScheduledJob", () => {
  it("upserts the every-15m scheduled job", async () => {
    await registerCodeGraphScheduledJob();

    expect(prisma.scheduledJob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { jobId: CODE_GRAPH_JOB_ID },
        create: expect.objectContaining({
          jobId: CODE_GRAPH_JOB_ID,
          name: "Code Graph Reconcile",
          schedule: "every-15m",
        }),
        update: expect.objectContaining({
          schedule: "every-15m",
        }),
      }),
    );
  });
});

describe("queueCodeGraphReconcile", () => {
  it("sends an Inngest event with graph metadata", async () => {
    await queueCodeGraphReconcile({
      reason: "git-commit",
      headSha: "abc123",
      branch: "main",
      graphKey: CODE_GRAPH_GRAPH_KEY,
    });

    expect(inngest.send).toHaveBeenCalledWith({
      name: CODE_GRAPH_EVENT_NAME,
      data: {
        reason: "git-commit",
        headSha: "abc123",
        branch: "main",
        graphKey: CODE_GRAPH_GRAPH_KEY,
      },
    });
  });
});
