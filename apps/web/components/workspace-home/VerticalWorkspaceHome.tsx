import { AlertTriangle, CheckCircle2, LayoutDashboard, Route, UsersRound } from "lucide-react";

import { PlatformWorkspaceHome } from "./PlatformWorkspaceHome";
import type { PlatformWorkspaceHomeData } from "@/lib/workspace-home/platform-loader";
import type {
  WorkspaceHomeComponentDescriptor,
  WorkspaceHomeContribution,
  WorkspaceHomeSlot,
} from "@/lib/workspace-home/types";

type VerticalWorkspaceHomeProps = {
  contribution: WorkspaceHomeContribution;
  data: Omit<PlatformWorkspaceHomeData, "storefrontConfig">;
};

const zoneLabel: Record<string, string> = {
  "critical-strip": "Now",
  primary: "Needs review",
  secondary: "Supporting view",
  briefing: "Coworker briefing",
  setup: "Setup",
};

const slotIcon = {
  "today-now": Route,
  "exceptions-needs-review": AlertTriangle,
  "coworker-handoffs": UsersRound,
} as const;

function formatToken(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function componentsForSlot(
  slot: WorkspaceHomeSlot,
  components: WorkspaceHomeComponentDescriptor[],
) {
  return components.filter((component) => component.slotId === slot.id);
}

export function VerticalWorkspaceHome({ contribution, data }: VerticalWorkspaceHomeProps) {
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
            <h1 id="vertical-workspace-title" className="text-2xl font-bold text-[var(--dpf-text)]">
              {contribution.label}
            </h1>
            {contribution.primaryOperatingQuestion && (
              <p className="mt-2 max-w-3xl text-sm text-[var(--dpf-muted)]">
                The worker arrives asking: {contribution.primaryOperatingQuestion}
              </p>
            )}
          </div>

          <div
            className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] px-3 py-2"
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

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {contribution.slots.map((slot) => {
              const SlotIcon = slotIcon[slot.id as keyof typeof slotIcon] ?? CheckCircle2;
              const slotComponents = componentsForSlot(slot, contribution.components);
              return (
                <section
                  key={slot.id}
                  aria-label={slot.label}
                  className="min-h-48 border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3"
                  style={{ borderRadius: 8 }}
                >
                  <div className="mb-3 flex items-start gap-2">
                    <SlotIcon size={16} className="mt-0.5 shrink-0 text-[var(--dpf-accent)]" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                        {zoneLabel[slot.zone ?? ""] ?? formatToken(slot.zone ?? "workspace")}
                      </div>
                      <h2 className="text-sm font-bold text-[var(--dpf-text)]">{slot.label}</h2>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {slotComponents.map((component) => (
                      <div
                        key={`${slot.id}:${component.key}:${component.primitiveKey}`}
                        className="border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] px-3 py-2"
                        style={{ borderRadius: 6 }}
                      >
                        <div className="text-sm font-semibold text-[var(--dpf-text)]">
                          {component.title}
                        </div>
                        <div className="mt-1 text-[11px] font-medium uppercase tracking-widest text-[var(--dpf-muted)]">
                          {formatToken(component.primitiveKey)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          <aside
            aria-label="Top concerns"
            className="border border-[var(--dpf-border)] bg-[var(--dpf-bg)] p-3"
            style={{ borderRadius: 8 }}
          >
            <div className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              Top concerns
            </div>
            <ol className="mt-3 space-y-2">
              {contribution.topConcerns.map((concern, index) => (
                <li key={concern} className="flex gap-2 text-sm text-[var(--dpf-text)]">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-xs font-bold"
                    style={{ borderRadius: 6 }}
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0 pt-0.5">{concern}</span>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>

      <PlatformWorkspaceHome data={data} heading="Platform workspace" />
    </div>
  );
}
