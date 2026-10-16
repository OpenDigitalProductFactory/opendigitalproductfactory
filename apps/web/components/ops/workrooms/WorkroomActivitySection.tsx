import { prisma } from "@dpf/db";
import { namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { getLocaleContext } from "@/lib/i18n/locale-context.server";
import Link from "next/link";

import { getT } from "@/lib/i18n/t.server";

import { PortfolioActivityTree } from "@/components/ops/workrooms/PortfolioActivityTree";
import { WorkroomInventory, type WorkroomInventoryRow } from "@/components/ops/workrooms/WorkroomInventory";
import { Surface } from "@/components/ui/Surface";
import type { WorkPortfolioRoleKey } from "@/lib/navigation/area-portfolio";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";
import { countOperatorAttention, projectWorkroomOperatorSummary } from "@/lib/work-capsules/workroom-operator-summary";
import { loadRoomAccountabilityBatch } from "@/lib/work-management/room-workforce.server";
import { portfolioRoleLabel } from "@/lib/work-capsules/work-capsule-presenter";
import { encodeWorkCaseKey } from "@/lib/work-management/case-key";
import {
  projectPortfolioActivityPage,
  type RoomActivityInput,
} from "@/lib/work-management/portfolio-activity-projection";

/** Rooms read for one render. */
const WORKROOM_READ_LIMIT = 200;

/** The one Workroom query both views run: every room, or one portfolio's rooms. */
export function workroomInventoryWhere(portfolioRole?: WorkPortfolioRoleKey): Record<string, unknown> {
  return portfolioRole ? { portfolioRole } : {};
}

type Props = {
  /** Scope the inventory to one portfolio (an area's Work view). Unset = all rooms. */
  portfolioRole?: WorkPortfolioRoleKey;
  /** What to call the scope in the lead band, e.g. "Serve & grow". */
  scopeLabel?: string;
  /** Rendered between the lead band and the activity tree (the page's held rooms). */
  children?: React.ReactNode;
  heldCapsuleIds?: string[];
};

/**
 * The workroom inventory: live-vs-history lead band, activity by portfolio and
 * the room list. `/ops/workrooms` renders it unscoped; each area's Work view
 * renders it for one portfolio (EP-2FB6C0CC, spec §9.3). One loader and one
 * component, so an area view can never drift into a second inventory.
 */
export async function WorkroomActivitySection({ portfolioRole, scopeLabel, children, heldCapsuleIds = [] }: Props) {
  const t = await getT("shell");
  const locale = await getLocaleContext();
  const inventory = await loadCapsuleLivenessInventory(prisma, {
    where: workroomInventoryWhere(portfolioRole),
    take: WORKROOM_READ_LIMIT,
    portalSummary: true,
  });
  // A full page means the read stopped at its limit, so branch counts describe
  // the rooms read rather than the rooms that exist. The tree is told, and says so.
  const roomReadBounded = inventory.capsulesAll.length >= WORKROOM_READ_LIMIT;
  const owners = await loadRoomAccountabilityBatch(prisma, inventory.capsulesAll
    .flatMap(room => typeof room.id === "string" ? [room.id] : []));
  // The client receives display fields only, never scope, outcome or recovery packets.
  const workrooms = inventory.capsulesAll.map((room) => {
    const owner = owners.get(String(room.id));
    const display = room as unknown as WorkroomInventoryRow;
    return {
      capsuleId: display.capsuleId, backlogItemId: display.backlogItemId,
      title: display.title, status: display.status, source: display.source,
      executorKind: display.executorKind, attribution: display.attribution,
      portfolioRole: display.portfolioRole, headBranch: display.headBranch,
      pullRequestUrl: display.pullRequestUrl,
      updatedAt: room.updatedAt instanceof Date ? room.updatedAt.toISOString() : String(room.updatedAt),
      liveness: display.liveness, isLive: display.isLive, isReapable: display.isReapable,
      livenessReason: display.livenessReason, trueLivenessAt: display.trueLivenessAt,
      accountableName: owner?.accountableDisplayName ?? null,
      operator: projectWorkroomOperatorSummary({ ...display,
        accountability: owner?.accountability,
        drive: room.drive as { action: string | null; reason: string | null; attentionRecorded?: boolean } | undefined }),
    };
  });

  // Map only from evidence the inventory actually carries. `latestAction` stays
  // null where no concrete action was recorded — the projection then says so
  // rather than manufacturing one — and a blocked room contributes its recorded
  // liveness reason as the blocker. Nothing here asserts a verified receipt,
  // because a terminal status is not one.
  const activityRooms: RoomActivityInput[] = workrooms.map((room) => ({
    roomId: room.capsuleId,
    title: room.title,
    portfolioRole: (room.portfolioRole ?? null) as RoomActivityInput["portfolioRole"],
    branchId: room.portfolioRole ?? "unplaced",
    href: `/workspace/cases/${encodeWorkCaseKey({ sourceType: "work-capsule", sourceId: room.capsuleId })}`,
    status: room.status,
    latestAction: null,
    blocker: room.status === "blocked" ? room.livenessReason : null,
    evidenceAt: room.trueLivenessAt ?? null,
  }));
  const activity = projectPortfolioActivityPage({ rooms: activityRooms, now: new Date(), pageSize: 50 });
  // Labels are resolved here and passed as data. The tree is a client component,
  // and a formatter function cannot cross the server/client boundary.
  const activityRows = activity.rows.map((row) => ({
    ...row,
    label:
      row.branchId === "unplaced"
        ? "Not placed in a portfolio"
        : portfolioRoleLabel(row.branchId as Parameters<typeof portfolioRoleLabel>[0]),
  }));
  const working = workrooms.filter(room => room.operator.group === "working").length;
  const sharedRecoveryIds = children ? heldCapsuleIds : [];
  const attention = countOperatorAttention(workrooms.filter(room => room.operator.group === "attention")
    .map(room => room.capsuleId), sharedRecoveryIds);
  const where = scopeLabel ? ` in ${scopeLabel}` : "";

  return (
    <MessagesProvider locale={locale.language} messages={{ workrooms: namespaceMessages(locale.language, "workrooms") }}>
      <Surface data-dpf-lead className="my-6" rounded="xl">
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {working} working now{where} · {attention} need attention.
        </p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {roomReadBounded ? "200 recent rooms, plus shared recovery issues." : "Counts cover the rooms in this view."} Routine expiry follows the existing cleanup policy.
        </p>
        <Link data-owner-first-next-action href="#live-workrooms-heading" className="mt-3 inline-block text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          {t("area.reviewLive")}
        </Link>
      </Surface>
      <div className="mt-6">
        <WorkroomInventory workrooms={workrooms} summary={inventory.livenessSummary}
          heldCapsuleIds={sharedRecoveryIds} attentionContent={children} />
      </div>
      {!portfolioRole && (
        <details className="mt-6 rounded-dpf-xl border border-dpf-border p-4">
          <summary className="cursor-pointer text-dpf-body font-dpf-semibold">{t("area.activityHeading")}</summary>
          <PortfolioActivityTree rows={activityRows} partial={activity.partial} roomReadBounded={roomReadBounded} />
        </details>
      )}
    </MessagesProvider>
  );
}
