// apps/web/app/(shell)/employee/page.tsx
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { OwnerFirstSummaryBand } from "@/components/owner-first/OwnerFirstSummary";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildEmployeeOwnerSummary } from "@/lib/owner-first/domain-summary";
import { isSimpleNavMode, NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { EmployeeDirectoryPanel } from "@/components/employee/EmployeeDirectoryPanel";
import { EmployeeProfilePanel } from "@/components/employee/EmployeeProfilePanel";
import { EmployeeTabNav } from "@/components/employee/EmployeeTabNav";
import { HrUserLifecyclePanel } from "@/components/employee/HrUserLifecyclePanel";
import { LifecycleEventPanel } from "@/components/employee/LifecycleEventPanel";
import { NewEmployeeButton } from "@/components/employee/NewEmployeeButton";
import { OrgAssignmentPanel } from "@/components/employee/OrgAssignmentPanel";
import { OrgChartView } from "@/components/employee/OrgChartView";
import { WorkforceRosterPanel } from "@/components/employee/WorkforceRosterPanel";
import { WorkforceActivityPanel } from "@/components/employee/WorkforceActivityPanel";
import { loadWorkforceRoster } from "@/lib/workforce/workforce-roster";
import { loadWorkforceActivity } from "@/lib/workforce/workforce-activity";
import { TimesheetGrid } from "@/components/employee/TimesheetGrid";
import { TimesheetApprovalPanel } from "@/components/employee/TimesheetApprovalPanel";
import { MyPoliciesView } from "@/components/employee/MyPoliciesView";
import { SurfacePlatformGrid } from "@/components/workbooks/SurfacePlatformGrid";
import {
  getEmployeeDirectoryRows,
  getEmployeeLifecycleEvents,
  getEmployeeProfileByUserId,
  getWorkforceReferenceData,
} from "@/lib/workforce-data";
import { getEmployeeAddresses } from "@/lib/address-data";
import { getTimesheetForWeek, getPendingTimesheetsForManager, getCurrentWeekStart } from "@/lib/timesheet-data";
import { auth } from "@/lib/auth";
import { getFinancialProfile } from "@dpf/finance-templates";
import { CompensationPanel } from "@/components/employee/CompensationPanel";
import { getEmployeeCompensationRows } from "@/lib/hr/compensation-data";
import type { TimesheetBillingContext } from "@/components/employee/TimesheetGrid";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmployeePage({ searchParams }: Props) {
  const params = await searchParams;
  const view = typeof params.view === "string" ? params.view : "directory";

  const [roles, users, employees, workforceReferenceData] = await Promise.all([
    prisma.platformRole.findMany({
      orderBy: { roleId: "asc" },
      select: {
        id: true,
        roleId: true,
        name: true,
        description: true,
        hitlTierMin: true,
        slaDurationH: true,
        _count: { select: { users: true } },
      },
    }),
    prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        isActive: true,
        isSuperuser: true,
        groups: {
          select: {
            platformRole: {
              select: {
                roleId: true,
              },
            },
          },
        },
      },
    }),
    getEmployeeDirectoryRows(),
    getWorkforceReferenceData(),
  ]);

  const session = await auth();
  const currentUserId = session?.user?.id ?? null;

  const primaryEmployeeUserId = employees.find((employee) => employee.userId)?.userId ?? null;
  const selectedEmployee = primaryEmployeeUserId
    ? await getEmployeeProfileByUserId(primaryEmployeeUserId)
    : null;
  const [lifecycleEvents, employeeAddresses] = selectedEmployee
    ? await Promise.all([
        getEmployeeLifecycleEvents(selectedEmployee.id),
        getEmployeeAddresses(selectedEmployee.id),
      ])
    : [[], []];

  // Timesheet data (only fetch when on timesheets tab)
  const currentUserProfile = currentUserId
    ? employees.find((e) => e.userId === currentUserId)
    : null;
  const weekParam = typeof params.week === "string" ? params.week : null;
  const weekStart = weekParam ? new Date(weekParam + "T00:00:00") : getCurrentWeekStart();
  const currentTimesheet = view === "timesheets" && currentUserProfile
    ? await getTimesheetForWeek(currentUserProfile.id, weekStart)
    : null;
  const pendingTimesheets = view === "timesheets" && currentUserProfile
    ? await getPendingTimesheetsForManager(currentUserProfile.id)
    : [];
  const [workforceRoster, workforceActivity] =
    view === "workforce"
      ? await Promise.all([loadWorkforceRoster(), loadWorkforceActivity()])
      : [null, null];

  // Billable time is archetype-gated (labour financial profiles only); when
  // off, the timesheet shows no billing controls at all.
  const orgSettings = await prisma.orgSettings.findFirst({
    select: { appliedProfileSlug: true, baseCurrency: true },
  });
  const billableTimeEnabled =
    (orgSettings?.appliedProfileSlug
      ? getFinancialProfile(orgSettings.appliedProfileSlug)?.billableTimeEnabled
      : false) ?? false;
  let timesheetBilling: TimesheetBillingContext | null = null;
  if (view === "timesheets" && billableTimeEnabled) {
    const [customers, org] = await Promise.all([
      prisma.customerAccount.findMany({
        where: { status: { not: "superseded" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.organization.findFirst({ select: { id: true } }),
    ]);
    const services = org
      ? await prisma.billableRate.findMany({
          where: { organizationId: org.id, isActive: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : [];
    timesheetBilling = {
      customers,
      services: services.map((s) => ({ id: s.id, name: s.name })),
    };
  }
  const compensationRows = view === "directory" ? await getEmployeeCompensationRows() : [];

  // Owner-first: lead with service-staffing readiness, then demote role
  // governance behind progressive disclosure (BI-3BCAF95F). For a Restaurant
  // owner, "who is on for the next service" comes before HITL tiers and SLAs.
  const simple = isSimpleNavMode(
    resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
  );
  const [{ vocab }, submittedTimesheets] = await Promise.all([
    loadOwnerFirstContext(),
    prisma.timesheetPeriod.count({ where: { status: "submitted" } }),
  ]);
  const unassignedRoles = roles.filter((r) => r._count.users === 0).length;
  const ownerSummary = buildEmployeeOwnerSummary(
    { submittedTimesheets, teamSize: employees.length, unassignedRoles },
    vocab,
  );

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">People</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
            {employees.length} {employees.length === 1 ? "person" : "people"}
            {" · "}
            {roles.length} role{roles.length !== 1 ? "s" : ""}
          </p>
        </div>
        <NewEmployeeButton
          departments={workforceReferenceData.departments.map((d) => ({
            id: d.id,
            label: d.name,
          }))}
          positions={workforceReferenceData.positions.map((p) => ({
            id: p.id,
            label: p.title,
          }))}
          workLocations={workforceReferenceData.workLocations.map((wl) => ({
            id: wl.id,
            label: wl.name,
          }))}
          employmentTypes={workforceReferenceData.employmentTypes.map((et) => ({
            id: et.id,
            label: et.name,
          }))}
          existingEmployees={employees.map((emp) => ({
            id: emp.id,
            label: emp.displayName,
          }))}
        />
      </div>

      {/* Owner-first: service-staffing readiness leads. */}
      <OwnerFirstSummaryBand summary={ownerSummary} density={simple ? "simple" : "full"} />

      <div className="mt-8">
        <EmployeeTabNav />

        {view === "grid" ? (
          <SurfacePlatformGrid entityType="employee_profile" view="grid" />
        ) : view === "workforce" && workforceRoster ? (
          <div className="space-y-8">
            {workforceActivity && <WorkforceActivityPanel activity={workforceActivity} />}
            <div className="pt-2 border-t border-[var(--dpf-border)]">
              <p className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)] mb-3">
                Directory — who makes up the workforce
              </p>
              <WorkforceRosterPanel roster={workforceRoster} />
            </div>
          </div>
        ) : view === "timesheets" ? (
          <div className="space-y-4">
            {pendingTimesheets.length > 0 && (
              <TimesheetApprovalPanel pendingTimesheets={pendingTimesheets} />
            )}
            {currentUserProfile ? (
              <TimesheetGrid
                existingPeriod={currentTimesheet}
                weekStarting={weekStart.toISOString()}
                billing={timesheetBilling}
              />
            ) : (
              <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
                No employee profile linked to your account. Timesheets will appear once your profile is set up.
              </p>
            )}
          </div>
        ) : view === "orgchart" ? (
          <OrgChartView employees={employees} />
        ) : view === "mypolicies" ? (
          <MyPoliciesView />
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <EmployeeDirectoryPanel employees={employees} />
              <EmployeeProfilePanel employee={selectedEmployee} addresses={employeeAddresses} />
            </div>

            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
              <OrgAssignmentPanel
                employee={selectedEmployee}
                departments={workforceReferenceData.departments}
                positions={workforceReferenceData.positions}
                workLocations={workforceReferenceData.workLocations}
              />
              <LifecycleEventPanel events={lifecycleEvents} />
            </div>

            <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
              <CompensationPanel
                employees={compensationRows}
                currency={orgSettings?.baseCurrency ?? "GBP"}
              />
            </div>
          </>
        )}
      </div>

      {/* Role governance — HITL tiers, SLAs, and user access. Demoted behind
          progressive disclosure so staffing readiness leads (BI-3BCAF95F). Simple
          mode drops it entirely to reduce body content. */}
      {!simple && (
        <div className="mt-8">
          <OwnerFirstDisclosure
            summary="Role governance & access"
            hint="HITL tiers, SLAs, and who can do what"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {roles.map((r) => {
                const userCount = r._count.users;
                const sla =
                  r.slaDurationH != null && r.slaDurationH > 0
                    ? `${r.slaDurationH}h SLA`
                    : "No SLA";

                return (
                  <div
                    key={r.id}
                    className="p-4 rounded-lg bg-[var(--dpf-surface-2)] border-l-4"
                    style={{ borderLeftColor: "#7c8cf8" }}
                  >
                    <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                      {r.roleId}
                    </p>
                    <p className="text-sm font-semibold text-[var(--dpf-text)] leading-tight mb-1">
                      {r.name}
                    </p>
                    {r.description != null && (
                      <p className="text-[10px] text-[var(--dpf-muted)] line-clamp-2 mb-2">
                        {r.description}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <span className="text-[9px] text-[var(--dpf-muted)]">
                        HITL T{r.hitlTierMin}
                      </span>
                      <span className="text-[9px] text-[var(--dpf-muted)]">{sla}</span>
                      <span className="text-[9px] text-[var(--dpf-muted)]">
                        {userCount === 0 ? "Unassigned" : `${userCount} ${userCount === 1 ? "person" : "people"}`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {roles.length === 0 && (
              <p className="text-sm text-[var(--dpf-muted)]">No roles registered yet.</p>
            )}

            {users.length > 0 && (
              <div className="mt-8">
                <HrUserLifecyclePanel
                  roles={roles.map((role) => ({ roleId: role.roleId, name: role.name }))}
                  users={users.map((user) => ({
                    id: user.id,
                    email: user.email,
                    isActive: user.isActive,
                    isSuperuser: user.isSuperuser,
                    roleId: user.groups[0]?.platformRole.roleId ?? null,
                  }))}
                />
              </div>
            )}
          </OwnerFirstDisclosure>
        </div>
      )}
    </div>
  );
}
