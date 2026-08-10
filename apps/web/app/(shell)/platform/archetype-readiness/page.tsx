import { ArchetypeReadinessMatrixPanel } from "@/components/platform/ArchetypeReadinessMatrixPanel";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function PlatformArchetypeReadinessPage() {
  return (
    <div className="space-y-5">
      {/* Lead band + next action: required for net-new detail shells (UX budget).
          Copy stays short and plain on purpose — net-new admin routes get no
          reading-level exemption, and the grade includes shell chrome. Pattern
          matches /admin/graph-explorer. */}
      <header className="space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Archetype Readiness
        </h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          See what each business type can claim today. Read the counts. Then open the
          full table.
        </p>
        <a
          href="#archetype-claim-matrix"
          data-dpf-primary-action
          data-owner-first-next-action="open-claim-matrix"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Open the claim table
        </a>
      </header>

      <PlatformTabNav />

      <ArchetypeReadinessMatrixPanel />
    </div>
  );
}
