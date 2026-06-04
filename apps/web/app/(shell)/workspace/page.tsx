// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { PlatformWorkspaceHome } from "@/components/workspace-home/PlatformWorkspaceHome";
import { UnconfiguredWorkspaceHomeNotice } from "@/components/workspace-home/UnconfiguredWorkspaceHomeNotice";
import { loadPlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import { resolveWorkspaceHomeContribution } from "@/lib/workspace-home/registry";
import { recordWorkspaceHomeResolution } from "@/lib/workspace-home/telemetry";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const platformHomeData = await loadPlatformWorkspaceHomeData({
    prismaClient: prisma,
    user: session.user,
  });
  const workspaceHomeResolution = resolveWorkspaceHomeContribution({
    storefrontConfig: platformHomeData.storefrontConfig,
  });
  // Fire-and-forget — the metric increment is observability, not load-bearing,
  // and we don't want a Prometheus registry mishap to break the page render.
  void recordWorkspaceHomeResolution(
    workspaceHomeResolution,
    platformHomeData.storefrontConfig?.archetype ?? null,
  ).catch(() => {
    // Swallow — counter recording must not affect the response.
  });

  return (
    <div>
      {workspaceHomeResolution.mode === "unconfigured" && <UnconfiguredWorkspaceHomeNotice />}
      <PlatformWorkspaceHome data={platformHomeData} />
    </div>
  );
}
