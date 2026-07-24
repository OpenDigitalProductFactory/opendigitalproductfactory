import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  };
});

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/file-upload", () => ({
  deleteAttachmentsForThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    agentActionProposal: {
      deleteMany: vi.fn(),
    },
    agentThread: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
    },
    agentMessage: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    adapterRunTelemetry: {
      findMany: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { buildCoworkerContextKey } from "@/lib/agent-coworker-context";
import { prisma } from "@dpf/db";
import {
  clearConversation,
  getOrCreateThreadSnapshot,
} from "./agent-coworker";

const mockAuth = auth as ReturnType<typeof vi.fn>;
const mockPrisma = prisma as any;

describe("agent coworker thread scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth.mockResolvedValue({
      user: {
        id: "user-1",
        platformRole: "HR-100",
        isSuperuser: false,
      },
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    // loadProviderInfo now runs inside the thread-snapshot path; with no telemetry
    // rows it falls back to each message's persisted providerId/modelId.
    mockPrisma.adapterRunTelemetry.findMany.mockResolvedValue([]);
  });

  it("builds a page-scoped context key from the route", () => {
    expect(buildCoworkerContextKey("/inventory")).toBe("coworker:/inventory");
  });

  it("creates and loads a route-scoped thread snapshot", async () => {
    mockPrisma.agentThread.upsert.mockResolvedValue({ id: "thread-inventory" });
    mockPrisma.agentMessage.findMany.mockResolvedValue([
      {
        id: "msg-1",
        role: "assistant",
        content: "Inventory help",
        agentId: "agent-ops",
        routeContext: "/inventory",
        createdAt: new Date("2026-03-14T10:00:00.000Z"),
      },
    ]);

    const result = await getOrCreateThreadSnapshot({ routeContext: "/inventory" });

    expect(mockPrisma.agentThread.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_contextKey: {
            userId: "user-1",
            contextKey: "coworker:/inventory",
          },
        },
      }),
    );
    expect(result).toEqual({
      threadId: "thread-inventory",
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "Inventory help",
          agentId: "agent-ops",
          routeContext: "/inventory",
          createdAt: "2026-03-14T10:00:00.000Z",
        },
      ],
      // BI-DED493BA: briefing is best-effort — with no attention mocks wired
      // in this scoping test it degrades to null rather than failing the load.
      openingBriefing: null,
    });
  });

  it("returns null when the session's userId has no matching User row (BI-836B0304)", async () => {
    // A valid session (JWT resolves fine) whose userId points at a User row
    // that no longer exists — e.g. a stale session surviving a re-seed, or
    // the phantom ux-verification session from BI-8E341B9B. The snapshot
    // must fail closed with a plain null (not throw, not fabricate a
    // thread) so the caller can surface an explicit re-auth prompt instead
    // of a dead "couldn't load" banner.
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await getOrCreateThreadSnapshot({ routeContext: "/inventory" });

    expect(result).toBeNull();
    expect(mockPrisma.agentThread.upsert).not.toHaveBeenCalled();
  });

  it("clears only the current page conversation", async () => {
    mockPrisma.agentThread.findUnique.mockResolvedValue({
      id: "thread-inventory",
      userId: "user-1",
    });
    mockPrisma.agentActionProposal.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.agentMessage.deleteMany.mockResolvedValue({ count: 3 });

    const result = await clearConversation({ threadId: "thread-inventory" });

    expect(result).toEqual({ ok: true });
    expect(mockPrisma.agentActionProposal.deleteMany).toHaveBeenCalledWith({
      where: { threadId: "thread-inventory" },
    });
    expect(mockPrisma.agentMessage.deleteMany).toHaveBeenCalledWith({
      where: { threadId: "thread-inventory" },
    });
  });
});
