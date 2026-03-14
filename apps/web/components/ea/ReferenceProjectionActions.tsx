import Link from "next/link";
import type { ReferenceModelDetail } from "@/lib/reference-model-types";

type Props = {
  referenceModelSlug: string;
  valueStreamProjection: ReferenceModelDetail["valueStreamProjection"];
  loadValueStreamProjection?: (formData: FormData) => void | Promise<void>;
};

export function ReferenceProjectionActions({
  referenceModelSlug,
  valueStreamProjection,
  loadValueStreamProjection,
}: Props) {
  const buttonLabel = valueStreamProjection.isProjected
    ? "Refresh value stream view"
    : "Load value stream view";

  return (
    <section className="mb-6 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-white">Value Stream Projection</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          Materialize the normalized reference-model value streams into the EA canvas.
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-xs text-[var(--dpf-muted)]">
          {valueStreamProjection.isProjected ? (
            <p>
              Current view: <span className="text-white">{valueStreamProjection.viewName ?? "Unnamed projection"}</span>
            </p>
          ) : (
            <p>No value stream projection has been created yet.</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <form action={loadValueStreamProjection}>
            <input type="hidden" name="referenceModelSlug" value={referenceModelSlug} />
            <button
              type="submit"
              className="rounded-md border border-[var(--dpf-accent)] bg-[var(--dpf-accent)] px-3 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90"
            >
              {buttonLabel}
            </button>
          </form>
          {valueStreamProjection.viewId ? (
            <Link
              href={`/ea/views/${valueStreamProjection.viewId}`}
              className="text-xs font-medium text-[var(--dpf-accent)] hover:text-white"
            >
              Open current view
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
