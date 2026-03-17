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
    });
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
