// VerticalWorkspaceHome — the archetype IDENTITY banner above the workspace home.
//
// BI-8C3EB52C / BI-2651043B: this used to stack a second "what to do now" surface
// on top of the OperatorCockpit — static NOW / NEEDS REVIEW / COWORKER BRIEFING slot
// cards and a numbered "Top concerns" priority list, none of it live. That was one of
// the three competing framings the operator had to reconcile. It is now a slim
// identity banner: it NAMES the archetype workspace and what it watches (context), and
// defers all live "what needs you now" to the single OperatorCockpit above it. The
// archetype's configured slots and concerns render as muted context, not as a rival
// action queue.

import { LayoutDashboard } from "lucide-react";

import { PlatformWorkspaceHome } from "./PlatformWorkspaceHome";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import type { WorkspaceHomeContribution } from "@/lib/workspace-home/types";

type VerticalWorkspaceHomeProps = {
  contribution: WorkspaceHomeContribution;
  data: Omit<PlatformWorkspaceHomeData, "storefrontConfig">;
};

export function VerticalWorkspaceHome({ contribution, data }: VerticalWorkspaceHomeProps) {
  // What this archetype workspace covers — the configured component titles, deduped,
  // rendered as muted identity context (NOT a live action queue).
  const coverage = [...new Set(contribution.components.map((component) => component.title))];

  return (
    <div>
      <section
        aria-labelledby="vertical-workspace-title"
        className="mb-6 border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 text-[var(--dpf-text)]"
        style={{ borderRadius: 8 }}
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              <LayoutDashboard size={15} aria-hidden="true" />
              Archetype Workspace
            </div>
            <h2 id="vertical-workspace-title" className="text-xl font-bold text-[var(--dpf-text)]">
              {contribution.label}
            </h2>
            {contribution.primaryOperatingQuestion && (
              <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
                The worker arrives asking: {contribution.primaryOperatingQuestion}
              </p>
            )}

            {coverage.length > 0 && (
              <p className="mt-3 text-xs text-[var(--dpf-muted)]">
                <span className="font-semibold uppercase tracking-widest">Covers</span>{" "}
                {coverage.join(" · ")}
              </p>
            )}
            {contribution.topConcerns.length > 0 && (
              <p className="mt-1.5 text-xs text-[var(--dpf-muted)]">
                <span className="font-semibold uppercase tracking-widest">Watches for</span>{" "}
                {contribution.topConcerns.join(" · ")}
              </p>
            )}
            <p className="mt-3 text-[11px] text-[var(--dpf-muted)]">
              Live decisions that need you appear in “What needs you now” above.
            </p>
          </div>

          <div
            className="shrink-0 border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
            style={{ borderRadius: 8 }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              Profile
            </div>
            <div className="mt-1 text-sm font-semibold text-[var(--dpf-text)]">
              {contribution.setupActivation.status === "ready" ? "Ready" : "Needs data"}
            </div>
          </div>
        </div>
      </section>

      <PlatformWorkspaceHome data={data} heading="Platform workspace" />
    </div>
  );
}
