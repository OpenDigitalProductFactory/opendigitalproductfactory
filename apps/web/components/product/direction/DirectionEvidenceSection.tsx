import { LocalTime } from "@/components/ui/LocalTime";
import {
  CollapsibleList,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/ui/report-kit";
import type { ProductDirectionSection } from "@/lib/product-management/product-direction-view";

export function DirectionEvidenceSection({
  section,
  previewCount,
  emptyTitle,
  emptyDescription,
}: {
  section: ProductDirectionSection;
  previewCount: number;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <section
      aria-labelledby={`direction-${section.kind}`}
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
    >
      <div className="mb-dpf-md">
        <h2
          id={`direction-${section.kind}`}
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          {section.title}
        </h2>
        <p className="mt-dpf-2xs text-dpf-body text-[var(--dpf-muted)]">
          {section.description}
        </p>
      </div>

      {section.availability === "unavailable" ? (
        <Notice variant="warn" title="Evidence is not available yet">
          {section.reason ?? "This source has not been connected for this product."}
        </Notice>
      ) : section.items.length === 0 ? (
        <EmptyState
          size="sm"
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <>
          {section.availability === "partial" ? (
            <Notice variant="info" title="Partial evidence" className="mb-dpf-md">
              {section.reason ?? "Some source records are not available."}
            </Notice>
          ) : null}
          {section.freshness === "stale" ? (
            <Notice variant="warn" title="Evidence may be stale" className="mb-dpf-md">
              Review the source before making a material decision.
            </Notice>
          ) : null}
          <CollapsibleList
            previewCount={previewCount}
          >
            {section.items.map((item) => (
              <li
                key={`${item.sourceKind}:${item.id}`}
                className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-dpf-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
                  <div className="min-w-0">
                    <p className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                      {item.label}
                    </p>
                    {item.detail ? (
                      <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                        {item.detail}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge
                    intent="neutral"
                    label={item.status}
                    uppercase={false}
                  />
                </div>
                <details
                  data-dpf-disclosure
                  className="mt-dpf-sm text-dpf-caption text-[var(--dpf-muted)]"
                >
                  <summary className="cursor-pointer text-[var(--dpf-accent)]">
                    Evidence source
                  </summary>
                  <p className="mt-dpf-2xs">
                    {item.sourceKind} · <LocalTime value={item.asOf} mode="datetime" />
                  </p>
                </details>
              </li>
            ))}
          </CollapsibleList>
        </>
      )}
    </section>
  );
}
