// apps/web/app/(shell)/employee/page.tsx
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { OwnerFirstSummaryBand } from "@/components/owner-first/OwnerFirstSummary";
import { OwnerFirstDisclosure } from "@/components/owner-first/OwnerFirstDisclosure";
import { loadOwnerFirstContext } from "@/lib/owner-first/context";
import { buildEmployeeOwnerSummary } from "@/lib/owner-first/domain-summary";
import { isSimpleNavMode, NAV_MODE_COOKIE, resolveNavModeFromCookie } from "@/lib/navigation/nav-mode";
import { oversightLabel } from "@/lib/workforce/oversight-copy";
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
import { can } from "@/lib/permissions";
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

  // Org-chart edits are governed; render read-only for anyone who cannot write (BI-HCM-004).
  const canManageWorkforce = session?.user
    ? can(
        { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
        "manage_user_lifecycle",
      )
    : false;

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
  // owner, "who is on for the next service" comes before oversight and SLAs.
  const simple = isSimpleNavMode(
    resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value),
  );
  const [{ vocab }, submittedTimesheets] = await Promise.all([
    loadOwnerFirstContext(),
    prisma.timesheetPeriod.count({ where: { status: "submitted" } }),
  ]);
  const unassignedRoles = roles.filter((r) => r._count.users === 0).length;

  // Role holders, from the users already loaded (no extra query) so cards can name people.
  const roleHolders = new Map<string, string[]>();
  for (const user of users) {
    if (!user.isActive) continue;
    for (const group of user.groups) {
      const roleId = group.platformRole.roleId;
      const list = roleHolders.get(roleId) ?? [];
      list.push(user.email);
      roleHolders.set(roleId, list);
    }
  }
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
          <OrgChartView
            employees={employees}
            canReassign={canManageWorkforce}
            referenceData={{
              departments: workforceReferenceData.departments.map((d) => ({
                id: d.id,
                name: d.name,
              })),
              positions: workforceReferenceData.positions.map((p) => ({
                id: p.id,
                title: p.title,
              })),
              workLocations: workforceReferenceData.workLocations.map((wl) => ({
                id: wl.id,
                name: wl.name,
              })),
            }}
          />
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

      {/* Role governance & access. Behind progressive disclosure so staffing readiness leads
          (BI-3BCAF95F). The actionable half leads within it (BI-HCM-004): read-only cards used
          to sit above the only control that changes anything. */}
      {!simple && (
        <div className="mt-8">
          <OwnerFirstDisclosure
            summary="Role governance & access"
            hint="Who holds each role"
          >
            {users.length > 0 && (
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
            )}

            <div className="mt-8">
              <div className="mb-3">
                <p className="text-xs font-semibold text-[var(--dpf-text)]">
                  What each role can do
                </p>
                <p className="mt-0.5 text-dpf-caption text-[var(--dpf-muted)]">
                  Set by the platform. Use the control above to change who holds a role.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {roles.map((r) => {
                  const sla =
                    r.slaDurationH != null && r.slaDurationH > 0
                      ? `${r.slaDurationH}h SLA`
                      : "No SLA";
                  const holders = roleHolders.get(r.roleId) ?? [];

                  return (
                    <div
                      key={r.id}
                      className="rounded-lg border-l-4 bg-[var(--dpf-surface-2)] p-4"
                      style={{ borderLeftColor: "var(--dpf-accent)" }}
                    >
                      <p className="mb-1 font-mono text-dpf-caption text-[var(--dpf-muted)]">
                        {r.roleId}
                      </p>
                      <p className="mb-1 text-sm font-semibold leading-tight text-[var(--dpf-text)]">
                        {r.name}
                      </p>
                      {r.description != null && (
                        <p className="mb-2 line-clamp-2 text-dpf-caption text-[var(--dpf-muted)]">
                          {r.description}
                        </p>
                      )}
                      <div className="mb-2 flex flex-wrap gap-2">
                        <span className="text-dpf-caption text-[var(--dpf-muted)]">
                          {oversightLabel(r.hitlTierMin, { dense: true })}
                        </span>
                        <span className="text-dpf-caption text-[var(--dpf-muted)]">{sla}</span>
                      </div>

                      {/* A bare count cannot answer "who can do what". */}
                      <p className="text-dpf-caption text-[var(--dpf-muted)]">
                        {holders.length === 0 ? (
                          <span className="text-[var(--dpf-warning)]">Nobody holds this</span>
                        ) : (
                          <>
                            <span className="text-[var(--dpf-text)]">Held by</span>{" "}
                            {holders.slice(0, 3).join(", ")}
                            {holders.length > 3 ? ` +${holders.length - 3} more` : ""}
                          </>
                        )}
                      </p>
                    </div>
                  );
                })}
              </div>

              {roles.length === 0 && (
                <p className="text-sm text-[var(--dpf-muted)]">No roles registered yet.</p>
              )}
            </div>
          </OwnerFirstDisclosure>
        </div>
      )}
    </div>
  );
}
