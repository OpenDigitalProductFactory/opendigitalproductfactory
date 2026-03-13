import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { EmployeeDirectoryPanel } from "@/components/employee/EmployeeDirectoryPanel";
import { EmployeeProfilePanel } from "@/components/employee/EmployeeProfilePanel";
import { LifecycleEventPanel } from "@/components/employee/LifecycleEventPanel";

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
