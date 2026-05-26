import path from "node:path";

import { ChangeLanesDashboard } from "@/components/platform/development/change-lanes/ChangeLanesDashboard";
import { loadContributorChangeLaneReadModel } from "@/lib/contributor-change-lanes/read-model";
import { createNodeInventoryRunners } from "@/lib/contributor-change-lanes/runners-node";

export const dynamic = "force-dynamic";

export default async function ChangeLanesPage() {
  const repoCwd = process.cwd();
  const worktreeRoot = path.join(repoCwd, ".claude", "worktrees");
  const runners = createNodeInventoryRunners({ repoCwd, worktreeRoot });

  const now = new Date();
  const { lanes, freshness } = await loadContributorChangeLaneReadModel({
    runners,
    now,
  });

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6">
      <ChangeLanesDashboard
        lanes={lanes}
        freshness={freshness}
        generatedAt={now.toISOString()}
      />
    </div>
  );
}
