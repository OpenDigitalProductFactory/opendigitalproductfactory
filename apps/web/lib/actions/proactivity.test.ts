import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  revalidatePath: vi.fn(),
  prisma: {
    userFact: {
      findFirst: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { getCoworkerProactivityPreference, saveCoworkerProactivityPreference } from "./proactivity";

describe("proactivity actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date("2026-06-30T20:00:00.000Z"));
    mocks.auth.mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: true },
    });
    mocks.prisma.userFact.findFirst.mockResolvedValue(null);
    mocks.prisma.userFact.update.mockResolvedValue({});
    mocks.prisma.userFact.create.mockResolvedValue({});
  });

  it("reads the current user's agent-scoped proactivity preference", async () => {
    mocks.prisma.userFact.findFirst.mockResolvedValueOnce({
      value: JSON.stringify({
        scope: "agent",
        scopeKey: "agent:dispatcher",
        level: "assertive",
        source: "manual-setting",
      }),
    });

    await expect(getCoworkerProactivityPreference("dispatcher")).resolves.toBe("assertive");
    expect(mocks.prisma.userFact.findFirst).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        category: "preference",
        key: "aiCoworkerProactivity:agent:dispatcher",
        supersededAt: null,
      },
      select: { value: true },
      orderBy: { updatedAt: "desc" },
    });
  });

  it("saves a manual agent-scoped proactivity preference for the current user", async () => {
    const result = await saveCoworkerProactivityPreference("dispatcher", "quiet");

    expect(result).toEqual({ ok: true });
    expect(mocks.prisma.userFact.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        category: "preference",
        key: "aiCoworkerProactivity:agent:dispatcher",
        sourceRoute: "/platform/ai",
        sourceAgentId: "dispatcher",
        value: expect.any(String),
        confidence: 1,
        lastValidatedAt: new Date("2026-06-30T20:00:00.000Z"),
      },
    });
    const savedValue = JSON.parse(mocks.prisma.userFact.create.mock.calls[0][0].data.value);
    expect(savedValue).toMatchObject({
      scope: "agent",
      scopeKey: "agent:dispatcher",
      level: "quiet",
      source: "manual-setting",
      acknowledgedByUserId: "user-1",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/platform/ai");
  });

  it("updates the existing active preference fact instead of creating duplicates", async () => {
    mocks.prisma.userFact.findFirst.mockResolvedValueOnce({ id: "fact-1" });

    await saveCoworkerProactivityPreference("dispatcher", "assertive");

    expect(mocks.prisma.userFact.update).toHaveBeenCalledWith({
      where: { id: "fact-1" },
      data: expect.objectContaining({
        value: expect.any(String),
        confidence: 1,
        sourceRoute: "/platform/ai",
        sourceAgentId: "dispatcher",
      }),
    });
    expect(mocks.prisma.userFact.create).not.toHaveBeenCalled();
  });
});
