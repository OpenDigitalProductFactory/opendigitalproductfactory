import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    changeRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  Prisma: {},
}));

import { prisma } from "@dpf/db";
import { registerChange, advanceChange, driveChangeThrough } from "./register-change";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("registerChange", () => {
  it("creates a standard change fast-forwarded to scheduled with stamped timestamps", async () => {
    vi.mocked(prisma.changeRequest.create).mockResolvedValue({
      id: "cr-1",
      rfcId: "RFC-2026-AAAA0000",
    } as never);

    const out = await registerChange({
      title: "Platform self-upgrade abc → def",
      description: "desc",
      impactReport: { source: "self-upgrade" },
      items: [{ itemType: "platform-self-upgrade", title: "item" }],
    });

    expect(out).toEqual({ id: "cr-1", rfcId: "RFC-2026-AAAA0000" });
    const data = vi.mocked(prisma.changeRequest.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.type).toBe("standard");
    expect(data.scope).toBe("platform");
    expect(data.riskLevel).toBe("low");
    expect(data.status).toBe("scheduled");
    // Fast-forward stamps all pre-terminal linear stages.
    expect(data.submittedAt).toBeInstanceOf(Date);
    expect(data.assessedAt).toBeInstanceOf(Date);
    expect(data.approvedAt).toBeInstanceOf(Date);
    expect(data.scheduledAt).toBeInstanceOf(Date);
    expect(data.startedAt).toBeUndefined();
    // Nested item create.
    expect((data.changeItems as { create: unknown[] }).create).toHaveLength(1);
  });

  it("stamps startedAt when created directly at in-progress", async () => {
    vi.mocked(prisma.changeRequest.create).mockResolvedValue({
      id: "cr-2",
      rfcId: "RFC-2026-BBBB1111",
    } as never);

    await registerChange({
      title: "t",
      description: "d",
      status: "in-progress",
      riskLevel: "medium",
    });

    const data = vi.mocked(prisma.changeRequest.create).mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data.status).toBe("in-progress");
    expect(data.startedAt).toBeInstanceOf(Date);
    expect(data.riskLevel).toBe("medium");
  });

  it("rejects empty title / description", async () => {
    await expect(registerChange({ title: "  ", description: "d" })).rejects.toThrow(
      /title is required/,
    );
    await expect(registerChange({ title: "t", description: " " })).rejects.toThrow(
      /description is required/,
    );
  });
});

describe("advanceChange", () => {
  it("advances one legal step and stamps the status timestamp + extra fields", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      id: "cr-1",
      status: "in-progress",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await advanceChange({ id: "cr-1" }, "completed", { outcome: "succeeded" });

    const arg = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(arg.where.id).toBe("cr-1");
    expect(arg.data.status).toBe("completed");
    expect(arg.data.completedAt).toBeInstanceOf(Date);
    expect(arg.data.outcome).toBe("succeeded");
  });

  it("is a no-op when already at the target status (idempotent)", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      id: "cr-1",
      status: "closed",
    } as never);

    await advanceChange({ id: "cr-1" }, "closed");
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the step is not a legal transition from the current status", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      id: "cr-1",
      status: "closed",
    } as never);

    await advanceChange({ id: "cr-1" }, "in-progress");
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });

  it("is a no-op when the record is not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);
    await advanceChange({ rfcId: "RFC-2026-NOPE0000" }, "completed");
    expect(prisma.changeRequest.update).not.toHaveBeenCalled();
  });

  it("throws when neither id nor rfcId is supplied", async () => {
    await expect(advanceChange({}, "closed")).rejects.toThrow(/id or rfcId required/);
  });
});

describe("driveChangeThrough", () => {
  it("walks a sequence of forward steps", async () => {
    let status = "in-progress";
    vi.mocked(prisma.changeRequest.findUnique).mockImplementation((async () => ({
      id: "cr-1",
      status,
    })) as never);
    vi.mocked(prisma.changeRequest.update).mockImplementation((async (args: {
      data: { status: string };
    }) => {
      status = args.data.status;
      return {};
    }) as never);

    await driveChangeThrough({ id: "cr-1" }, [{ status: "completed" }, { status: "closed" }]);

    expect(status).toBe("closed");
    expect(prisma.changeRequest.update).toHaveBeenCalledTimes(2);
  });
});
