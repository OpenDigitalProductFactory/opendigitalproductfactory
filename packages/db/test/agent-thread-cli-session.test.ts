import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "../src/client";

// Task A3 of the coworker execution adapter substrate:
//   docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md
//   docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md §4.2
//
// Adds 5 nullable cliSession* columns to AgentThread plus an index on
// cliSessionLastUsedAt. The CliSessionService (Phase C) reads/writes these
// fields to pin a thread to a single CLI session for plan/todo continuity,
// and a sweeper expires stale sessions via the cliSessionLastUsedAt index.
//
// All five columns must be nullable so existing AgentThread rows continue
// to work unchanged.

const TEST_EMAIL_PREFIX = "agent-thread-cli-session-a3-";

async function clearTestRows() {
  // AgentThread cascades from User; deleting test users is sufficient.
  await prisma.user.deleteMany({
    where: { email: { startsWith: TEST_EMAIL_PREFIX } },
  });
}

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      email: `${TEST_EMAIL_PREFIX}${suffix}@test.invalid`,
      passwordHash: "not-a-real-hash-a3",
    },
  });
}

beforeEach(async () => {
  await clearTestRows();
});

afterAll(async () => {
  await clearTestRows();
  await prisma.$disconnect();
});

describe("AgentThread cliSession* columns (Phase A3)", () => {
  it("permits creation with all cliSession* fields omitted (backward compat)", async () => {
    const user = await createTestUser("backcompat");
    const created = await prisma.agentThread.create({
      data: {
        userId: user.id,
        contextKey: "coworker-a3-backcompat",
      },
    });

    const fetched = await prisma.agentThread.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(fetched.cliSessionId).toBeNull();
    expect(fetched.cliSessionAdapterKind).toBeNull();
    expect(fetched.cliSessionContainerId).toBeNull();
    expect(fetched.cliSessionLastUsedAt).toBeNull();
    expect(fetched.cliSessionWorkdir).toBeNull();
  });

  it("round-trips all five cliSession* fields when populated", async () => {
    const user = await createTestUser("populated");
    const lastUsed = new Date("2026-04-29T12:34:56.000Z");

    const created = await prisma.agentThread.create({
      data: {
        userId: user.id,
        contextKey: "coworker-a3-populated",
        cliSessionId: "test-uuid-1",
        cliSessionAdapterKind: "claude-code-cli",
        cliSessionContainerId: "dpf-sandbox-1",
        cliSessionLastUsedAt: lastUsed,
        cliSessionWorkdir: "/workspace/threads/test-thread",
      },
    });

    const fetched = await prisma.agentThread.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(fetched.cliSessionId).toBe("test-uuid-1");
    expect(fetched.cliSessionAdapterKind).toBe("claude-code-cli");
    expect(fetched.cliSessionContainerId).toBe("dpf-sandbox-1");
    expect(fetched.cliSessionLastUsedAt?.toISOString()).toBe(
      lastUsed.toISOString(),
    );
    expect(fetched.cliSessionWorkdir).toBe("/workspace/threads/test-thread");
  });

  it("supports the null -> populated transition via update", async () => {
    const user = await createTestUser("transition");
    const created = await prisma.agentThread.create({
      data: {
        userId: user.id,
        contextKey: "coworker-a3-transition",
      },
    });

    expect(created.cliSessionId).toBeNull();

    const lastUsed = new Date();
    await prisma.agentThread.update({
      where: { id: created.id },
      data: {
        cliSessionId: "later-issued-uuid",
        cliSessionAdapterKind: "codex-cli",
        cliSessionContainerId: "dpf-sandbox-2",
        cliSessionLastUsedAt: lastUsed,
        cliSessionWorkdir: "/workspace/threads/transitional",
      },
    });

    const fetched = await prisma.agentThread.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(fetched.cliSessionId).toBe("later-issued-uuid");
    expect(fetched.cliSessionAdapterKind).toBe("codex-cli");
    expect(fetched.cliSessionContainerId).toBe("dpf-sandbox-2");
    expect(fetched.cliSessionLastUsedAt?.toISOString()).toBe(
      lastUsed.toISOString(),
    );
    expect(fetched.cliSessionWorkdir).toBe("/workspace/threads/transitional");
  });

  it("creates the AgentThread_cliSessionLastUsedAt_idx index for sweeper queries", async () => {
    const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'AgentThread' AND indexname = 'AgentThread_cliSessionLastUsedAt_idx'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].indexname).toBe("AgentThread_cliSessionLastUsedAt_idx");
  });
});
