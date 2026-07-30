// apps/web/components/portfolio/DigitalProductDetail.tsx
//
// Renders the digital product detail view (Task 3.4 of the discovery ->
// portfolio gap closure plan). Pure presentation -- consumes a typed
// `DigitalProductView` produced by `toDigitalProductViewModel` so this
// component never sees raw Prisma rows or JSON columns.
//
// Layout: full-width sections separated by top borders (matches the
// PortfolioNodeDetail pattern from Task 3.3). No nested cards, no empty
// bands -- sections that have nothing to show return null.

import type { ReactElement } from "react";
import type { DigitalProductView } from "@/lib/portfolio/digital-product-view-model";
import { LocalTime } from "@/components/ui/LocalTime";
import { FreshnessBadge } from "./FreshnessBadge";

type Props = { vm: DigitalProductView };

export function DigitalProductDetail({ vm }: Props): ReactElement {
  return (
    <div>
      <Header vm={vm} />
      <DescriptionSection description={vm.description} />
      <CoworkerSection vm={vm} />
      <IdentitySection vm={vm} />
      <TaxonomySection lineage={vm.taxonomyLineage} />
      <LinkedEntitiesSection vm={vm} />
      <QualityIssuesSection issues={vm.openQualityIssues} />
    </div>
  );
}

// --- Header ------------------------------------------------------------

function Header({ vm }: { vm: DigitalProductView }): ReactElement {
  return (
    <div className="mb-2">
      <div className="flex flex-wrap items-baseline gap-3 mb-2">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">{vm.name}</h1>
        <span className="text-sm text-[var(--dpf-accent)]">v{vm.version}</span>
        <span className="text-xs font-mono text-[var(--dpf-muted)]">{vm.productId}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LifecycleBadge label="Stage" value={vm.lifecycleStage} />
        <LifecycleBadge label="Status" value={vm.lifecycleStatus} />
        <FreshnessBadge freshness={vm.freshness} />
      </div>
    </div>
  );
}

function LifecycleBadge({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-[var(--dpf-surface-2)]">
      <span className="text-[10px] uppercase tracking-wide text-[var(--dpf-muted)]">{label}</span>
      <span className="text-[var(--dpf-text)]">{value}</span>
    </span>
  );
}

// --- Description -------------------------------------------------------

function DescriptionSection({ description }: { description: string | null }): ReactElement | null {
  if (description === null) return null;
  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">Description</h2>
      <p className="text-sm text-[var(--dpf-text)]">{description}</p>
    </section>
  );
}

// --- AI coworker (role-shaped Workforce product; BI-8F9EDD6C) ----------

function CoworkerSection({ vm }: { vm: DigitalProductView }): ReactElement | null {
  const coworker = vm.coworker;
  if (coworker === null) return null;
  // DOC-7693D528: a coworker product preserves the coworker's identity, its
  // human-role parity anchor, and its approval/interface owner.
  const fields = [
    { label: "Coworker", value: coworker.agentId },
    { label: "Employee-role parity", value: coworker.humanRoleParity },
    { label: "Approval / interface owner", value: coworker.approvalInterfaceOwner ?? "broad (unassigned)" },
  ];
  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">AI Coworker</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col">
            <dt className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">
              {f.label}
            </dt>
            <dd className="text-[var(--dpf-text)]">{f.value ?? "—"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Identity (from primary entity) ------------------------------------

function IdentitySection({ vm }: { vm: DigitalProductView }): ReactElement | null {
  const entity = vm.primaryEntity;
  if (entity === null) return null;
  // Only render if at least one identity field is populated.
  const fields = [
    { label: "Manufacturer", value: entity.manufacturer },
    { label: "Product Model", value: entity.productModel },
    { label: "Technical Class", value: entity.technicalClass },
    { label: "Icon", value: entity.iconKey },
  ].filter((f) => f.value !== null && f.value !== "");
  if (fields.length === 0) return null;

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">Identity</h2>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
        {fields.map((f) => (
          <div key={f.label} className="flex flex-col">
            <dt className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">
              {f.label}
            </dt>
            <dd className="text-[var(--dpf-text)]">{f.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Taxonomy lineage --------------------------------------------------

function TaxonomySection({
  lineage,
}: {
  lineage: Array<{ nodeId: string; name: string }>;
}): ReactElement | null {
  if (lineage.length === 0) return null;
  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">Taxonomy</h2>
      <nav
        aria-label="Taxonomy lineage"
        className="flex flex-wrap items-center gap-1 text-xs text-[var(--dpf-muted)]"
      >
        {lineage.map((node, i) => (
          <span key={node.nodeId} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            <span className="text-[var(--dpf-text)]">{node.name}</span>
          </span>
        ))}
      </nav>
    </section>
  );
}

// --- Linked inventory entities -----------------------------------------

function LinkedEntitiesSection({ vm }: { vm: DigitalProductView }): ReactElement | null {
  if (vm.linkedEntities.length === 0) return null;

  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">
        Linked Inventory Entities
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left text-[10px] text-[var(--dpf-muted)] uppercase tracking-widest">
              <th className="py-1 pr-3">Name</th>
              <th className="py-1 pr-3">Key</th>
              <th className="py-1 pr-3">Type</th>
              <th className="py-1 pr-3">Observed Version</th>
              <th className="py-1 pr-3">Confidence</th>
              <th className="py-1 pr-3">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {vm.linkedEntities.map((entity) => (
              <tr key={entity.id} className="border-t border-[var(--dpf-border)]">
                <td className="py-2 pr-3 text-[var(--dpf-text)]">{entity.name}</td>
                <td className="py-2 pr-3 font-mono text-xs text-[var(--dpf-muted)]">
                  {entity.entityKey}
                </td>
                <td className="py-2 pr-3 text-[var(--dpf-text)]">{entity.entityType}</td>
                <td className="py-2 pr-3 text-[var(--dpf-text)]">
                  {entity.observedVersion ?? "—"}
                </td>
                <td className="py-2 pr-3 text-[var(--dpf-text)]">
                  {entity.attributionConfidence === null
                    ? "—"
                    : entity.attributionConfidence.toFixed(2)}
                </td>
                <td className="py-2 pr-3 text-[var(--dpf-muted)] text-xs">
                  <LocalTime value={entity.lastSeenAt} mode="date" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// TODO(Chunk 4 Task 4.3): render an Enrichment section reading
// vm.enrichmentStatus + vm.lastEnrichedAt once the schema columns land.
//
// TODO(Chunk 4+): render recent ChangeItem rows once a query helper exists;
// the spec calls for "recent change items" but ChangeItem rollups for a
// product are out of scope for Chunk 3.

// --- Open quality issues -----------------------------------------------

function QualityIssuesSection({
  issues,
}: {
  issues: DigitalProductView["openQualityIssues"];
}): ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <section className="mt-6 pt-6 border-t border-[var(--dpf-border)]">
      <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-2">
        Open Quality Issues
      </h2>
      <ul className="flex flex-col gap-2">
        {issues.map((issue) => (
          <li
            key={issue.id}
            className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3 text-sm"
          >
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="uppercase tracking-wide text-[var(--dpf-muted)]">
                {issue.severity}
              </span>
              <span className="font-mono text-[var(--dpf-muted)]">{issue.issueType}</span>
            </span>
            <span className="text-[var(--dpf-text)]">{issue.summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
