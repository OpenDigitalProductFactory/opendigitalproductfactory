import { redirect } from "next/navigation";

import { RescueCockpit, type RescueArea } from "./RescueCockpit";
import { auth } from "@/lib/auth";
import { loadRescueCockpitData, resolveRescueOrganizationScope } from "@/lib/animal-welfare/cockpit-loader";
import { loadIntakeWorkspace } from "@/lib/animal-welfare/intake-workspace";
import { loadDailyCareBoard, topUpCareRoutines } from "@/lib/animal-welfare/daily-care";
import { rescueDayWindow } from "@/lib/animal-welfare/cockpit-loader";
import { parseRescueFilter } from "@/lib/animal-welfare/cockpit";
import { EmptyState } from "@/components/ui/report-kit";
import { can } from "@/lib/govern/permissions";

export async function RescueRoutePage({
  area,
  searchParams,
}: {
  area: RescueArea;
  searchParams?: Promise<{ filter?: string | string[] }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "view_animal_welfare")) redirect("/workspace");
  const filter = parseRescueFilter(area, (await searchParams)?.filter);
  const scope = await resolveRescueOrganizationScope(session.user.id);
  if (!scope) {
    return (
      <EmptyState
        title="Pet Rescue is not configured"
        description="Choose the Pet Rescue archetype to connect this operating workspace to your organization."
      />
    );
  }
  const canOperate = can(session.user, "operate_animal_welfare");
  const now = new Date();
  const day = rescueDayWindow(now, scope.timeZone);
  const [data, intake, care] = await Promise.all([
    loadRescueCockpitData(scope.organizationId, {
      area,
      filter,
      timeZone: scope.timeZone,
      canViewFinance: can(session.user, "view_finance"),
    }),
    area === "intake" && canOperate
      ? loadIntakeWorkspace({ organizationId: scope.organizationId }).catch(() => null)
      : Promise.resolve(null),
    area === "care" && canOperate
      ? topUpCareRoutines({ organizationId: scope.organizationId, now })
          .catch(() => null)
          .then(() => loadDailyCareBoard({ organizationId: scope.organizationId, dayStart: day.start, dayEnd: day.end, now }))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return <RescueCockpit area={area} filter={filter} data={data} intake={intake} care={care} />;
}
