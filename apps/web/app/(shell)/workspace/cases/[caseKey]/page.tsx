import { prisma } from "@dpf/db";
import { can } from "@/lib/permissions";
import { loadAuthorizedWorkspaceCase } from "@/lib/work-management/workspace-case-detail.server";
import { createWorkroomProcessSnapshot } from "@/lib/work-management/workroom-process-snapshot";
import { projectRoomShape } from "@/lib/work-management/shape-projection";
import { namespaceMessages } from "@dpf/i18n";
import { notFound, redirect } from "next/navigation";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { RoomWorkforcePanel } from "@/components/workspace/workroom/RoomWorkforcePanel";
import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { canonicalWorkCaseHref } from "@/lib/work-management/canonical-case-key";
import { loadRoomWorkforce } from "@/lib/work-management/room-workforce.server";
import { loadNestedRoomCoordination } from "@/lib/work-management/nested-room-coordination.server";
import { resolveHumanWorkroomAccess } from "@/lib/work-management/workroom-agent-access.server";
import { loadWorkroomStageDecisionView } from "@/lib/work-management/workroom-stage-decision.server";
import { loadWorkroomShapeRebindView } from "@/lib/work-management/workroom-shape-rebind.server";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { loadWorkroomFlowMap } from "@/lib/work-management/workroom-flow-map.server";

type Props = {
  params: Promise<{ caseKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkspaceCaseDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { caseKey } = await params;
  const query = await searchParams;
  const selectedWorkroomId = typeof query.workroom === "string" ? query.workroom : undefined;
  if (query.workroom !== undefined && !selectedWorkroomId) notFound();
  const resolved = await loadAuthorizedWorkspaceCase({ caseKey, selectedWorkroomId, user: session.user });
  if (!resolved) notFound();
  if (resolved.canonicalCaseKey !== resolved.caseKey)
    redirect(canonicalWorkCaseHref(resolved.canonicalCaseKey, query, caseKey));
  const detailOrRoom = resolved.detail;

  // Reuse the authorized selection that supplied process and evidence. A second
  // oldest-room lookup can display a different workforce for the same page.
  const workforce = detailOrRoom.workroomRowId
    ? await loadRoomWorkforce(prisma as never, { workroomId: detailOrRoom.workroomRowId })
    : null;
  const coordination = detailOrRoom.workroomRowId ? await loadNestedRoomCoordination(prisma as never, {
    roomId: detailOrRoom.workroomRowId,
    canReadRoom: async workroomId => (await resolveHumanWorkroomAccess({
      userId: session.user.id, workroomId, requested: "content",
    })).decision.level === "content",
  }).catch(() => ({ delegations: [], escalation: {
    state: "setup-required" as const, reason: "coordination-read-unavailable", steps: [],
  } })) : null;
  // The governed decision this room waits on, if a person records it here. A
  // failed read hides the control (the room still says it is waiting) rather
  // than taking the page down.
  const stageDecision = detailOrRoom.workroomRowId
    ? await loadWorkroomStageDecisionView(prisma as never, {
      caseKey, roomRowId: detailOrRoom.workroomRowId, userId: session.user.id,
    }).catch(() => null)
    : null;
  // A newer version of the room's work shape, when the room is behind (BI-CB5C0DCE).
  const human = await currentUserContext(session.user.id).catch(() => null);
  const shapeRebind = detailOrRoom.workroomRowId
    ? await loadWorkroomShapeRebindView(prisma as never, {
      caseKey, roomRowId: detailOrRoom.workroomRowId, userId: session.user.id,
      callerHasManagePlatform: Boolean(human && can(human, "manage_platform")),
    }).catch(() => null)
    : null;
  // EP-B70E718D F3: the room's flow map. A failed read hides the map rather
  // than taking the page down; the step list below it still renders.
  let flowReadFailed = false;
  const flowMap = detailOrRoom.workroomRowId
    ? await loadWorkroomFlowMap(prisma as never, { roomRowId: detailOrRoom.workroomRowId }).catch(() => { flowReadFailed = true; return null; })
    : null;
  const locale = await getLocaleContext();
  const refreshTarget = detailOrRoom.workroomRowId && detailOrRoom.room
    ? { caseKey: resolved.caseKey, workroomRowId: detailOrRoom.workroomRowId, workroom: selectedWorkroomId ?? null } : undefined;
  const processSnapshot = refreshTarget && detailOrRoom.room ? createWorkroomProcessSnapshot(refreshTarget,
    projectRoomShape(detailOrRoom.room), { definition: detailOrRoom.room.identity.definition, mode: detailOrRoom.room.mode,
      activeCycle: Boolean(detailOrRoom.room.currentCycle) }, flowMap, flowReadFailed) : undefined;

  return (
    <>
      <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
        <WorkCaseDetailView detail={detailOrRoom} workforce={workforce} stageDecision={stageDecision} shapeRebind={shapeRebind}
          flowMap={flowMap} refreshTarget={refreshTarget} processSnapshot={processSnapshot} navigationContext={query} />
      </MessagesProvider>
      {workforce ? (
        <div className="mt-4">
          <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
          <RoomWorkforcePanel
            accountability={workforce.accountability}
            accountableDisplayName={workforce.accountableDisplayName}
            groups={workforce.groups}
            matched={workforce.matched}
            partial={workforce.partial}
            coordination={coordination}
          />
          </MessagesProvider>
        </div>
      ) : null}
    </>
  );
}
