import { getDemandItems } from "@/lib/demand/demand-data";
import { DemandBoard } from "@/components/ops/DemandBoard";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export const dynamic = "force-dynamic";

export default async function DemandPage() {
  const items = await getDemandItems();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Demand</h1>
        <p className="mt-1 text-sm text-[var(--dpf-muted)]">
          What&apos;s being asked for, how valuable, and how big — ranked so the highest value-per-effort
          work is drawn first.
        </p>
      </div>
      <OpsTabNav />
      <DemandBoard items={JSON.parse(JSON.stringify(items))} />
    </div>
  );
}
