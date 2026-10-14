import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-05715F4C: the runtime's MCP handlers. approve_runtime_permission answers
// only a room session credential, for that credential's own room.

const { db, supervisor } = vi.hoisted(() => ({
  db: { mcpApiToken: { findUnique: vi.fn() } },
  supervisor: {
    start: vi.fn(async () => ({ success: true, message: "open" })),
    turn: vi.fn(async () => ({ success: true, message: "started" })),
    decide: vi.fn(async () => ({ success: true, message: "decided" })),
    claudePermission: vi.fn(async () => ({ behavior: "allow", updatedInput: { a: 1 } })),
    status: vi.fn(() => ({ live: false })),
  },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));
vi.mock("./supervisor", () => ({ createRuntimeSupervisor: () => supervisor }));
vi.mock("@/lib/work-capsules/handler-actor", () => ({ workCapsuleActor: async (userId: string) => ({ userId, agentId: null, principalId: null }) }));
vi.mock("@/lib/inference/codex-cli-catalog-auth", () => ({ resolveCodexCatalogAuth: vi.fn() }));
vi.mock("@/lib/routing/cli-adapter", () => ({ resolveCliAuth: vi.fn() }));

import { approveRuntimePermissionTool, driveWorkroomRuntimeTool } from "./runtime-tools";

beforeEach(() => vi.clearAllMocks());

describe("drive_workroom_runtime", () => {
  it("validates its input and routes each action", async () => {
    await expect(driveWorkroomRuntimeTool({ capsuleId: "WC-1", action: "fly" }, "u1", undefined)).resolves.toMatchObject({ error: "invalid_input" });
    await expect(driveWorkroomRuntimeTool({ capsuleId: "WC-1", action: "start", provider: "gemini" }, "u1", undefined)).resolves.toMatchObject({ error: "invalid_input" });
    await driveWorkroomRuntimeTool({ capsuleId: "WC-1", action: "start", provider: "codex", prompt: "go" }, "u1", undefined);
    expect(supervisor.start).toHaveBeenCalledWith(expect.objectContaining({ capsuleId: "WC-1", provider: "codex", prompt: "go" }));
    await driveWorkroomRuntimeTool({ capsuleId: "WC-1", action: "steer", prompt: "more" }, "u1", undefined);
    expect(supervisor.turn).toHaveBeenCalledWith({ capsuleId: "WC-1", prompt: "more", steer: true });
    await expect(driveWorkroomRuntimeTool({ capsuleId: "WC-1", action: "decide", requestId: "r", decision: "maybe" }, "u1", undefined))
      .resolves.toMatchObject({ error: "invalid_input" });
  });
});

describe("approve_runtime_permission", () => {
  it("answers for the room the calling session credential is bound to", async () => {
    db.mcpApiToken.findUnique.mockResolvedValue({ kind: "workroom_session", workroomRef: "WC-1", revokedAt: null });
    const result = await approveRuntimePermissionTool({ tool_name: "Edit", input: { a: 1 } }, "u1", { apiTokenId: "tok-1" });
    expect(supervisor.claudePermission).toHaveBeenCalledWith({ capsuleId: "WC-1", toolName: "Edit", toolInput: { a: 1 } });
    expect(result.data).toEqual({ behavior: "allow", updatedInput: { a: 1 } });
  });

  it("denies any caller that is not a live room session", async () => {
    for (const token of [null, { kind: "operator", workroomRef: null, revokedAt: null }, { kind: "workroom_session", workroomRef: "WC-1", revokedAt: new Date() }]) {
      db.mcpApiToken.findUnique.mockResolvedValueOnce(token);
      const result = await approveRuntimePermissionTool({ tool_name: "Edit", input: {} }, "u1", { apiTokenId: "tok-1" });
      expect(result.data).toMatchObject({ behavior: "deny" });
    }
    expect(supervisor.claudePermission).not.toHaveBeenCalled();
  });
});
