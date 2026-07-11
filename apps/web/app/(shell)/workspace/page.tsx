// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { PlatformWorkspaceHome } from "@/components/workspace-home/PlatformWorkspaceHome";
import { VerticalWorkspaceHome } from "@/components/workspace-home/VerticalWorkspaceHome";
import { NeedsYouBand } from "@/components/attention/NeedsYouBand";
import { LocalOnlyProviderNotice } from "@/components/workspace-home/LocalOnlyProviderNotice";
import { UnconfiguredWorkspaceHomeNotice } from "@/components/workspace-home/UnconfiguredWorkspaceHomeNotice";
import { loadPlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import { resolveWorkspaceHomeContribution } from "@/lib/workspace-home/registry";
import { recordWorkspaceHomeResolution } from "@/lib/workspace-home/telemetry";
import {
  isSimpleNavMode,
  NAV_MODE_COOKIE,
  resolveNavModeFromCookie,
} from "@/lib/navigation/nav-mode";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // BI-655418A7: Simple mode must condense the home body, not only the rail.
  const navMode = resolveNavModeFromCookie((await cookies()).get(NAV_MODE_COOKIE)?.value);
  const simpleHome = isSimpleNavMode(navMode);

  const platformHomeData = await loadPlatformWorkspaceHomeData({
    prismaClient: prisma,
    user: session.user,
  });
  const workspaceHomeResolution = resolveWorkspaceHomeContribution({
    storefrontConfig: platformHomeData.storefrontConfig,
  });

  const hasCloudProvider =
    (await prisma.modelProvider.count({
      where: { status: "active", NOT: { providerId: "local" } },
    })) > 0;
  // Fire-and-forget — the metric increment is observability, not load-bearing,
  // and we don't want a Prometheus registry mishap to break the page render.
  void recordWorkspaceHomeResolution(
    workspaceHomeResolution,
    platformHomeData.storefrontConfig?.archetype ?? null,
  ).catch(() => {
    // Swallow — counter recording must not affect the response.
  });

  return (
    <div data-nav-mode={navMode}>
      {workspaceHomeResolution.mode === "unconfigured" && <UnconfiguredWorkspaceHomeNotice />}
      {workspaceHomeResolution.mode !== "unconfigured" && !hasCloudProvider && (
        <LocalOnlyProviderNotice />
      )}
      {/* The "Needs you" attention band — first-viewport decisions that need a human
          now, separate from the work backlog (EP-ATTENTION-SURFACE). Renders nothing
          when the queue is empty. */}
      <NeedsYouBand userId={session.user.id} />
      {workspaceHomeResolution.mode === "vertical" ? (
        <VerticalWorkspaceHome
          contribution={workspaceHomeResolution.contribution}
          data={platformHomeData}
        />
      ) : (
        <PlatformWorkspaceHome
          data={platformHomeData}
          density={simpleHome ? "simple" : "full"}
        />
      )}
    </div>
  );
}
