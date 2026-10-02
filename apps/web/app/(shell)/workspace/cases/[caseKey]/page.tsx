import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";
import { notFound, redirect } from "next/navigation";

import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { RoomWorkforcePanel } from "@/components/workspace/workroom/RoomWorkforcePanel";
import { WorkCaseDetailView } from "@/components/workspace/WorkCaseDetailView";
import { auth } from "@/lib/auth";
import { can, getGrantedCapabilities } from "@/lib/permissions";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import { loadEffectiveAuthContext } from "@/lib/identity/load-effective-auth-context";
import { loadPrismaWorkroomParticipants } from "@/lib/work-management/room-participation-prisma.server";
import { loadWorkroomPostureContext } from "@/lib/work-management/room-posture.server";
import { resolveWorkroomStructureForCase } from "@/lib/work-management/room-structure.server";
import { decodeWorkCaseKey } from "@/lib/work-management/case-key";
import { canonicalWorkCaseHref, resolveCanonicalWorkCaseKey } from "@/lib/work-management/canonical-case-key";
import { loadRoomWorkforce } from "@/lib/work-management/room-workforce.server";
import { loadWorkspaceWorkCaseDetail } from "@/lib/work-management/workspace-case-loader";
import { loadWorkroomOnlyCaseDetail } from "@/lib/work-management/workroom-only-case-projection";
import { loadWorkroomStageDecisionView } from "@/lib/work-management/workroom-stage-decision.server";
import { loadWorkroomShapeRebindView } from "@/lib/work-management/workroom-shape-rebind.server";
import { currentUserContext } from "@/lib/govern/current-user-context";

type Props = {
  params: Promise<{ caseKey: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function WorkspaceCaseDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const effectiveAuth = await loadEffectiveAuthContext({
    user: session.user,
    grantedCapabilities: getGrantedCapabilities({
      platformRole: session.user.platformRole,
      isSuperuser: session.user.isSuperuser,
    }),
    authentication: { source: "session" },
  });

  const { caseKey } = await params;
  const query = await searchParams;

  // A room addressed by capsule id is the same case as the WorkItem it anchors
  // to, not a second one. Send it to the canonical key so every surface that
  // links a room by capsule id lands on the one case (BI-EBEB77E2).
  const canonicalKey = await resolveCanonicalWorkCaseKey(prisma, caseKey);
  if (canonicalKey) redirect(canonicalWorkCaseHref(canonicalKey, query, caseKey));
  const selectedWorkroomId = typeof query.workroom === "string" ? query.workroom : undefined;
  if (query.workroom !== undefined && !selectedWorkroomId) notFound();

  const detail = await loadWorkspaceWorkCaseDetail({
    prismaClient: prisma,
    caseKey,
    selectedWorkroomId,
    userId: session.user.id,
    authContext: {
      principalId: effectiveAuth.principalId,
      sensitivityClearance: effectiveAuth.sensitivityClearance,
      isSuperuser: effectiveAuth.isSuperuser,
    },
    participantLoader: loadPrismaWorkroomParticipants,
    structureLoader: resolveWorkroomStructureForCase,
    postureContextLoader: loadWorkroomPostureContext,
  });
  // A room that anchors no WorkItem has no WorkItem case to resolve to, and the
  // loader keys on WorkItem source types — so 62% of the rooms on this install
  // 404'd when opened from the activity tree (BI-2C31C399). Such a room is its
  // own unit of work, so it is its own case. Composed here rather than inside
  // the loader, which is at its module-size ceiling and should not grow.
  const detailOrRoom =
    detail ??
    (await loadRoomOnlyCase(caseKey, effectiveAuth));
  if (!detailOrRoom) notFound();

  // Reuse the authorized selection that supplied process and evidence. A second
  // oldest-room lookup can display a different workforce for the same page.
  const workforce = detailOrRoom.workroomRowId
    ? await loadRoomWorkforce(prisma as never, { workroomId: detailOrRoom.workroomRowId })
    : null;
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
  const locale = await getLocaleContext();

  return (
    <>
      {stageDecision || shapeRebind ? (
        // The decision controls translate with useT("workrooms"); provide it only when rendered.
        <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
          <WorkCaseDetailView detail={detailOrRoom} workforce={workforce} stageDecision={stageDecision} shapeRebind={shapeRebind} navigationContext={query} />
        </MessagesProvider>
      ) : (
        <WorkCaseDetailView detail={detailOrRoom} workforce={workforce} navigationContext={query} />
      )}
      {workforce ? (
        <div className="mt-4">
          <RoomWorkforcePanel
            accountability={workforce.accountability}
            accountableDisplayName={workforce.accountableDisplayName}
            groups={workforce.groups}
            matched={workforce.matched}
            partial={workforce.partial}
          />
        </div>
      ) : null}
    </>
  );
}

/** The case for a Workroom addressed by capsule id that anchors no WorkItem. */
async function loadRoomOnlyCase(caseKey: string, authContext: {
  principalId: string | null; sensitivityClearance: readonly string[]; isSuperuser: boolean;
}) {
  const ref = decodeWorkCaseKey(caseKey);
  if (ref?.sourceType !== "work-capsule") return null;
  return loadWorkroomOnlyCaseDetail({
    prismaClient: prisma as never,
    sourceId: ref.sourceId,
    caseKey,
    now: new Date(),
    authContext,
  });
}
