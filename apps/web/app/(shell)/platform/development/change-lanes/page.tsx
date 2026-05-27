import { ChangeLanesDashboard } from "@/components/platform/development/change-lanes/ChangeLanesDashboard";
import { loadContributorChangeLaneReadModel } from "@/lib/contributor-change-lanes/read-model";

export const dynamic = "force-dynamic";

export default async function ChangeLanesPage() {
  const now = new Date();
  const { lanes, freshness, anySourceWarmingUp, anySnapshotSourceDegraded } =
    await loadContributorChangeLaneReadModel({ now });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <ChangeLanesDashboard
        lanes={lanes}
        freshness={freshness}
        generatedAt={now.toISOString()}
        anySourceWarmingUp={anySourceWarmingUp}
        anySnapshotSourceDegraded={anySnapshotSourceDegraded}
      />
    </div>
  );
}
