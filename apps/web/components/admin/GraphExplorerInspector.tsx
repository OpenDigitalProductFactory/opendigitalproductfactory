import { Spinner } from "@/components/ui/Spinner";
import type { GraphNodeDetail } from "@/lib/graph/explorer-queries";
import { describeLabel } from "@/lib/graph/explorer-vocabulary";

type Props = {
  completed: boolean;
  inspected: GraphNodeDetail | null;
  inspecting: boolean;
  seedKeys: string[];
  onExpand: () => void;
};

export function GraphExplorerInspector({
  completed,
  inspected,
  inspecting,
  seedKeys,
  onExpand,
}: Props) {
  return (
    <aside
      aria-busy={inspecting}
      className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
      data-dpf-purpose-key="node-inspector"
      data-dpf-purpose-completion-signal-key={
        completed ? "graph-neighbourhood-visible" : undefined
      }
    >
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
        Details
      </h2>
      {inspecting ? (
        <Spinner presentational />
      ) : !inspected ? (
        <p className="text-xs text-[var(--dpf-muted)]">
          {seedKeys.length === 0
            ? "Nothing picked."
            : "Click a dot to see what it is."}
        </p>
      ) : (
        <div
          className="space-y-3"
          data-dpf-purpose-message-key="graph-explorer.neighbourhood-ready"
        >
          <div>
            <p className="text-sm font-semibold text-[var(--dpf-text)] break-words">
              {inspected.name}
            </p>
            {inspected.detail && (
              <p className="text-dpf-caption text-[var(--dpf-muted)] break-words mt-0.5">
                {inspected.detail}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-1">
            {inspected.labels.map((label) => {
              const descriptor = describeLabel(label);
              return (
                <span
                  key={label}
                  className="text-dpf-caption px-1.5 py-0.5 rounded-full"
                  style={{
                    background: `${descriptor.color}20`,
                    color: descriptor.color,
                  }}
                >
                  {descriptor.label}
                </span>
              );
            })}
          </div>

          <p className="text-dpf-caption text-[var(--dpf-muted)]">
            {inspected.degree.toLocaleString()} link
            {inspected.degree === 1 ? "" : "s"} in the whole graph
          </p>

          <button
            type="button"
            onClick={onExpand}
            disabled={seedKeys.includes(inspected.key)}
            data-dpf-purpose-action-key="expand-from-here"
            className="min-h-11 w-full px-3 py-2 text-xs rounded-md bg-[var(--dpf-accent)] text-[var(--dpf-on-accent,var(--dpf-surface-1))] disabled:opacity-50"
          >
            {seedKeys.includes(inspected.key) ? "Already added" : "Expand from here"}
          </button>
        </div>
      )}

      <details
        className="mt-3 border-t border-[var(--dpf-border)] pt-3"
        data-dpf-purpose-disclosure-key="node-properties"
      >
        <summary
          className="flex min-h-11 cursor-pointer items-center text-dpf-caption text-[var(--dpf-muted)]"
          data-dpf-purpose-disclosure-trigger
        >
          Raw properties
        </summary>
        <div data-dpf-purpose-disclosure-region>
          {inspected && Object.keys(inspected.props).length > 0 ? (
            <dl className="space-y-1 pt-2">
              {Object.entries(inspected.props).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-dpf-caption uppercase tracking-wide text-[var(--dpf-muted)]">
                    {key}
                  </dt>
                  <dd className="text-dpf-caption text-[var(--dpf-text)] break-words">
                    {typeof value === "string" || typeof value === "number"
                      ? String(value)
                      : JSON.stringify(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="pt-2 text-dpf-caption text-[var(--dpf-muted)]">
              Pick a node to inspect its properties.
            </p>
          )}
        </div>
      </details>
    </aside>
  );
}
