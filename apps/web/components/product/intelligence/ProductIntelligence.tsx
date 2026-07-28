import type { ReactNode } from "react";
import Link from "next/link";
import { LocalTime } from "@/components/ui/LocalTime";
import {
  CollapsibleList,
  EmptyState,
  Notice,
  StatusBadge,
} from "@/components/ui/report-kit";
import { ResearchProposalActions } from "@/components/attention/ResearchProposalActions";
import type { ProductOperatingContext } from "@/lib/product-management/product-operating-context";
import type {
  ProductIntelligenceView,
  ProductIntelligenceViewItem,
} from "@/lib/product-management/product-intelligence-view";
import { ProductIntelligenceControls } from "./ProductIntelligenceControls";
import { ProductIntelligenceWatchActions } from "./ProductIntelligenceWatchActions";

function evidenceItem(item: ProductIntelligenceViewItem, allowDecision = false) {
  return (
    <li
      key={`${item.sourceKind}:${item.id}`}
      className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-dpf-md"
    >
      <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
        <div className="min-w-0">
          <p className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
            {item.title}
          </p>
          {item.detail ? (
            <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
              {item.detail}
            </p>
          ) : null}
          <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
            {item.scopeLabel} · <LocalTime value={item.asOf} mode="datetime" />
          </p>
        </div>
        <div className="flex flex-wrap gap-dpf-2xs">
          <StatusBadge intent="neutral" label={item.status} uppercase={false} />
          {item.confidence ? (
            <StatusBadge
              intent={item.confidence === "low" ? "warning" : "info"}
              label={`${item.confidence} confidence`}
              uppercase={false}
            />
          ) : null}
        </div>
      </div>
      {item.sourceUrls && item.sourceUrls.length > 0 ? (
        <details data-dpf-disclosure className="mt-dpf-sm text-dpf-caption">
          <summary className="cursor-pointer text-[var(--dpf-accent)]">
            Sources and retrieval
          </summary>
          <ul className="mt-dpf-xs list-disc space-y-dpf-2xs pl-dpf-lg">
            {item.sourceUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[var(--dpf-accent)] underline"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
          {item.retrievedAt ? (
            <p className="mt-dpf-xs text-[var(--dpf-muted)]">
              Retrieved <LocalTime value={item.retrievedAt} mode="datetime" />
              {item.comparisonKind === "changed-since"
                ? " · compared with the last reviewed baseline"
                : " · first reviewed baseline"}
            </p>
          ) : null}
        </details>
      ) : null}
      {allowDecision ? (
        <div className="mt-dpf-md">
          <ResearchProposalActions proposalId={item.id} />
        </div>
      ) : null}
    </li>
  );
}

function evidenceSection({
  id,
  title,
  description,
  items,
  previewCount,
  empty,
  allowDecision = false,
  action,
}: {
  id: string;
  title: string;
  description: string;
  items: ProductIntelligenceViewItem[];
  previewCount: number;
  empty: string;
  allowDecision?: boolean;
  action?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
    >
      <h2
        id={id}
        className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
      >
        {title}
      </h2>
      <p className="mt-dpf-2xs text-dpf-body text-[var(--dpf-muted)]">
        {description}
      </p>
      {items.length === 0 ? (
        <EmptyState
          size="sm"
          className="mt-dpf-md"
          title={empty}
          bordered={false}
        />
      ) : (
        <CollapsibleList previewCount={previewCount} className="mt-dpf-md">
          {items.map((item) => evidenceItem(item, allowDecision))}
        </CollapsibleList>
      )}
      {action ? <div className="mt-dpf-md">{action}</div> : null}
    </section>
  );
}

export function ProductIntelligence({
  context,
  view,
}: {
  context: ProductOperatingContext;
  view: ProductIntelligenceView;
}) {
  return (
    <div className="space-y-dpf-lg">
      <div className="flex flex-col gap-dpf-md sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="max-w-prose text-dpf-body-lg text-[var(--dpf-muted)]">
            Track what changed for {view.product.name}, retain source provenance,
            and keep research behind explicit review boundaries.
          </p>
          <p className="mt-dpf-xs text-dpf-caption text-[var(--dpf-muted)]">
            Provider: {context.provider.name}. Product and product-line evidence
            remain separate from enabling digital-product architecture.
          </p>
        </div>
        <ProductIntelligenceControls
          productId={view.product.id}
          productName={view.product.name}
        />
      </div>

      {view.firstRun ? (
        <Notice variant="info" title="Start with one focused question">
          {view.emptyState}
        </Notice>
      ) : null}
      {view.stale.length > 0 ? (
        <Notice variant="warn" title="Some evidence may be stale">
          {view.stale.length} item{view.stale.length === 1 ? "" : "s"} are older
          than 30 days. Review their sources before relying on them.
        </Notice>
      ) : null}

      {evidenceSection({
        id: "product-intelligence-pending",
        title: "Awaiting your decision",
        description:
          "Nothing has been researched yet. Approving one proposal starts the cited research run.",
        items: view.pending,
        previewCount: view.evidencePreviewCount,
        empty: "No research proposals are awaiting review.",
        allowDecision: true,
      })}
      {evidenceSection({
        id: "product-intelligence-reviewed",
        title: "Reviewed knowledge",
        description:
          "Published knowledge is the reviewed baseline for later change detection.",
        items: view.reviewed,
        previewCount: view.evidencePreviewCount,
        empty: "No reviewed product knowledge is linked yet.",
      })}
      {evidenceSection({
        id: "product-intelligence-drafts",
        title: "Research drafts",
        description:
          "Completed research remains draft evidence until it is reviewed and published in Knowledge.",
        items: view.drafts,
        previewCount: view.evidencePreviewCount,
        empty: "No completed research drafts are waiting for knowledge review.",
        action:
          view.drafts.length > 0 ? (
            <Link
              href="/coworker-decisions?status=all"
              className="text-dpf-body font-dpf-medium text-[var(--dpf-accent)] hover:underline"
            >
              Review corpus drafts →
            </Link>
          ) : null,
      })}
      {view.failed.length > 0
        ? evidenceSection({
            id: "product-intelligence-failed",
            title: "Runs needing attention",
            description:
              "These approved runs did not produce a draft. Review the failure before retrying the proposal.",
            items: view.failed,
            previewCount: view.evidencePreviewCount,
            empty: "No failed research runs.",
          })
        : null}
      {view.noFindings.length > 0
        ? evidenceSection({
            id: "product-intelligence-no-findings",
            title: "Runs with no new draft",
            description:
              "These runs retained an honest empty or unavailable-provider outcome instead of fabricating findings.",
            items: view.noFindings,
            previewCount: view.evidencePreviewCount,
            empty: "No empty research outcomes.",
          })
        : null}
      {evidenceSection({
        id: "product-intelligence-battlecards",
        title: "Competitive positioning",
        description:
          "Battlecards summarize positioning. Research citations remain in the linked evidence trail.",
        items: view.battlecards,
        previewCount: view.evidencePreviewCount,
        empty: "No competitor positioning is linked to this product.",
      })}

      <section
        aria-labelledby="product-intelligence-watches"
        className="rounded-dpf-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-dpf-lg"
      >
        <h2
          id="product-intelligence-watches"
          className="text-dpf-title font-dpf-semibold text-[var(--dpf-text)]"
        >
          Recurring scans
        </h2>
        <p className="mt-dpf-2xs text-dpf-body text-[var(--dpf-muted)]">
          A scan proposes research on its cadence. It never executes or publishes
          research without the later approval and review steps.
        </p>
        {view.watches.length === 0 ? (
          <EmptyState
            size="sm"
            className="mt-dpf-md"
            title="No recurring scans are scheduled."
            bordered={false}
          />
        ) : (
          <ul className="mt-dpf-md space-y-dpf-sm">
            {view.watches.map((watch) => (
              <li
                key={watch.taskId}
                className="rounded-dpf-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-dpf-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-dpf-sm">
                  <div>
                    <p className="text-dpf-body font-dpf-medium text-[var(--dpf-text)]">
                      {watch.title}
                    </p>
                    <p className="mt-dpf-2xs text-dpf-caption text-[var(--dpf-muted)]">
                      {watch.schedule} · next{" "}
                      <LocalTime
                        value={watch.nextRunAt}
                        mode="datetime"
                        fallback="not scheduled"
                      />
                    </p>
                  </div>
                  <StatusBadge
                    intent={watch.isActive ? "success" : "neutral"}
                    label={watch.status}
                    uppercase={false}
                  />
                </div>
                <ProductIntelligenceWatchActions
                  taskId={watch.taskId}
                  isActive={watch.isActive}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
