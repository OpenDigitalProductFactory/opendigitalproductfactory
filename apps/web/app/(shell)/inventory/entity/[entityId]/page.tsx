// Device detail page — drill-down target when the operator clicks an
// EstateItemCard or follows the "needs attention" counter on a product's
// Operate tab. Until this page existed, the cards were dead-ends:
// "Identity needs review" / "Support review needed" appeared everywhere
// with no path to actually resolve them.

import { prisma, resolveCanonicalInventoryEntityId } from "@dpf/db";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { ConfirmSupportButtons, SetVersionForm } from "./inline-actions";

type Props = {
  params: Promise<{ entityId: string }>;
};

export default async function InventoryEntityDetailPage({ params }: Props) {
  const { entityId } = await params;
  const canonicalEntityId = await resolveCanonicalInventoryEntityId(prisma, entityId);
  if (!canonicalEntityId) notFound();
  if (canonicalEntityId !== entityId) {
    redirect(`/inventory/entity/${canonicalEntityId}`);
  }

  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: canonicalEntityId },
    select: {
      id: true,
      entityKey: true,
      name: true,
      entityType: true,
      technicalClass: true,
      manufacturer: true,
      productModel: true,
      observedVersion: true,
      normalizedVersion: true,
      iconKey: true,
      supportStatus: true,
      status: true,
      providerView: true,
      // Enrichment linkage to the canonical identity spine (EP-ASSET-INTELLIGENCE / BI-9C0424E4).
      updatePosture: true,
      latestKnownVersion: true,
      identityStatus: true,
      identityConfidence: true,
      catalogIdentity: {
        select: {
          manufacturer: true,
          product: true,
          productVersion: true,
          cpe: true,
          lifecycleMilestones: {
            select: { milestone: true, date: true, source: true },
            orderBy: { date: "asc" },
          },
        },
      },
      attributionStatus: true,
      attributionConfidence: true,
      confidence: true,
      properties: true,
      firstSeenAt: true,
      lastSeenAt: true,
      digitalProduct: { select: { id: true, name: true } },
      taxonomyNode: { select: { name: true, nodeId: true } },
      qualityIssues: {
        where: { status: "open" },
        orderBy: [{ severity: "desc" }, { lastDetectedAt: "desc" }],
        select: { id: true, issueType: true, severity: true, summary: true, lastDetectedAt: true },
      },
      fromRelationships: {
        take: 10,
        select: {
          id: true,
          relationshipType: true,
          status: true,
          toEntity: { select: { id: true, name: true, entityType: true } },
        },
      },
      toRelationships: {
        take: 10,
        select: {
          id: true,
          relationshipType: true,
          status: true,
          fromEntity: { select: { id: true, name: true, entityType: true } },
        },
      },
    },
  });

  if (!entity) notFound();

  const properties =
    entity.properties && typeof entity.properties === "object"
      ? (entity.properties as Record<string, unknown>)
      : {};

  return (
    <div className="space-y-6 p-6">
      <nav className="text-xs text-[var(--dpf-muted)]">
        <Link href="/inventory" className="hover:text-[var(--dpf-accent)]">
          Estate Discovery
        </Link>
        <span className="mx-2">/</span>
        <span>{entity.name}</span>
      </nav>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{entity.name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--dpf-muted)]">
          <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 uppercase tracking-[0.18em]">
            {entity.entityType}
          </span>
          {entity.manufacturer && (
            <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5">
              {entity.manufacturer}
            </span>
          )}
          <span>Status: {entity.status}</span>
          <span>Confidence: {entity.confidence ? `${Math.round(entity.confidence * 100)}%` : "—"}</span>
        </div>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Panel title="Identity">
          <Field label="Name" value={entity.name} />
          <Field label="Manufacturer" value={entity.manufacturer ?? "—"} />
          <Field label="Model" value={entity.productModel ?? "—"} />
          <Field
            label="MAC"
            value={typeof properties.mac === "string" ? properties.mac : "—"}
            mono
          />
          <Field
            label="Address"
            value={typeof properties.address === "string" ? properties.address : "—"}
            mono
          />
        </Panel>

        <Panel title="Version & support">
          <Field label="Observed version" value={entity.observedVersion ?? "—"} />
          <Field label="Normalized version" value={entity.normalizedVersion ?? "—"} />
          <Field label="Latest known version" value={entity.latestKnownVersion ?? "—"} />
          <Field label="Support status" value={entity.supportStatus} />
          <Field label="Update posture" value={entity.updatePosture} />
          <Field label="Provider view" value={entity.providerView} />
        </Panel>

        <Panel title="Canonical identity & lifecycle">
          {entity.catalogIdentity ? (
            <>
              <Field
                label="Identity"
                value={`${entity.catalogIdentity.manufacturer} ${entity.catalogIdentity.product}${
                  entity.catalogIdentity.productVersion ? ` ${entity.catalogIdentity.productVersion}` : ""
                }`}
              />
              <Field label="CPE" value={entity.catalogIdentity.cpe ?? "—"} mono />
              <Field label="Resolution" value={entity.identityStatus ?? "unresolved"} />
              {entity.catalogIdentity.lifecycleMilestones.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {entity.catalogIdentity.lifecycleMilestones.map((m) => (
                    <div key={`${m.milestone}:${m.source}`} className="flex justify-between text-xs">
                      <span className="text-[var(--dpf-muted)]">{m.milestone.replace(/_/g, " ")}</span>
                      <span className="text-[var(--dpf-text)]">
                        {m.date ? new Date(m.date).toISOString().slice(0, 10) : "—"}{" "}
                        <span className="text-[var(--dpf-muted)]">({m.source})</span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-[var(--dpf-muted)]">No support-lifecycle milestones yet.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-[var(--dpf-muted)]">Not yet resolved to a canonical identity.</p>
          )}
        </Panel>
      </section>

      <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
        <h2 className="text-sm font-semibold text-[var(--dpf-text)]">Operator actions</h2>
        <p className="mt-1 text-xs text-[var(--dpf-muted)]">
          Override discovery evidence with operator-confirmed facts. Changes are written directly to the inventory record and survive subsequent discovery sweeps.
        </p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Confirm support status
            </p>
            <ConfirmSupportButtons entityId={entity.id} current={entity.supportStatus} />
          </div>
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">
              Set version
            </p>
            <SetVersionForm entityId={entity.id} current={entity.observedVersion ?? ""} />
          </div>
        </div>
      </section>

      {entity.qualityIssues.length > 0 && (
        <Panel title={`Open quality issues (${entity.qualityIssues.length})`}>
          <ul className="space-y-2 text-sm">
            {entity.qualityIssues.map((issue) => (
              <li key={issue.id} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-mono text-xs text-[var(--dpf-muted)]">{issue.issueType}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                    issue.severity === "error" ? "border-red-500/40 text-red-400" : "border-amber-500/40 text-amber-400"
                  }`}>
                    {issue.severity}
                  </span>
                </div>
                {issue.summary && <p className="mt-1 text-[var(--dpf-text)]">{issue.summary}</p>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <Panel title={`Upstream (${entity.fromRelationships.length})`}>
          {entity.fromRelationships.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No upstream relationships.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {entity.fromRelationships.map((rel) => (
                <li key={rel.id}>
                  <Link
                    href={`/inventory/entity/${rel.toEntity.id}`}
                    className="text-[var(--dpf-accent)] hover:underline"
                  >
                    {rel.toEntity.name}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-[var(--dpf-muted)]">
                    {rel.relationshipType} · {rel.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={`Downstream (${entity.toRelationships.length})`}>
          {entity.toRelationships.length === 0 ? (
            <p className="text-sm text-[var(--dpf-muted)]">No downstream relationships.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {entity.toRelationships.map((rel) => (
                <li key={rel.id}>
                  <Link
                    href={`/inventory/entity/${rel.fromEntity.id}`}
                    className="text-[var(--dpf-accent)] hover:underline"
                  >
                    {rel.fromEntity.name}
                  </Link>
                  <span className="ml-2 font-mono text-[11px] text-[var(--dpf-muted)]">
                    {rel.relationshipType} · {rel.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      <Panel title="Properties">
        <pre className="overflow-x-auto rounded-md bg-[var(--dpf-surface-2)] p-3 text-[11px] font-mono text-[var(--dpf-text)]">
          {JSON.stringify(properties, null, 2)}
        </pre>
      </Panel>

      {entity.digitalProduct && (
        <p className="text-xs text-[var(--dpf-muted)]">
          Attributed to product:{" "}
          <Link
            href={`/portfolio/product/${entity.digitalProduct.id}/inventory`}
            className="text-[var(--dpf-accent)] hover:underline"
          >
            {entity.digitalProduct.name}
          </Link>
        </p>
      )}

      <p className="text-[11px] font-mono text-[var(--dpf-muted)]">{entity.entityKey}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
      <h2 className="mb-3 text-sm font-semibold text-[var(--dpf-text)]">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--dpf-muted)]">{label}</span>
      <span className={mono ? "font-mono text-[var(--dpf-text)]" : "text-[var(--dpf-text)]"}>{value}</span>
    </div>
  );
}
