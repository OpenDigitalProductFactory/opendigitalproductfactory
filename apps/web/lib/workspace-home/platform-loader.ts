import type { PrismaClient } from "@dpf/db";

import { getActivityFeed, type FeedItem } from "@/lib/activity-feed-data";
import { getCalendarEvents, type CalendarEventView } from "@/lib/calendar-data";
import { getWorkspaceSections, type UserContext, type WorkspaceSection } from "@/lib/permissions";
import {
  loadWorkspaceCommandCenter,
  type WorkspaceCommandCenterSummary,
} from "@/lib/workspace-home/command-center";

import type { WorkspaceHomeStorefrontConfigRef } from "./types";

export type PlatformWorkspaceHomeUser = UserContext & {
  id?: string | null;
};

export type PlatformWorkspaceHomeData = {
  workspaceSections: WorkspaceSection[];
  workspaceCommandCenter: WorkspaceCommandCenterSummary;
  calendarEvents: CalendarEventView[];
  archetypeCategory: string | null;
  feedItems: FeedItem[];
  storefrontConfig: WorkspaceHomeStorefrontConfigRef;
};

export async function loadPlatformWorkspaceHomeData({
  prismaClient,
  user,
  now = new Date(),
}: {
  prismaClient: PrismaClient;
  user: PlatformWorkspaceHomeUser;
  now?: Date;
}): Promise<PlatformWorkspaceHomeData> {
  const workspaceSections = getWorkspaceSections({
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });

  const workspaceCommandCenter = await loadWorkspaceCommandCenter(prismaClient);

  const calRangeStart = new Date(now.getFullYear(), now.getMonth(), -7);
  const calRangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 7);
  const [calendarEvents, storefrontConfig] = await Promise.all([
    getCalendarEvents(calRangeStart, calRangeEnd),
    prismaClient.storefrontConfig
      .findFirst({
        select: {
          archetype: {
            select: {
              archetypeId: true,
              category: true,
              name: true,
              activationProfile: true,
            },
          },
        },
      })
      .catch(() => null),
  ]);

  const currentUserProfile = await prismaClient.employeeProfile
    .findUnique({
      where: { userId: user.id ?? "" },
      select: { id: true, managerEmployeeId: true },
    })
    .catch(() => null);
  const hasDirectReports = currentUserProfile
    ? (await prismaClient.employeeProfile.count({
        where: { managerEmployeeId: currentUserProfile.id },
      })) > 0
    : false;
  const isHR =
    user.isSuperuser || user.platformRole === "HR-000" || user.platformRole === "HR-100";
  const feedItems = await getActivityFeed(currentUserProfile?.id ?? null, hasDirectReports, isHR);

  return {
    workspaceSections,
    workspaceCommandCenter,
    calendarEvents,
    archetypeCategory: storefrontConfig?.archetype?.category ?? null,
    feedItems,
    storefrontConfig,
  };
}
