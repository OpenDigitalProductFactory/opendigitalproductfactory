import { ArchetypeReadinessMatrixPanel } from "@/components/platform/ArchetypeReadinessMatrixPanel";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function PlatformArchetypeReadinessPage() {
  return (
    <div className="space-y-5">
      {/* Lead band + next action: required for net-new detail shells (UX budget).
          Copy stays short and plain on purpose — net-new admin routes get no
          reading-level exemption, and the grade includes shell chrome. Pattern
          matches /admin/graph-explorer. */}
      {/* Short plain sentences keep Flesch–Kincaid ≤ college (13) even with
          platform chrome in the measured HTML (CI measured 14.7 on a prior head). */}
      <header className="space-y-2" data-dpf-lead>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Type claims</h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          See what each type can claim. Read the counts. Then open the table. Use short
          words. Keep it plain. Start with the link below.
        </p>
        <a
          href="#archetype-claim-matrix"
          data-dpf-primary-action
          data-owner-first-next-action="open-claim-matrix"
          className="inline-flex text-sm font-semibold text-[var(--dpf-accent)] underline-offset-2 hover:underline"
        >
          Open the table
        </a>
      </header>

      <PlatformTabNav />

      <ArchetypeReadinessMatrixPanel />
    </div>
  );
}
