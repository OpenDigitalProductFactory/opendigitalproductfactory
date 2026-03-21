import { EaTabNav } from "@/components/ea/EaTabNav";
import { ReferenceModelDirectory } from "@/components/ea/ReferenceModelDirectory";
import { getReferenceModelsSummary } from "@/lib/ea-data";

export default async function EaReferenceModelsPage() {
  const models = await getReferenceModelsSummary();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Enterprise Architecture</h1>
        <p className="mt-0.5 text-sm text-[var(--dpf-muted)]">
          {models.length} reference model{models.length !== 1 ? "s" : ""}
        </p>
      </div>

      <EaTabNav />
      <ReferenceModelDirectory models={models} />
    </div>
  );
}
