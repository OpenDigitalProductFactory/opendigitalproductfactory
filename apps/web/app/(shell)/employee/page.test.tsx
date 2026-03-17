import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    platformRole: {
      findMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/workforce-data", () => ({
  getEmployeeDirectoryRows: vi.fn(),
  getWorkforceReferenceData: vi.fn(),
  getEmployeeProfileByUserId: vi.fn(),
  getEmployeeLifecycleEvents: vi.fn(),
}));

vi.mock("@/lib/actions/users", () => ({
  updateUserLifecycle: vi.fn(),
}));

import { prisma } from "@dpf/db";
import {
  getEmployeeDirectoryRows,
  getEmployeeLifecycleEvents,
  getEmployeeProfileByUserId,
  getWorkforceReferenceData,
} from "@/lib/workforce-data";
import { EmployeeDirectoryPanel } from "@/components/employee/EmployeeDirectoryPanel";
import { EmployeeProfilePanel } from "@/components/employee/EmployeeProfilePanel";
import { LifecycleEventPanel } from "@/components/employee/LifecycleEventPanel";
import EmployeePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(prisma.platformRole.findMany).mockResolvedValue(
    [
      {
        id: "role-db-1",
        roleId: "HR-100",
        name: "HR Lead",
        description: "Handles workforce management",
        hitlTierMin: 1,
        slaDurationH: 24,
        _count: { users: 1 },
      },
    ] as never,
  );

  vi.mocked(prisma.user.findMany).mockResolvedValue(
    [
      {
        id: "user-1",
        email: "ada@example.com",
        isActive: true,
        isSuperuser: false,
        groups: [
          {
            platformRole: {
              roleId: "HR-100",
            },
          },
        ],
      },
    ] as never,
  );

  vi.mocked(getEmployeeDirectoryRows).mockResolvedValue([
    {
      id: "emp-db-1",
      employeeId: "EMP-001",
      userId: "user-1",
      displayName: "Ada Lovelace",
      workEmail: "ada@example.com",
      status: "active",
      departmentId: "dept-people",
      departmentName: "People Operations",
      positionId: "pos-hr-manager",
      positionTitle: "HR Manager",
      managerEmployeeId: "emp-db-2",
      managerName: "Grace Hopper",
      dottedLineManagerId: null,
      dottedLineManagerName: null,
      workLocationId: "loc-remote",
      workLocationName: "Remote",
    },
  ]);

  vi.mocked(getWorkforceReferenceData).mockResolvedValue({
    employmentTypes: [],
    positions: [{ id: "pos-hr-manager", positionId: "POS-001", title: "HR Manager" }],
    workLocations: [{ id: "loc-remote", locationId: "LOC-001", name: "Remote", timezone: "America/Chicago" }],
    departments: [{ id: "dept-people", departmentId: "DEPT-001", name: "People Operations", parentDepartmentId: null }],
  });

  vi.mocked(getEmployeeProfileByUserId).mockResolvedValue({
    id: "emp-db-1",
    employeeId: "EMP-001",
    userId: "user-1",
    firstName: "Ada",
    middleName: null,
    lastName: "Lovelace",
    displayName: "Ada Lovelace",
    workEmail: "ada@example.com",
    personalEmail: null,
    phoneNumber: null,
    status: "active",
    departmentId: "dept-people",
    departmentName: "People Operations",
    positionId: "pos-hr-manager",
    positionTitle: "HR Manager",
    managerEmployeeId: "emp-db-2",
    managerName: "Grace Hopper",
    workLocationId: "loc-remote",
    workLocationName: "Remote",
    timezone: "America/Chicago",
    startDate: new Date("2026-03-13"),
    confirmationDate: new Date("2026-03-20"),
    endDate: null,
  });

  vi.mocked(getEmployeeLifecycleEvents).mockResolvedValue([
    {
      id: "evt-db-1",
      eventId: "EEVT-001",
      eventType: "activated",
      effectiveAt: new Date("2026-03-13"),
      reason: "Initial activation",
      createdAt: new Date("2026-03-13"),
    },
  ]);
});

describe("EmployeeDirectoryPanel", () => {
  it("renders employee profile and org details", () => {
    const html = renderToStaticMarkup(
      <EmployeeDirectoryPanel
        employees={[
          {
            id: "emp-db-1",
            employeeId: "EMP-001",
            userId: "user-1",
            displayName: "Ada Lovelace",
            workEmail: "ada@example.com",
            status: "active",
            departmentId: "dept-people",
            departmentName: "People Operations",
            positionId: "pos-hr-manager",
            positionTitle: "HR Manager",
            managerEmployeeId: "emp-db-2",
            managerName: "Grace Hopper",
            dottedLineManagerId: null,
            dottedLineManagerName: null,
            workLocationId: "loc-remote",
            workLocationName: "Remote",
          },
        ]}
      />,
    );

    expect(html).toContain("EMP-001");
    expect(html).toContain("People Operations");
    expect(html).toContain("Grace Hopper");
  });
});

describe("EmployeeProfilePanel", () => {
  it("renders lifecycle dates for the selected employee", () => {
    const html = renderToStaticMarkup(
      <EmployeeProfilePanel
        employee={{
          id: "emp-db-1",
          employeeId: "EMP-001",
          userId: "user-1",
          firstName: "Ada",
          middleName: null,
          lastName: "Lovelace",
          displayName: "Ada Lovelace",
          workEmail: "ada@example.com",
          personalEmail: null,
          phoneNumber: null,
          status: "active",
          departmentId: "dept-people",
          departmentName: "People Operations",
          positionId: "pos-hr-manager",
          positionTitle: "HR Manager",
          managerEmployeeId: "emp-db-2",
          managerName: "Grace Hopper",
          workLocationId: "loc-remote",
          workLocationName: "Remote",
          timezone: "America/Chicago",
          startDate: new Date("2026-03-13"),
          confirmationDate: new Date("2026-03-20"),
          endDate: null,
        }}
      />,
    );

    expect(html).toContain("Employee profile");
    expect(html).toContain("2026");
    expect(html).toContain("Remote");
  });
});

describe("LifecycleEventPanel", () => {
  it("renders recent employment events", () => {
    const html = renderToStaticMarkup(
      <LifecycleEventPanel
        events={[
          {
            id: "evt-db-1",
            eventId: "EEVT-001",
            eventType: "activated",
            effectiveAt: new Date("2026-03-13"),
            reason: "Initial activation",
            createdAt: new Date("2026-03-13"),
          },
        ]}
      />,
    );

    expect(html).toContain("Recent lifecycle events");
    expect(html).toContain("activated");
    expect(html).toContain("Initial activation");
  });
});

describe("EmployeePage", () => {
  it("renders both workforce context and HR user lifecycle controls", async () => {
    const html = renderToStaticMarkup(
      await EmployeePage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Employee directory");
    expect(html).toContain("HR user lifecycle");
  });
});
