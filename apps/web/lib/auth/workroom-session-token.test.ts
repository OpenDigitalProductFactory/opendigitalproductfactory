import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// BI-05715F4C: a Workroom's runtime session credential is the room's: it
// resolves only for a live room, only as itself, and cannot name another room.

const { db } = vi.hoisted(() => ({
  db: {
    mcpApiToken: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(async () => ({})), updateMany: vi.fn() },
    workroom: { findUnique: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => ({ prisma: db }));

import {
  WORKROOM_SESSION_SCOPES,
  issueWorkroomSessionToken,
  resolveWorkroomSessionToken,
  revokeWorkroomSessionTokens,
  workroomBindingRefusal,
} from "./workroom-session-token";

const NOW = new Date("2026-10-14T12:00:00.000Z");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const row = (over: Record<string, unknown> = {}) => ({
  id: "tok-1", userId: "user-1", agentId: null, kind: "workroom_session", workroomRef: "WC-1", runRef: "TR-1",
  scopes: [...WORKROOM_SESSION_SCOPES], revokedAt: null, expiresAt: new Date(NOW.getTime() + 60_000), ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.mcpApiToken.create.mockResolvedValue({ id: "tok-1" });
  db.workroom.findUnique.mockResolvedValue({ status: "working", archivedAt: null });
});

describe("issueWorkroomSessionToken", () => {
  it("stores only the hash, binds the room and run, and expires after a day idle", async () => {
    const { tokenId, plaintext } = await issueWorkroomSessionToken({ userId: "user-1", agentId: null, capsuleId: "WC-1", runRef: "TR-1", now: NOW });
    expect(tokenId).toBe("tok-1");
    expect(plaintext).toMatch(/^dpfroom_/);
    const data = db.mcpApiToken.create.mock.calls[0]?.[0]?.data;
    expect(data).toMatchObject({ kind: "workroom_session", workroomRef: "WC-1", runRef: "TR-1", tokenHash: sha(plaintext),
      expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000), scopes: [...WORKROOM_SESSION_SCOPES] });
    expect(JSON.stringify(data)).not.toContain(plaintext);
  });
});

describe("resolveWorkroomSessionToken", () => {
  it("resolves a live room's token with its binding and slides its idle expiry", async () => {
    db.mcpApiToken.findUnique.mockResolvedValue(row());
    await expect(resolveWorkroomSessionToken("dpfroom_abc", NOW)).resolves.toMatchObject({ tokenId: "tok-1", workroomRef: "WC-1", runRef: "TR-1", scope: "write" });
    expect(db.mcpApiToken.findUnique).toHaveBeenCalledWith({ where: { tokenHash: sha("dpfroom_abc") } });
    expect(db.mcpApiToken.update).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: { lastUsedAt: NOW, expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000) } });
  });

  it("refuses another prefix, another kind, a revoked or idle-expired token, and a token whose room ended", async () => {
    await expect(resolveWorkroomSessionToken("dpfmcp_abc", NOW)).resolves.toBeNull();
    for (const over of [{ kind: "operator" }, { revokedAt: NOW }, { expiresAt: new Date(NOW.getTime() - 1) }]) {
      db.mcpApiToken.findUnique.mockResolvedValueOnce(row(over));
      await expect(resolveWorkroomSessionToken("dpfroom_abc", NOW)).resolves.toBeNull();
    }
    db.mcpApiToken.findUnique.mockResolvedValue(row());
    db.workroom.findUnique.mockResolvedValueOnce({ status: "complete", archivedAt: null });
    await expect(resolveWorkroomSessionToken("dpfroom_abc", NOW)).resolves.toBeNull();
  });
});

describe("revocation and binding", () => {
  it("revokes the room's live session tokens, or just one", async () => {
    db.mcpApiToken.updateMany.mockResolvedValue({ count: 2 });
    await expect(revokeWorkroomSessionTokens({ capsuleId: "WC-1", reason: "stopped", now: NOW })).resolves.toBe(2);
    expect(db.mcpApiToken.updateMany).toHaveBeenCalledWith({
      where: { kind: "workroom_session", workroomRef: "WC-1", revokedAt: null },
      data: { revokedAt: NOW, revokedReason: "stopped" },
    });
    await revokeWorkroomSessionTokens({ capsuleId: "WC-1", reason: "x", tokenId: "tok-9" });
    expect(db.mcpApiToken.updateMany.mock.calls[1]?.[0]?.where).toMatchObject({ id: "tok-9" });
  });

  it("refuses a bound token's call that names another room, and leaves unbound tokens alone", () => {
    expect(workroomBindingRefusal({ workroomRef: "WC-1" }, { capsuleId: "WC-2" })).toMatchObject({ error: "workroom_scope_mismatch" });
    expect(workroomBindingRefusal({ workroomRef: "WC-1" }, { workroomId: "WC-2" })).toMatchObject({ error: "workroom_scope_mismatch" });
    expect(workroomBindingRefusal({ workroomRef: "WC-1" }, { capsuleId: "WC-1" })).toBeNull();
    expect(workroomBindingRefusal({ workroomRef: "WC-1" }, { itemId: "BI-1" })).toBeNull();
    expect(workroomBindingRefusal({}, { capsuleId: "WC-2" })).toBeNull();
  });
});
