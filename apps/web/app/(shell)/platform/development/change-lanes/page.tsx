import { ChangeLanesDashboard } from "@/components/platform/development/change-lanes/ChangeLanesDashboard";
import { auth } from "@/lib/auth";
import { loadContributorChangeLaneReadModel } from "@/lib/contributor-change-lanes/read-model";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ChangeLanesPage() {
  const now = new Date();
  const [session, readModel] = await Promise.all([
    auth(),
    loadContributorChangeLaneReadModel({ now }),
  ]);
  const { lanes, freshness, anySourceWarmingUp, anySnapshotSourceDegraded } = readModel;

  // Admin-gating for the Refresh button mirrors `triggerBackupNowAction`'s
  // permission check — same authority bracket. Non-admin sessions still see
  // the dashboard (it's read-only); they just don't get the Refresh button.
  const isAdmin =
    session?.user != null &&
    can(
      {
        platformRole: session.user.platformRole,
        isSuperuser: session.user.isSuperuser,
      },
      "manage_provider_connections",
    );

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <ChangeLanesDashboard
        lanes={lanes}
        freshness={freshness}
        generatedAt={now.toISOString()}
        anySourceWarmingUp={anySourceWarmingUp}
        anySnapshotSourceDegraded={anySnapshotSourceDegraded}
        isAdmin={isAdmin}
      />
    </div>
  );
}
