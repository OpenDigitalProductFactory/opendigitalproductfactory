import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    changeRequest: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  generateRfcId,
  createRFC,
  transitionRFC,
  submitRFC,
  assessRFC,
  approveRFC,
  scheduleRFC,
  cancelRFC,
  getRFC,
  listRFCs,
} from "./change-management";

const mockSession = {
  user: {
    id: "user-1",
    email: "ops@test.com",
    platformRole: "HR-000",
    isSuperuser: false,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
});

// ─── RFC ID Generation ──────────────────────────────────────────────────────

describe("generateRfcId", () => {
  it("returns RFC-YYYY-XXXXXXXX format", async () => {
    const id = await generateRfcId();
    const year = new Date().getFullYear();
    expect(id).toMatch(new RegExp(`^RFC-${year}-[0-9A-F]{8}$`));
  });

  it("generates unique IDs", async () => {
    const ids = new Set(await Promise.all(Array.from({ length: 20 }, () => generateRfcId())));
    expect(ids.size).toBe(20);
  });
});

// ─── Create RFC ─────────────────────────────────────────────────────────────

describe("createRFC", () => {
  it("creates an RFC in draft status", async () => {
    vi.mocked(prisma.changeRequest.create).mockResolvedValue({} as never);

    const result = await createRFC({
      title: "Add monitoring dashboard",
      description: "Install observability tooling",
    });

    expect(result.rfcId).toMatch(/^RFC-\d{4}-[0-9A-F]{8}$/);

    const createCall = vi.mocked(prisma.changeRequest.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.status).toBe("draft");
    expect(createCall.data.type).toBe("normal");
    expect(createCall.data.requestedById).toBe("user-1");
  });

  it("creates emergency RFC in in-progress status", async () => {
    vi.mocked(prisma.changeRequest.create).mockResolvedValue({} as never);

    const result = await createRFC({
      title: "Hotfix: critical auth bypass",
      description: "Patch CVE-2026-1234",
      type: "emergency",
    });

    expect(result.rfcId).toMatch(/^RFC-/);

    const createCall = vi.mocked(prisma.changeRequest.create).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(createCall.data.status).toBe("in-progress");
    expect(createCall.data.startedAt).toBeInstanceOf(Date);
  });

  it("rejects empty title", async () => {
    await expect(
      createRFC({ title: "  ", description: "valid" })
    ).rejects.toThrow("Title is required");
  });

  it("rejects empty description", async () => {
    await expect(
      createRFC({ title: "Valid", description: "   " })
    ).rejects.toThrow("Description is required");
  });

  it("rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(
      createRFC({ title: "Test", description: "Test" })
    ).rejects.toThrow("Unauthorized");
  });

  it("rejects users without ops access", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(
      createRFC({ title: "Test", description: "Test" })
    ).rejects.toThrow("Unauthorized");
  });
});

// ─── Transition RFC ─────────────────────────────────────────────────────────

describe("transitionRFC", () => {
  it("transitions draft → submitted", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AABBCCDD",
      status: "draft",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await transitionRFC("RFC-2026-AABBCCDD", "submitted");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("submitted");
    expect(updateCall.data.submittedAt).toBeInstanceOf(Date);
  });

  it("transitions submitted → assessed", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AABBCCDD",
      status: "submitted",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await transitionRFC("RFC-2026-AABBCCDD", "assessed");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("assessed");
    expect(updateCall.data.assessedAt).toBeInstanceOf(Date);
  });

  it("transitions assessed → approved", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AABBCCDD",
      status: "assessed",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await transitionRFC("RFC-2026-AABBCCDD", "approved");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
  });

  it("rejects invalid transition draft → approved", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AABBCCDD",
      status: "draft",
    } as never);

    await expect(
      transitionRFC("RFC-2026-AABBCCDD", "approved")
    ).rejects.toThrow(/Invalid transition.*draft.*approved/);
  });

  it("rejects invalid transition completed → draft", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-AABBCCDD",
      status: "completed",
    } as never);

    await expect(
      transitionRFC("RFC-2026-AABBCCDD", "draft")
    ).rejects.toThrow(/Invalid transition/);
  });

  it("throws when RFC not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);

    await expect(
      transitionRFC("RFC-2026-NONEXIST", "submitted")
    ).rejects.toThrow("RFC not found: RFC-2026-NONEXIST");
  });
});

// ─── submitRFC ──────────────────────────────────────────────────────────────

describe("submitRFC", () => {
  it("transitions to submitted", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-11111111",
      status: "draft",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await submitRFC("RFC-2026-11111111");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("submitted");
  });
});

// ─── assessRFC ──────────────────────────────────────────────────────────────

