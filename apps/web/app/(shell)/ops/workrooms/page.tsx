import { prisma } from "@dpf/db";

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { HeldWorkroomsList } from "@/components/ops/workrooms/HeldWorkroomsList";
import { WorkroomActivitySection } from "@/components/ops/workrooms/WorkroomActivitySection";
import { Surface } from "@/components/ui/Surface";
import { loadHeldWorkrooms } from "@/lib/work-management/held-workrooms";

export const dynamic = "force-dynamic";

export default async function WorkroomsPage() {
  const held = await loadHeldWorkrooms(prisma);
  // Awaited here rather than rendered as <WorkroomActivitySection>, so the page
  // resolves in one pass (and renders in tests without a Suspense boundary).
  const activity = await WorkroomActivitySection({
    children: (
      // BI-E8C78E80: rooms the drive is holding, with why and for how long.
      <Surface className="mt-6" rounded="xl">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">Held Workrooms</h2>
        <p className="mt-0.5 mb-3 text-xs text-[var(--dpf-muted)]">
          Paused or escalated by their drive, longest held first.
        </p>
        <HeldWorkroomsList rows={held} nowIso={new Date().toISOString()} />
      </Surface>
    ),
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Work in progress</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Workrooms in motion and their retained activity — one operational inventory across business work, coworkers, and development.
        </p>
      </div>
      <OpsTabNav />
      {activity}
    </div>
  );
}
