// apps/web/lib/actions/contributor-inventory.test.ts
// Phase 5 of BI-063BDF1B — server action tests.
//
// Cover the trigger and status actions through their permission gate,
// Inngest dispatch, and Prisma read.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  can: vi.fn(),
  inngestSend: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/permissions", () => ({ can: mocks.can }));
vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: mocks.inngestSend },
}));
vi.mock("@dpf/db", () => ({
  prisma: {
    contributorInventorySyncRun: {
      findUnique: mocks.findUnique,
      findFirst: mocks.findFirst,
    },
  },
}));

import {
  getContributorInventorySyncStatusAction,
  triggerContributorInventorySyncAction,
} from "./contributor-inventory";

const ADMIN_SESSION = {
  user: { id: "u-admin", platformRole: "owner", isSuperuser: true },
};
const NON_ADMIN_SESSION = {
  user: { id: "u-user", platformRole: "member", isSuperuser: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inngestSend.mockResolvedValue({ ids: ["evt-1", "evt-2"] });
  mocks.findUnique.mockResolvedValue(null);
  mocks.findFirst.mockResolvedValue(null);
});

describe("triggerContributorInventorySyncAction", () => {
  it("non-admin returns { ok: false, error: 'Unauthorized' } without dispatching", async () => {
    mocks.auth.mockResolvedValue(NON_ADMIN_SESSION);
    mocks.can.mockReturnValue(false);

    const result = await triggerContributorInventorySyncAction();

    expect(result).toEqual({ ok: false, error: "Unauthorized" });
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("unauthenticated session returns Unauthorized", async () => {
    mocks.auth.mockResolvedValue(null);
    const result = await triggerContributorInventorySyncAction();
    expect(result).toEqual({ ok: false, error: "Unauthorized" });
    expect(mocks.inngestSend).not.toHaveBeenCalled();
  });

  it("admin dispatches the on-demand event and returns the event ids", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);

    const result = await triggerContributorInventorySyncAction();

    expect(result).toEqual({ ok: true, eventIds: ["evt-1", "evt-2"] });
    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ops/contributor-inventory-sync.run",
      data: { triggeredBy: "ui" },
    });
  });

  it("propagates the reason tag into triggeredBy", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);

    await triggerContributorInventorySyncAction("refresh-button");

    expect(mocks.inngestSend).toHaveBeenCalledWith({
      name: "ops/contributor-inventory-sync.run",
      data: { triggeredBy: "ui:refresh-button" },
    });
  });

  it("returns ok: false with the error message when Inngest send throws", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);
    mocks.inngestSend.mockRejectedValue(new Error("inngest unreachable"));

    const result = await triggerContributorInventorySyncAction();

    expect(result).toEqual({ ok: false, error: "inngest unreachable" });
  });
});

describe("getContributorInventorySyncStatusAction", () => {
  it("non-admin throws Unauthorized", async () => {
    mocks.auth.mockResolvedValue(NON_ADMIN_SESSION);
    mocks.can.mockReturnValue(false);

    await expect(getContributorInventorySyncStatusAction()).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("looks up by syncRunId when provided", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);
    const startedAt = new Date("2026-05-27T03:00:00Z");
    mocks.findUnique.mockResolvedValue({
      syncRunId: "civs-1",
      status: "completed",
      startedAt,
      completedAt: new Date("2026-05-27T03:00:01Z"),
      perSourceResult: { "git-worktree": { ok: true } },
    });

    const result = await getContributorInventorySyncStatusAction("civs-1");

    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { syncRunId: "civs-1" } });
    expect(mocks.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual({
      syncRunId: "civs-1",
      status: "completed",
      startedAt,
      completedAt: new Date("2026-05-27T03:00:01Z"),
      perSourceResult: { "git-worktree": { ok: true } },
    });
  });

  it("falls back to most-recent run when no syncRunId given", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);
    mocks.findFirst.mockResolvedValue({
      syncRunId: "civs-latest",
      status: "running",
      startedAt: new Date(),
      completedAt: null,
      perSourceResult: {},
    });

    const result = await getContributorInventorySyncStatusAction();

    expect(mocks.findFirst).toHaveBeenCalledWith({
      orderBy: { startedAt: "desc" },
    });
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(result?.syncRunId).toBe("civs-latest");
    expect(result?.status).toBe("running");
  });

  it("returns null when no row matches", async () => {
    mocks.auth.mockResolvedValue(ADMIN_SESSION);
    mocks.can.mockReturnValue(true);
    mocks.findUnique.mockResolvedValue(null);

    const result = await getContributorInventorySyncStatusAction("does-not-exist");
    expect(result).toBeNull();
  });
});
