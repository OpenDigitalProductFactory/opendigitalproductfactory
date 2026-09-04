import { redirect } from "next/navigation";

import { RescueCockpit, type RescueArea } from "./RescueCockpit";
import { auth } from "@/lib/auth";
import { loadRescueCockpitData, resolveRescueOrganizationScope } from "@/lib/animal-welfare/cockpit-loader";
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
  return (
    <RescueCockpit
      area={area}
      filter={filter}
      data={await loadRescueCockpitData(scope.organizationId, {
        area,
        filter,
        timeZone: scope.timeZone,
        canViewFinance: can(session.user, "view_finance"),
      })}
    />
  );
}
