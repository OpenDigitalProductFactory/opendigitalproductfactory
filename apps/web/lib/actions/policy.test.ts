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
    policy: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    policyRequirement: {
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    trainingRequirement: {
      create: vi.fn(),
    },
    requirementCompletion: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    policyAcknowledgment: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    complianceAuditLog: {
      create: vi.fn(),
    },
    employeeProfile: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import {
  createPolicy, updatePolicy, transitionPolicyStatus,
  createRequirement, completeRequirement, acknowledgePolicy,
} from "./policy";

const mockSession = {
  user: { id: "user-1", email: "admin@test.com", platformRole: "HR-000", isSuperuser: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue(mockSession as never);
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(prisma.employeeProfile.findUnique).mockResolvedValue({ id: "emp-1" } as never);
  vi.mocked(prisma.complianceAuditLog.create).mockResolvedValue({} as never);
});

describe("auth", () => {
  it("createPolicy rejects unauthenticated users", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    await expect(createPolicy({ title: "Test", category: "security" })).rejects.toThrow("Unauthorized");
  });

  it("createPolicy rejects users without manage_compliance", async () => {
    vi.mocked(can).mockReturnValue(false);
    await expect(createPolicy({ title: "Test", category: "security" })).rejects.toThrow("Unauthorized");
  });
});

describe("createPolicy", () => {
  it("creates policy and logs action", async () => {
    vi.mocked(prisma.policy.create).mockResolvedValue({ id: "pol-1" } as never);

    const result = await createPolicy({ title: "Acceptable Use", category: "security" });

    expect(result.ok).toBe(true);
    expect(prisma.policy.create).toHaveBeenCalledOnce();
    expect(prisma.complianceAuditLog.create).toHaveBeenCalledOnce();
  });

  it("rejects empty title", async () => {
    const result = await createPolicy({ title: "", category: "security" });
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Title is required.");
    expect(prisma.policy.create).not.toHaveBeenCalled();
  });

  it("rejects invalid category", async () => {
    const result = await createPolicy({ title: "Test", category: "bogus" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Category must be one of/);
  });
});

describe("transitionPolicyStatus", () => {
  it("allows valid transition draft → in-review", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "draft", version: 1 } as never);
    vi.mocked(prisma.policy.update).mockResolvedValue({} as never);

    const result = await transitionPolicyStatus("pol-1", "in-review");
    expect(result.ok).toBe(true);
    expect(prisma.policy.update).toHaveBeenCalledOnce();
  });

  it("rejects invalid transition draft → published", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "draft", version: 1 } as never);

    const result = await transitionPolicyStatus("pol-1", "published");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cannot transition");
    expect(prisma.policy.update).not.toHaveBeenCalled();
  });

  it("sets approvedByEmployeeId on approval", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "in-review", version: 1 } as never);
    vi.mocked(prisma.policy.update).mockResolvedValue({} as never);

    await transitionPolicyStatus("pol-1", "approved");

    const updateCall = vi.mocked(prisma.policy.update).mock.calls[0]![0]!;
    expect((updateCall as { data: Record<string, unknown> }).data.approvedByEmployeeId).toBe("emp-1");
    expect((updateCall as { data: Record<string, unknown> }).data.approvedAt).toBeInstanceOf(Date);
  });

  it("increments version on re-draft from retired", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "retired", version: 2 } as never);
    vi.mocked(prisma.policy.update).mockResolvedValue({} as never);

    await transitionPolicyStatus("pol-1", "draft");

    const updateCall = vi.mocked(prisma.policy.update).mock.calls[0]![0]!;
    expect((updateCall as { data: Record<string, unknown> }).data.version).toBe(3);
  });
});

describe("acknowledgePolicy", () => {
  it("creates acknowledgment for published policy", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "published", version: 1 } as never);
    vi.mocked(prisma.policyAcknowledgment.create).mockResolvedValue({} as never);

    const result = await acknowledgePolicy("pol-1");
    expect(result.ok).toBe(true);
    expect(prisma.policyAcknowledgment.create).toHaveBeenCalledOnce();
  });

  it("rejects acknowledgment for non-published policy", async () => {
    vi.mocked(prisma.policy.findUniqueOrThrow).mockResolvedValue({ lifecycleStatus: "draft", version: 1 } as never);

    const result = await acknowledgePolicy("pol-1");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Policy is not published.");
    expect(prisma.policyAcknowledgment.create).not.toHaveBeenCalled();
  });
});

describe("completeRequirement", () => {
  it("creates completion for published policy requirement", async () => {
    vi.mocked(prisma.policyRequirement.findUniqueOrThrow).mockResolvedValue({
      id: "req-1", requirementType: "acknowledgment", frequency: null,
      policy: { lifecycleStatus: "published" },
    } as never);
    vi.mocked(prisma.requirementCompletion.create).mockResolvedValue({ id: "comp-1" } as never);

    const result = await completeRequirement("req-1", "digital-signature");
    expect(result.ok).toBe(true);
    expect(prisma.requirementCompletion.create).toHaveBeenCalledOnce();
  });

  it("rejects completion for non-published policy", async () => {
    vi.mocked(prisma.policyRequirement.findUniqueOrThrow).mockResolvedValue({
      id: "req-1", requirementType: "training", frequency: null,
      policy: { lifecycleStatus: "draft" },
    } as never);

    const result = await completeRequirement("req-1", "training-completion");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Policy is not published.");
  });

  it("calculates annual expiry for recurring requirement", async () => {
    vi.mocked(prisma.policyRequirement.findUniqueOrThrow).mockResolvedValue({
      id: "req-1", requirementType: "training", frequency: "annual",
      policy: { lifecycleStatus: "published" },
    } as never);
    vi.mocked(prisma.requirementCompletion.create).mockResolvedValue({ id: "comp-1" } as never);

    await completeRequirement("req-1", "training-completion");

    const createCall = vi.mocked(prisma.requirementCompletion.create).mock.calls[0]![0]!;
    const expiresAt = (createCall as { data: { expiresAt: Date | null } }).data.expiresAt;
    expect(expiresAt).toBeInstanceOf(Date);
    // Should be roughly 1 year from now
    const oneYearFromNow = new Date();
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);
    expect(Math.abs(expiresAt!.getTime() - oneYearFromNow.getTime())).toBeLessThan(5000);
  });
});

describe("createRequirement", () => {
  it("creates training requirement with sub-record when type is training", async () => {
    vi.mocked(prisma.policyRequirement.create).mockResolvedValue({ id: "req-1" } as never);
    vi.mocked(prisma.trainingRequirement.create).mockResolvedValue({} as never);

    const result = await createRequirement("pol-1", {
      title: "Ethics Training",
      requirementType: "training",
      trainingTitle: "Annual Ethics 2026",
      durationMinutes: 60,
    });

    expect(result.ok).toBe(true);
    expect(prisma.policyRequirement.create).toHaveBeenCalledOnce();
    expect(prisma.trainingRequirement.create).toHaveBeenCalledOnce();
  });

  it("does NOT create training sub-record for acknowledgment type", async () => {
    vi.mocked(prisma.policyRequirement.create).mockResolvedValue({ id: "req-2" } as never);

    await createRequirement("pol-1", {
      title: "Read and acknowledge",
      requirementType: "acknowledgment",
    });

    expect(prisma.policyRequirement.create).toHaveBeenCalledOnce();
    expect(prisma.trainingRequirement.create).not.toHaveBeenCalled();
  });
});
