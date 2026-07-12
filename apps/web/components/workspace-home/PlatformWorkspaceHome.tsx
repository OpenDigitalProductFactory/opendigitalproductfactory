import { ActivityFeed } from "@/components/workspace/ActivityFeed";
import { BusinessAgenda } from "@/components/workspace/BusinessAgenda";
import { BusinessCommandCenter } from "@/components/workspace/BusinessCommandCenter";
import { WorkspaceAreaLauncher } from "@/components/workspace-home/WorkspaceAreaLauncher";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";

type PlatformWorkspaceHomeProps = {
  data: Omit<PlatformWorkspaceHomeData, "storefrontConfig">;
  heading?: string;
  /**
   * BI-655418A7: Simple (worker) mode keeps attention + day agenda and hides the
   * dense multi-area launcher that made Simple feel like a no-op on the home.
   */
  density?: "simple" | "full";
};

export function PlatformWorkspaceHome({
  data,
  heading = "Workspace",
  density = "full",
}: PlatformWorkspaceHomeProps) {
  const {
    workspaceSections,
    workspaceCommandCenter,
    calendarEvents,
    feedItems,
  } = data;
  const simple = density === "simple";

  return (
    <div data-workspace-density={density}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--dpf-text)]">{heading}</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          {simple
            ? "Simple view — focus on what needs you now. Switch to Full in the rail for every area."
            : "Your day at a glance — what needs doing now and next."}
        </p>
      </div>

      <BusinessCommandCenter view={workspaceCommandCenter.commandCenter} />

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BusinessAgenda events={calendarEvents} />
        <div>
          <p className="mb-3 text-xs uppercase tracking-widest text-[var(--dpf-muted)]">
            Activity
          </p>
          <ActivityFeed items={feedItems} />
        </div>
      </div>

      {!simple && (
        <WorkspaceAreaLauncher
          sections={workspaceSections}
          tileStatus={workspaceCommandCenter.tileStatus}
        />
      )}
    </div>
  );
}
