// BI-E7974C18 — AC-RELEASE-VISIBLE: after a release, the new serving process
// writes exactly one agent-toolchain notification per released pack digest,
// listing the clients that are behind. A restart without a release writes nothing.
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { TOOLCHAIN_NOTIFICATION_CATEGORY, announceToolchainRelease, toolchainSubjectId } from "./announce-release";
import type { ToolchainObservationRow } from "./fleet-readiness";

const NEW_DIGEST = "1111111111111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD_DIGEST = "2222222222222222bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const published = (packDigest: string, packVersion = "0.4.0") => ({
  packVersion,
  packDigest,
  floor: { minPackVersion: null, graceStartsAt: null },
});
const now = new Date("2026-10-13T12:00:00Z");

type FakeNoticeRow = { id: string; category: string; subjectId: string | null; message: string; severity: string; createdAt: Date; resolvedAt: Date | null };

function fakeDb(observations: ToolchainObservationRow[] = [], existing: FakeNoticeRow[] = []) {
  const notifications: FakeNoticeRow[] = [...existing];
  let seq = 0;
  const db = {
    notifications,
    $executeRaw: vi.fn(async () => 0),
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    platformNotification: {
      findFirst: vi.fn(async ({ where }: { where: { category: string } }) => {
        const rows = notifications.filter((n) => n.category === where.category);
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<FakeNoticeRow, "id" | "createdAt" | "resolvedAt"> }) => {
        seq += 1;
        const row = { ...data, id: `n${seq}`, createdAt: new Date(now.getTime() + seq), resolvedAt: null };
        notifications.push(row);
        return row;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { category: string; resolvedAt: null; subjectId: { not: string } }; data: { resolvedAt: Date } }) => {
        let count = 0;
        for (const n of notifications) {
          if (n.category === where.category && n.resolvedAt === null && n.subjectId !== where.subjectId.not) {
            n.resolvedAt = data.resolvedAt;
            count += 1;
          }
        }
        return { count };
      }),
    },
    agentToolchainObservation: {
      findMany: vi.fn(async () => observations),
    },
    oAuthClient: { findMany: vi.fn(async () => []) },
    mcpApiToken: { findMany: vi.fn(async () => []) },
  };
  return db;
}

const observation = (over: Partial<ToolchainObservationRow>): ToolchainObservationRow => ({
  credentialRef: "oauth:client-1",
  loadedDigest: NEW_DIGEST.slice(0, 16),
  clientKind: "claude-code",
  probableClient: null,
  loadedPackVersion: "0.4.0",
  authMode: "oauth",
  clientInfoName: null,
  clientInfoVersion: null,
  lastObservedAt: new Date("2026-10-13T11:00:00Z"),
  ...over,
});

const input = (packDigest = NEW_DIGEST) => ({ published: published(packDigest), mcpEndpoint: "https://dpf.test/api/mcp/v1", now });

describe("announceToolchainRelease", () => {
  it("writes one notification for a new digest, listing the clients that are behind", async () => {
    const db = fakeDb([
      observation({ credentialRef: "oauth:current" }),
      observation({ credentialRef: "token:old", clientKind: "codex", loadedDigest: OLD_DIGEST.slice(0, 16), loadedPackVersion: "0.3.0", authMode: "bearer" }),
      observation({ credentialRef: "oauth:legacy", clientKind: "undeclared", loadedDigest: "undeclared", loadedPackVersion: null, probableClient: "grok" }),
    ]);

    const result = await announceToolchainRelease(db as never, input());

    expect(result).toMatchObject({ outcome: "announced", behind: 2 });
    expect(db.notifications).toHaveLength(1);
    const [note] = db.notifications;
    expect(note).toMatchObject({ category: TOOLCHAIN_NOTIFICATION_CATEGORY, subjectId: toolchainSubjectId(NEW_DIGEST), severity: "warning" });
    expect(note!.message).toContain("0.4.0");
    expect(note!.message).toContain("Codex");
    expect(note!.message).toContain("Grok");
    expect(note!.message).not.toContain("Claude Code");
    // Plain words: no raw digest in what a person reads.
    expect(note!.message).not.toContain(NEW_DIGEST.slice(0, 16));
  });

  it("is idempotent per digest: a second boot (restart or second replica) writes nothing", async () => {
    const db = fakeDb([observation({ credentialRef: "token:old", loadedDigest: OLD_DIGEST.slice(0, 16), loadedPackVersion: "0.3.0" })]);

    await announceToolchainRelease(db as never, input());
    const second = await announceToolchainRelease(db as never, input());

    expect(second.outcome).toBe("already-announced");
    expect(db.notifications).toHaveLength(1);
    expect(db.platformNotification.create).toHaveBeenCalledTimes(1);
  });

  it("writes nothing on a restart without a release", async () => {
    const db = fakeDb([], [
      { id: "prior", category: TOOLCHAIN_NOTIFICATION_CATEGORY, subjectId: toolchainSubjectId(NEW_DIGEST), message: "earlier", severity: "info", createdAt: new Date("2026-10-10T00:00:00Z"), resolvedAt: null },
    ]);

    const result = await announceToolchainRelease(db as never, input());

    expect(result.outcome).toBe("already-announced");
    expect(db.platformNotification.create).not.toHaveBeenCalled();
    expect(db.platformNotification.updateMany).not.toHaveBeenCalled();
    expect(db.agentToolchainObservation.findMany).not.toHaveBeenCalled();
  });

  it("resolves the previous release's notification when a new digest is announced", async () => {
    const db = fakeDb([], [
      { id: "prior", category: TOOLCHAIN_NOTIFICATION_CATEGORY, subjectId: toolchainSubjectId(OLD_DIGEST), message: "earlier", severity: "warning", createdAt: new Date("2026-10-10T00:00:00Z"), resolvedAt: null },
    ]);

    const result = await announceToolchainRelease(db as never, input());

    expect(result).toMatchObject({ outcome: "announced", behind: 0 });
    expect(db.notifications.find((n) => n.id === "prior")!.resolvedAt).toEqual(now);
    const fresh = db.notifications.find((n) => n.subjectId === toolchainSubjectId(NEW_DIGEST))!;
    expect(fresh.resolvedAt).toBeNull();
    expect(fresh.severity).toBe("info");
    expect(fresh.message).toContain("Every connected agent client");
  });

  it("serialises concurrent boots with a transaction-scoped lock", async () => {
    const db = fakeDb();
    await announceToolchainRelease(db as never, input());
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
