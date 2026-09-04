import { redirect } from "next/navigation";

import { RescueCockpit, type RescueArea } from "./RescueCockpit";
import { auth } from "@/lib/auth";
import { loadRescueCockpitData, resolveRescueOrganizationId } from "@/lib/animal-welfare/cockpit-loader";
import { EmptyState } from "@/components/ui/report-kit";
import { can } from "@/lib/govern/permissions";

export async function RescueRoutePage({ area }: { area: RescueArea }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!can(session.user, "view_animal_welfare")) redirect("/workspace");
  const organizationId = await resolveRescueOrganizationId();
  if (!organizationId) {
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
      data={await loadRescueCockpitData(organizationId, {
        canViewFinance: can(session.user, "view_finance"),
      })}
    />
  );
}
