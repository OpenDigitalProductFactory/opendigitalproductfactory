import { ArchetypeReadinessMatrixPanel } from "@/components/platform/ArchetypeReadinessMatrixPanel";
import { PlatformTabNav } from "@/components/platform/PlatformTabNav";

export default function PlatformArchetypeReadinessPage() {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">
          Archetype Readiness
        </h1>
        <p className="max-w-3xl text-sm leading-5 text-[var(--dpf-muted)]">
          Operator view of the evidence-backed claim gate for business archetype coverage.
        </p>
      </header>

      <PlatformTabNav />

      <ArchetypeReadinessMatrixPanel />
    </div>
  );
}
