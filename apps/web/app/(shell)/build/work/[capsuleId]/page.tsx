import { notFound } from "next/navigation";

import { WorkCapsuleLaunchPanel } from "@/components/build/work-control/WorkCapsuleLaunchPanel";
import { getCapsuleDetail } from "@/lib/actions/work-capsules";
import { presentLaunchInstructions } from "@/lib/work-capsules/launch-presenter";

export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ capsuleId: string }>;
}) {
  const { capsuleId } = await params;
  const capsule = await getCapsuleDetail(capsuleId);
  if (!capsule) notFound();

  const steps = presentLaunchInstructions(
    {
      capsuleId: capsule.capsuleId,
      headBranch: capsule.headBranch,
      worktreePath: capsule.worktreePath,
      baseBranch: capsule.baseBranch,
    },
    process.platform,
  );

  return (
    <section className="space-y-4 px-4 py-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{capsule.title}</h1>
        <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
      </header>
      <WorkCapsuleLaunchPanel steps={steps} />
    </section>
  );
}
