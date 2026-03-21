import ChangesClient from "@/components/ops/ChangesClient";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default function ChangesPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Operations</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">
          Change requests (RFCs) and rollback management.
        </p>
      </div>

      <OpsTabNav />

      <ChangesClient />
    </div>
  );
}
