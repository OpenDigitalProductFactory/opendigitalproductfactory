import { TeardownControl } from "@/components/ops/TeardownControl";
import { OpsTabNav } from "@/components/ops/OpsTabNav";
import { listInstallationTeardownEvidence } from "@/lib/actions/teardown";

export default async function TeardownPage() {
  // This action applies the canonical manage_platform gate. Do not catch the
  // authorization error: unlike routine operations views, teardown is HR-000
  // only and must fail closed at the route boundary.
  const evidence = await listInstallationTeardownEvidence();

  return (
    <div>
      <div className="mb-6" data-dpf-lead>
        <p className="text-dpf-caption font-semibold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
          Installation lifecycle
        </p>
        <h1 className="mt-1 text-xl font-bold text-[var(--dpf-text)]">Governed teardown</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
          Stop, reset, or remove this installation through the same governed boundary used for upgrades. Recovery evidence remains outside the deletion boundary.
        </p>
      </div>

      <OpsTabNav />

      <div className="mt-5">
        <TeardownControl initialEvidence={evidence} />
      </div>
    </div>
  );
}
