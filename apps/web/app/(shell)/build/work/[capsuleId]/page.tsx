import { notFound } from "next/navigation";

import { PortalContextStrip } from "@/components/portal-context/PortalContextStrip";
import { WorkCapsuleLaunchPanel } from "@/components/build/work-control/WorkCapsuleLaunchPanel";
import { AgentSessionFeedLive } from "@/components/build/AgentSessionFeedLive";
import { getCapsuleDetail } from "@/lib/actions/work-capsules";
import { auth } from "@/lib/auth";
import { resolvePortalContextEnvelope } from "@/lib/portal-context";
import { presentAgentSession } from "@/lib/work-capsules/agent-activity-presenter";
import { serializeAgentSessionEntry } from "@/lib/work-capsules/activity-stream";
import { presentLaunchInstructions } from "@/lib/work-capsules/launch-presenter";

export default async function CapsuleDetailPage({
  params,
}: {
  params: Promise<{ capsuleId: string }>;
}) {
  const { capsuleId } = await params;
  const session = await auth();
  const capsule = await getCapsuleDetail(capsuleId);
  if (!capsule) notFound();
  const portalContext = session?.user?.id
    ? await resolvePortalContextEnvelope(
        {
          pathname: `/build/work/${capsuleId}`,
          routeContext: "/build/work",
          capsuleId,
          params: { capsuleId },
        },
        session.user.id,
      )
    : null;

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
      <header id="result" className="scroll-mt-20 space-y-1">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{capsule.title}</h1>
        <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
      </header>
      <div id="review" className="scroll-mt-20">
        <PortalContextStrip envelope={portalContext} />
      </div>
      <div id="activity" className="scroll-mt-20">
        <AgentSessionFeedLive
          capsuleId={capsule.capsuleId}
          initialEntries={presentAgentSession(capsule.activities).map(serializeAgentSessionEntry)}
        />
      </div>
      <div id="handoff" className="scroll-mt-20">
        <WorkCapsuleLaunchPanel steps={steps} />
      </div>
    </section>
  );
}
