// apps/web/components/workspace-home/WorkspaceTwinHero.tsx
//
// The dedicated /workspace twin hero (EP-LIVING-BUSINESS-VIZ P3, increment 2).
// The operator confirmed a dedicated hero (parent spec §9 option c) over the
// spec's leaning (option a); the hard guardrail survives the choice: exactly ONE
// attention surface on the home. So the hero folds the `OperatorCockpit` in as its
// HUD rail (the single "what needs you now" surface, passed in) above the
// operational-twin body, with the platform tiles/launcher demoted below — reachable
// navigation, not a rival dashboard stacked beside the twin.
//
// Plan: docs/superpowers/plans/2026-07-15-twin-workspace-home-placement-execution.md

import type { ReactNode } from "react";
import { Activity } from "lucide-react";

import { WorkspaceTwinPanel } from "./WorkspaceTwinPanel";
import type { WorkspaceTwinPresentation } from "@/lib/workspace-home/twin-panel-data";
import type { WorkspaceHomeContribution } from "@/lib/workspace-home/types";

export interface WorkspaceTwinHeroProps {
  /** The single "what needs you now" attention surface, folded in as the HUD. */
  cockpit: ReactNode;
  presentation: WorkspaceTwinPresentation;
  /** Archetype workspace contribution (when one is registered) — supplies the
   *  operating question for the HUD identity line. Optional; the twin renders for
   *  every archetype whether or not a workspace-home contribution exists. */
  contribution: WorkspaceHomeContribution | null;
  /** Platform tiles / area launcher, demoted below the hero (navigation, not a
   *  rival dashboard). */
  platformBody: ReactNode;
  /** Rail nav-mode density (BI-BF53A701). In "simple" the hero condenses to the
   *  essential "what needs you now" surface: builder chrome (the "Living business"
   *  eyebrow, the operator "worker arrives asking" line) and the full
   *  operational-twin body are hidden by default. The full view is one click away
   *  via the Full toggle in the rail, so nothing is lost — it is disclosed on
   *  demand. Defaults to "full". */
  density?: "simple" | "full";
}

export function WorkspaceTwinHero({
  cockpit,
  presentation,
  contribution,
  platformBody,
  density = "full",
}: WorkspaceTwinHeroProps) {
  const simple = density === "simple";
  const operatingQuestion = contribution?.primaryOperatingQuestion ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="workspace-twin-hero-title"
        className="overflow-hidden rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
      >
        {/* HUD rail — identity + the single attention surface. */}
        <header className="border-b border-[var(--dpf-border)] px-4 pb-3 pt-4">
          {!simple && (
            <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
              <Activity size={15} aria-hidden="true" />
              Living business
            </div>
          )}
          <h1
            id="workspace-twin-hero-title"
            className="text-xl font-bold text-[var(--dpf-text)]"
          >
            {presentation.archetypeName}
          </h1>
          {!simple && operatingQuestion ? (
            <p className="mt-1 max-w-3xl text-sm text-[var(--dpf-muted)]">
              The worker arrives asking: {operatingQuestion}
            </p>
          ) : null}
        </header>

        {/* The one "what needs you now" surface, folded in as the hero HUD. */}
        <div className={simple ? "px-4 py-4" : "px-4 pt-4"}>{cockpit}</div>

        {/* The operational twin — the main workspace view in Full mode; hidden in
            Simple mode as technical detail (reachable via the Full rail toggle). */}
        {!simple && (
          <div className="px-4 pb-4">
            <WorkspaceTwinPanel presentation={presentation} />
          </div>
        )}
      </section>

      {/* Demoted: platform areas / navigation, below the hero. */}
      <section aria-label="All workspace areas">{platformBody}</section>
    </div>
  );
}
