import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { SystemHealthDashboard } from "@/components/monitoring/SystemHealthDashboard";

export default function SystemHealthPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Platform operational health and resource monitoring
        </p>
      </div>

      <OpsTabNav />

      <SystemHealthDashboard />
    </div>
  );
}
