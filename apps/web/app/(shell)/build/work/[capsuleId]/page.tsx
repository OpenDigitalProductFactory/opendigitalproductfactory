import { notFound } from "next/navigation";

import { PortalContextStrip } from "@/components/portal-context/PortalContextStrip";
import { WorkCapsuleLaunchPanel } from "@/components/build/work-control/WorkCapsuleLaunchPanel";
import { AgentSessionFeedLive } from "@/components/build/AgentSessionFeedLive";
import { ButtonLink } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
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
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{capsule.title}</h1>
        <div className="font-mono text-xs text-[var(--dpf-muted)]">{capsule.capsuleId}</div>
      </header>
      <PortalContextStrip envelope={portalContext} />
      <Surface as="section" id="review" className="scroll-mt-20 space-y-3" aria-labelledby="delivery-review-heading">
        <div className="space-y-1">
          <h2 id="delivery-review-heading" className="text-base font-semibold text-[var(--dpf-text)]">Governed review</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Review pending governed actions in Needs you, then return here to follow the durable Workroom outcome.
          </p>
        </div>
        <ButtonLink href="/workspace/inbox" variant="secondary" className="min-h-11">
          Open Needs you
        </ButtonLink>
      </Surface>
      <Surface as="section" id="result" className="scroll-mt-20 space-y-3" aria-labelledby="delivery-result-heading">
        <div className="space-y-1">
          <h2 id="delivery-result-heading" className="text-base font-semibold text-[var(--dpf-text)]">Result and evidence</h2>
          <p className="text-sm text-[var(--dpf-muted)]">
            Canonical Workroom activity records the delivered result, verification, and any recovery evidence.
          </p>
        </div>
        <div id="activity" className="scroll-mt-20">
          <AgentSessionFeedLive
            capsuleId={capsule.capsuleId}
            initialEntries={presentAgentSession(capsule.activities).map(serializeAgentSessionEntry)}
          />
        </div>
      </Surface>
      <div id="handoff" className="scroll-mt-20">
        <WorkCapsuleLaunchPanel steps={steps} />
      </div>
    </section>
  );
}
