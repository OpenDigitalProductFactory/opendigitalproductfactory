import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { CLIENT_CAPABILITY_PROFILE } from "@dpf/integration-shared/client-capability-profile";

import { err, ok } from "@/lib/shared/action-result";

import { executeClientCapabilityReverifyTask } from "./client-capability-reverify-task";

// BI-64795FD0: the executor keeps its state beside any other task config,
// files through the intake, and reports a failed source as an error run.

function fakeDb(reports: Array<{ clientKind: string; detail: unknown }> = []) {
  return {
    agentSurfaceReadiness: { findMany: vi.fn(async () => reports) },
    backlogItem: { findFirst: vi.fn(async () => null) },
    backlogItemActivity: { create: vi.fn(async () => ({})) },
    platformNotification: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 0 })) },
    scheduledAgentTask: { update: vi.fn(async () => ({})) },
    scheduledJob: { update: vi.fn(async () => ({})) },
  };
}

const task = { taskId: "client-capability-reverify-weekly", schedule: "17 4 * * 2", agentId: "AGT-WS-EA", taskConfig: { operatorNote: "keep" } };
const now = new Date("2026-10-13T04:17:00Z");

describe("executeClientCapabilityReverifyTask", () => {
  it("files a proposal for a reported CLI version newer than verified and keeps other config", async () => {
    const db = fakeDb([{ clientKind: "codex", detail: { cliVersion: "0.160.0" } }]);
    const ingest = vi.fn(async () => ({ itemId: "BI-C1", id: "cuid-1", created: true }));
    const result = await executeClientCapabilityReverifyTask(task, {
      now,
      db: db as never,
      ingest,
      fetchSource: async () => ok("<p>A release note line.</p>"),
    });
    expect(result!.filed).toEqual([{ clientKind: "codex", itemId: "BI-C1", created: true }]);
    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      origin: { kind: "client-capability", id: "codex@0.160.0" },
      agentId: "AGT-WS-EA",
    }));
    const update = (db.scheduledAgentTask.update.mock.calls as unknown as Array<[unknown]>)[0]![0] as { data: { lastStatus: string; taskConfig: Record<string, unknown> } };
    expect(update.data.lastStatus).toBe("proposed");
    expect(update.data.taskConfig.operatorNote).toBe("keep");
    expect(Object.keys((update.data.taskConfig.clientCapability as { clients: object }).clients).sort())
      .toEqual(Object.keys(CLIENT_CAPABILITY_PROFILE.clients).sort());
  });

  it("records a failed source as an error run with the reason", async () => {
    const db = fakeDb();
    await executeClientCapabilityReverifyTask(task, {
      now,
      db: db as never,
      ingest: vi.fn(),
      fetchSource: async () => err("HTTP 503"),
    });
    const update = (db.scheduledAgentTask.update.mock.calls as unknown as Array<[unknown]>)[0]![0] as { data: { lastStatus: string; lastError: string } };
    expect(update.data.lastStatus).toBe("error");
    expect(update.data.lastError).toContain("HTTP 503");
    expect(db.platformNotification.create).not.toHaveBeenCalled();
  });
});
