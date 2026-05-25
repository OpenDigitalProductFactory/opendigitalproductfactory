// apps/web/app/(shell)/workspace/page.tsx
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";
import { PlatformWorkspaceHome } from "@/components/workspace-home/PlatformWorkspaceHome";
import { UnconfiguredWorkspaceHomeNotice } from "@/components/workspace-home/UnconfiguredWorkspaceHomeNotice";
import { loadPlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import { resolveWorkspaceHomeContribution } from "@/lib/workspace-home/registry";

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

  return (
    <div>
      {workspaceHomeResolution.mode === "unconfigured" && <UnconfiguredWorkspaceHomeNotice />}
      <PlatformWorkspaceHome data={platformHomeData} />
    </div>
  );
}
