import { WorkControlPanel } from "@/components/build/work-control/WorkControlPanel";
import { createGovernedWorkAction, getWorkControlData } from "@/lib/actions/work-capsules";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";

export default async function WorkControlPage() {
  const session = await auth();
  const data = await getWorkControlData();
  // BI-E167A8A6: the "Plan governed work" form is door 2 of Build Studio's two
  // work-intake paths. Creating a governed work capsule requires manage_backlog
  // (createGovernedWorkAction enforces it server-side). Gate the create door in
  // the UI to the same capability so a non-technical operator — who can view
  // Build Studio (view_platform) but not create governed work — never faces a
  // second "start work" door that would 403 on submit.
  const canCreateGovernedWork = session?.user
    ? can(
        { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
        "manage_backlog",
      )
    : false;
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
      livenessSummary={data.livenessSummary}
      createAction={createGovernedWorkAction}
      canCreateGovernedWork={canCreateGovernedWork}
      portalContext={portalContext}
    />
  );
}