describe("assessRFC", () => {
  it("transitions to assessed with impact report", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-22222222",
      status: "submitted",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const impact = { affectedSystems: ["auth", "api"], riskScore: 3 };
    await assessRFC("RFC-2026-22222222", impact);

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("assessed");
    expect(updateCall.data.impactReport).toEqual(impact);
    expect(updateCall.data.assessedById).toBe("user-1");
    expect(updateCall.data.assessedAt).toBeInstanceOf(Date);
  });

  it("rejects if not in submitted status", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-22222222",
      status: "draft",
    } as never);

    await expect(
      assessRFC("RFC-2026-22222222", { risk: "low" })
    ).rejects.toThrow(/Invalid transition/);
  });
});

// ─── approveRFC ─────────────────────────────────────────────────────────────

describe("approveRFC", () => {
  it("transitions to approved and sets approvedById", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-33333333",
      status: "assessed",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await approveRFC("RFC-2026-33333333", "Low risk, proceed");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.approvedById).toBe("user-1");
    expect(updateCall.data.approvedAt).toBeInstanceOf(Date);
    expect(updateCall.data.outcome).toBe("Low risk, proceed");
  });

  it("works without rationale", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-33333333",
      status: "assessed",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await approveRFC("RFC-2026-33333333");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("approved");
    expect(updateCall.data.outcome).toBeUndefined();
  });
});

// ─── scheduleRFC ────────────────────────────────────────────────────────────

describe("scheduleRFC", () => {
  it("transitions to scheduled with planned dates", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-44444444",
      status: "approved",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    const start = new Date("2026-04-01T02:00:00Z");
    const end = new Date("2026-04-01T04:00:00Z");
    await scheduleRFC("RFC-2026-44444444", start, end, "window-1");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("scheduled");
    expect(updateCall.data.plannedStartAt).toEqual(start);
    expect(updateCall.data.plannedEndAt).toEqual(end);
    expect(updateCall.data.deploymentWindowId).toBe("window-1");
    expect(updateCall.data.scheduledAt).toBeInstanceOf(Date);
  });

  it("rejects without plannedStartAt", async () => {
    await expect(
      scheduleRFC("RFC-2026-44444444", null as never)
    ).rejects.toThrow("plannedStartAt is required");
  });
});

// ─── cancelRFC ──────────────────────────────────────────────────────────────

describe("cancelRFC", () => {
  it("transitions to cancelled with reason", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue({
      rfcId: "RFC-2026-55555555",
      status: "approved",
    } as never);
    vi.mocked(prisma.changeRequest.update).mockResolvedValue({} as never);

    await cancelRFC("RFC-2026-55555555", "Superseded by newer RFC");

    const updateCall = vi.mocked(prisma.changeRequest.update).mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data.status).toBe("cancelled");
    expect(updateCall.data.outcomeNotes).toBe("Superseded by newer RFC");
  });

  it("rejects without reason", async () => {
    await expect(cancelRFC("RFC-2026-55555555", "   ")).rejects.toThrow(
      "Cancellation reason is required"
    );
  });
});

// ─── getRFC ─────────────────────────────────────────────────────────────────

describe("getRFC", () => {
  it("returns RFC with relations", async () => {
    const mockRfc = {
      id: "cr-1",
      rfcId: "RFC-2026-66666666",
      status: "draft",
      changeItems: [],
      requestedBy: null,
      assessedBy: null,
      approvedBy: null,
      executedBy: null,
      deploymentWindow: null,
    };
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(mockRfc as never);

    const result = await getRFC("RFC-2026-66666666");
    expect(result.rfcId).toBe("RFC-2026-66666666");

    const findCall = vi.mocked(prisma.changeRequest.findUnique).mock.calls[0][0] as {
      include: Record<string, unknown>;
    };
    expect(findCall.include.changeItems).toBe(true);
    expect(findCall.include.requestedBy).toBe(true);
    expect(findCall.include.deploymentWindow).toBe(true);
  });

  it("throws when RFC not found", async () => {
    vi.mocked(prisma.changeRequest.findUnique).mockResolvedValue(null as never);
    await expect(getRFC("RFC-2026-NONEXIST")).rejects.toThrow("RFC not found");
  });
});

// ─── listRFCs ───────────────────────────────────────────────────────────────

describe("listRFCs", () => {
  it("returns all RFCs without filters", async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);

    await listRFCs();

    const findCall = vi.mocked(prisma.changeRequest.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where).toEqual({});
  });

  it("applies status filter", async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);

    await listRFCs({ status: "draft" });

    const findCall = vi.mocked(prisma.changeRequest.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where.status).toBe("draft");
  });

  it("applies type and scope filters", async () => {
    vi.mocked(prisma.changeRequest.findMany).mockResolvedValue([] as never);

    await listRFCs({ type: "emergency", scope: "infrastructure" });

    const findCall = vi.mocked(prisma.changeRequest.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(findCall.where.type).toBe("emergency");
    expect(findCall.where.scope).toBe("infrastructure");
  });
});
