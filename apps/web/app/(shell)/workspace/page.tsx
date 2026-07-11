// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { prisma } from "@dpf/db";
import { PlatformWorkspaceHome } from "@/components/workspace-home/PlatformWorkspaceHome";
import { VerticalWorkspaceHome } from "@/components/workspace-home/VerticalWorkspaceHome";
import { OperatorCockpit } from "@/components/workspace-home/OperatorCockpit";
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
      {/* The operator cockpit — the ONE consolidated "what needs you now" surface,
          organized OUTSIDE-IN from the customer inward, with a single attention count
          and honest customer-impact ranking (BI-8C3EB52C, BI-2651043B, BI-D35DE119).
          Supersedes the old "Needs you" band; it always states its state, so no other
          panel can contradict its count. */}
      <OperatorCockpit userId={session.user.id} />
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
