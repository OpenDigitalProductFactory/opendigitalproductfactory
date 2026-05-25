import { Suspense } from "react";

import { AttentionStrip } from "@/components/shell/AttentionStrip";
import { WorkspaceTiles } from "@/components/shell/WorkspaceTiles";
import { ActivityFeed } from "@/components/workspace/ActivityFeed";
import { BusinessCommandCenter } from "@/components/workspace/BusinessCommandCenter";
import { WorkspaceCalendar } from "@/components/workspace/WorkspaceCalendar";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";

type PlatformWorkspaceHomeProps = {
  data: Omit<PlatformWorkspaceHomeData, "storefrontConfig">;
};

export function PlatformWorkspaceHome({ data }: PlatformWorkspaceHomeProps) {
  const {
    workspaceSections,
    workspaceCommandCenter,
    calendarEvents,
    archetypeCategory,
    feedItems,
  } = data;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--dpf-text)]">Workspace</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          Today's work, schedule, handoffs, and activity in one place.
        </p>
      </div>

      <BusinessCommandCenter view={workspaceCommandCenter.commandCenter} />

      <AttentionStrip items={workspaceCommandCenter.attentionItems} />

      <div className="space-y-8">
        {workspaceSections.map((section) => (
          <section key={section.key}>
            <div className="mb-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
                {section.label}
              </p>
              <p className="mt-1 text-sm text-[var(--dpf-muted)]">{section.description}</p>
            </div>
            <WorkspaceTiles tiles={section.tiles} tileStatus={workspaceCommandCenter.tileStatus} />
          </section>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs uppercase tracking-widest text-[var(--dpf-muted)]">
            Calendar
          </p>
          <Suspense fallback={null}>
            <WorkspaceCalendar events={calendarEvents} archetypeCategory={archetypeCategory} />
          </Suspense>
        </div>
        <div>
          <p className="mb-3 text-xs uppercase tracking-widest text-[var(--dpf-muted)]">
            Activity
          </p>
          <ActivityFeed items={feedItems} />
        </div>
      </div>
    </div>
  );
}
