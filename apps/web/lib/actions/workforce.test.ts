import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn(),
}));

vi.mock("@/lib/governance-data", () => ({
  getUserTeamIds: vi.fn(),
  createAuthorizationDecisionLog: vi.fn(),
}));

vi.mock("@/lib/principal-context", () => ({
  buildPrincipalContext: vi.fn(),
}));

vi.mock("@/lib/governance-resolver", () => ({
  resolveGovernedAction: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    employeeProfile: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    employmentEvent: {
      create: vi.fn(),
    },
    terminationRecord: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { buildPrincipalContext } from "@/lib/principal-context";
import { getUserTeamIds, createAuthorizationDecisionLog } from "@/lib/governance-data";
import { resolveGovernedAction } from "@/lib/governance-resolver";
import {
  createEmployeeProfile,
  recordEmploymentLifecycleEvent,
} from "./workforce";
import {
  validateEmployeeProfileInput,
  validateLifecycleTransition,
} from "@/lib/workforce-types";

const authMock = auth as unknown as { mockResolvedValue: (value: unknown) => void };

beforeEach(() => {
  vi.clearAllMocks();

  authMock.mockResolvedValue({
    user: {
      id: "user-1",
      email: "hr@example.com",
      platformRole: "HR-100",
      isSuperuser: false,
    },
  });
  vi.mocked(can).mockReturnValue(true);
  vi.mocked(getUserTeamIds).mockResolvedValue(["team-1"]);
  vi.mocked(buildPrincipalContext).mockReturnValue({
    authenticatedSubject: { kind: "user", userId: "user-1" },
    actingHuman: { kind: "user", userId: "user-1" },
    teamIds: ["team-1"],
    platformRoleIds: ["HR-100"],
    effectiveCapabilities: [],
    delegationGrantIds: [],
  });
  vi.mocked(resolveGovernedAction).mockReturnValue({
    decision: "allow",
    rationaleCode: "baseline_intersection",
  });
  vi.mocked(createAuthorizationDecisionLog).mockResolvedValue();
});

describe("validateEmployeeProfileInput", () => {
  it("rejects an end date before the start date", () => {
    expect(
      validateEmployeeProfileInput({
        employeeId: "EMP-001",
        firstName: "Ada",
        lastName: "Lovelace",
        status: "active",
        startDate: new Date("2026-03-13"),
        endDate: new Date("2026-03-12"),
      }),
    ).toMatch(/start date/i);
  });

  it("rejects a confirmation date before the start date", () => {
    expect(
      validateEmployeeProfileInput({
        employeeId: "EMP-001",
        firstName: "Ada",
        lastName: "Lovelace",
        status: "active",
        startDate: new Date("2026-03-13"),
        confirmationDate: new Date("2026-03-12"),
      }),
    ).toMatch(/confirmation date/i);
  });

  it("rejects a self-manager relationship", () => {
    expect(
      validateEmployeeProfileInput({
        employeeId: "EMP-001",
        firstName: "Ada",
        lastName: "Lovelace",
        status: "active",
        managerEmployeeId: "EMP-001",
      }),
    ).toMatch(/manager/i);
  });
});

describe("validateLifecycleTransition", () => {
  it("requires a termination date when setting inactive through termination", () => {
    expect(
      validateLifecycleTransition({
        currentStatus: "active",
        nextStatus: "inactive",
        eventType: "terminated",
        terminationDate: null,
      }),
    ).toMatch(/termination date/i);
  });
});

describe("createEmployeeProfile", () => {
  it("returns a validation error before writing invalid profile data", async () => {
    const result = await createEmployeeProfile({
      employeeId: "EMP-001",
      firstName: "Ada",
      lastName: "Lovelace",
      status: "active",
      startDate: new Date("2026-03-13"),
      endDate: new Date("2026-03-12"),
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/start date/i);
    expect(vi.mocked(prisma.employeeProfile.create)).not.toHaveBeenCalled();
  });
});

describe("recordEmploymentLifecycleEvent", () => {
  it("returns a validation error before recording a termination without a date", async () => {
    const result = await recordEmploymentLifecycleEvent({
      employeeProfileId: "emp-db-1",
      currentStatus: "active",
      nextStatus: "inactive",
      eventType: "terminated",
      effectiveAt: new Date("2026-03-13"),
      terminationDate: null,
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/termination date/i);
    expect(vi.mocked(prisma.employmentEvent.create)).not.toHaveBeenCalled();
  });
});
