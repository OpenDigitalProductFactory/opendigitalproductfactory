import { prisma } from "@dpf/db";
import Link from "next/link";

import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { WorkroomInventory, type WorkroomInventoryRow } from "@/components/ops/workrooms/WorkroomInventory";
import { Surface } from "@/components/ui/Surface";
import { loadCapsuleLivenessInventory } from "@/lib/work-capsules/liveness-inventory";

export const dynamic = "force-dynamic";

export default async function WorkroomsPage() {
  const inventory = await loadCapsuleLivenessInventory(prisma, { where: {}, take: 200 });
  const workrooms = inventory.capsulesAll.map((room) => ({
    ...room,
    updatedAt: room.updatedAt instanceof Date ? room.updatedAt.toISOString() : String(room.updatedAt),
  })) as WorkroomInventoryRow[];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="mt-0.5 max-w-3xl text-sm text-[var(--dpf-muted)]">
          Workrooms in motion and their retained activity — one operational inventory across business work, coworkers, and development.
        </p>
      </div>
      <OpsTabNav />
      <Surface data-dpf-lead className="my-6" rounded="xl">
        <p className="text-sm font-medium text-[var(--dpf-text)]">
          {inventory.livenessSummary.live === 0
            ? "No Workrooms have live execution evidence right now."
            : `${inventory.livenessSummary.live} Workroom${inventory.livenessSummary.live === 1 ? " is" : "s are"} live right now.`}
        </p>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          {inventory.livenessSummary.history} retained record{inventory.livenessSummary.history === 1 ? " is" : "s are"} history, not active work.
        </p>
        <Link data-owner-first-next-action href="#live-workrooms-heading" className="mt-3 inline-block text-xs font-medium text-[var(--dpf-accent)] hover:underline">
          Review live Workrooms
        </Link>
      </Surface>
      <div className="mt-6">
        <WorkroomInventory workrooms={workrooms} summary={inventory.livenessSummary} />
      </div>
    </div>
  );
}
