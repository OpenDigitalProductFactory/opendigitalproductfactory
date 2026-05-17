import { WorkControlPanel } from "@/components/build/work-control/WorkControlPanel";
import { createGovernedWorkAction, getWorkControlData } from "@/lib/actions/work-capsules";
import { auth } from "@/lib/auth";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";

export default async function WorkControlPage() {
  const session = await auth();
  const data = await getWorkControlData();
  const portalContext = session?.user?.id
    ? await resolvePortalContextEnvelope(
        {
          pathname: "/build/work",
          routeContext: "/build/work",
        },
        session.user.id,
      )
    : null;

  return (
    <WorkControlPanel
      capsules={data.capsules}
      adoptable={data.adoptable}
      createAction={createGovernedWorkAction}
      portalContext={portalContext}
    />
  );
}
