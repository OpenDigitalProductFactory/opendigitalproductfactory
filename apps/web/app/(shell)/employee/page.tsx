// apps/web/app/(shell)/employee/page.tsx
import { prisma } from "@dpf/db";
import { EmployeeDirectoryPanel } from "@/components/employee/EmployeeDirectoryPanel";
import { EmployeeProfilePanel } from "@/components/employee/EmployeeProfilePanel";
import { EmployeeTabNav } from "@/components/employee/EmployeeTabNav";
import { HrUserLifecyclePanel } from "@/components/employee/HrUserLifecyclePanel";
import { LifecycleEventPanel } from "@/components/employee/LifecycleEventPanel";
import { NewEmployeeButton } from "@/components/employee/NewEmployeeButton";
import { OrgAssignmentPanel } from "@/components/employee/OrgAssignmentPanel";
import { OrgChartView } from "@/components/employee/OrgChartView";
import { TimesheetGrid } from "@/components/employee/TimesheetGrid";
import { TimesheetApprovalPanel } from "@/components/employee/TimesheetApprovalPanel";
import {
  getEmployeeDirectoryRows,
  getEmployeeLifecycleEvents,
  getEmployeeProfileByUserId,
  getWorkforceReferenceData,
} from "@/lib/workforce-data";
import { getTimesheetForWeek, getPendingTimesheetsForManager, getCurrentWeekStart } from "@/lib/timesheet-data";
import { auth } from "@/lib/auth";

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
  const lifecycleEvents = selectedEmployee
    ? await getEmployeeLifecycleEvents(selectedEmployee.id)
    : [];

  // Timesheet data (only fetch when on timesheets tab)
  const currentUserProfile = currentUserId
    ? employees.find((e) => e.userId === currentUserId)
    : null;
  const weekStart = getCurrentWeekStart();
  const currentTimesheet = view === "timesheets" && currentUserProfile
    ? await getTimesheetForWeek(currentUserProfile.id, weekStart)
    : null;
  const pendingTimesheets = view === "timesheets" && currentUserProfile
    ? await getPendingTimesheetsForManager(currentUserProfile.id)
    : [];

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Employee</h1>
          <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
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
              className="p-4 rounded-lg bg-[var(--dpf-surface-1)] border-l-4"
              style={{ borderLeftColor: "#7c8cf8" }}
            >
              <p className="text-[9px] font-mono text-[var(--dpf-muted)] mb-1">
                {r.roleId}
              </p>
              <p className="text-sm font-semibold text-white leading-tight mb-1">
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

      <div className="mt-8">
        <EmployeeTabNav />

        {view === "timesheets" ? (
          <div className="space-y-4">
            {pendingTimesheets.length > 0 && (
              <TimesheetApprovalPanel pendingTimesheets={pendingTimesheets} />
            )}
            {currentUserProfile ? (
              <TimesheetGrid
                existingPeriod={currentTimesheet}
                weekStarting={weekStart.toISOString()}
                onWeekChange={() => {/* handled client-side via URL params in future */}}
              />
            ) : (
              <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
                No employee profile linked to your account. Timesheets will appear once your profile is set up.
              </p>
            )}
          </div>
        ) : view === "orgchart" ? (
          <OrgChartView employees={employees} />
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <EmployeeDirectoryPanel employees={employees} />
              <EmployeeProfilePanel employee={selectedEmployee} />
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
          </>
        )}
      </div>

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
    </div>
  );
}
