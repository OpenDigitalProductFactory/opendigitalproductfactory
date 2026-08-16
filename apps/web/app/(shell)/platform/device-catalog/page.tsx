import {
  prisma,
  buildPublicDeviceCatalog,
  type PublicCatalogRuleInput,
  type PublicCatalogEntry,
  type FingerprintMatchExpression,
  type ResolvedIdentity,
} from "@dpf/db";

const INITIAL_CATALOG_ENTRY_LIMIT = 8;

export const metadata = {
  title: "Device Catalog",
};

type RuleRow = {
  ruleKey: string;
  status: string;
  scope: string;
  matchExpression: unknown;
  requiredEvidenceFamilies: string[];
  resolvedIdentity: unknown;
  identityConfidence: number;
  taxonomyConfidence: number;
  taxonomyNode: { nodeId: string } | null;
};

function CatalogTable({ entries }: { entries: PublicCatalogEntry[] }) {
  return (
    <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid var(--dpf-border)" }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ background: "var(--dpf-surface-1)" }} className="text-left text-xs text-[var(--dpf-muted)]">
            <th className="px-3 py-2 font-medium">Device</th>
            <th className="px-3 py-2 font-medium">Vendor</th>
            <th className="px-3 py-2 font-medium">Class</th>
            <th className="px-3 py-2 font-medium">Fingerprint</th>
            <th className="px-3 py-2 font-medium">Portfolio placement</th>
            <th className="px-3 py-2 font-medium">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.ruleKey} className="border-t align-top" style={{ borderColor: "var(--dpf-border)" }}>
              <td className="px-3 py-2 text-[var(--dpf-text)]">{entry.identity.name}</td>
              <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">{entry.identity.vendor ?? "—"}</td>
              <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">
                {entry.identity.deviceClass ?? "—"}
              </td>
              <td className="px-3 py-2 text-[var(--dpf-muted)]">
                {entry.signals.map((signal) => `${signal.signal} "${signal.match}"`).join(", ")}
              </td>
              <td className="px-3 py-2 text-[var(--dpf-text)]">
                {entry.placement.path.length > 0 ? entry.placement.path.join(" › ") : "—"}
              </td>
              <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">
                {Math.round(Math.min(entry.identityConfidence, entry.taxonomyConfidence) * 100)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function DeviceCatalogPage() {
  const rules = (await prisma.discoveryFingerprintRule.findMany({
    where: { status: "active", scope: "global" },
    select: {
      ruleKey: true,
      status: true,
      scope: true,
      matchExpression: true,
      requiredEvidenceFamilies: true,
      resolvedIdentity: true,
      identityConfidence: true,
      taxonomyConfidence: true,
      taxonomyNode: { select: { nodeId: true } },
    },
  })) as RuleRow[];

  const input: PublicCatalogRuleInput[] = rules.map((r) => ({
    ruleKey: r.ruleKey,
    status: r.status,
    scope: r.scope,
    matchExpression: r.matchExpression as FingerprintMatchExpression,
    requiredEvidenceFamilies: r.requiredEvidenceFamilies,
    resolvedIdentity: (r.resolvedIdentity ?? {}) as ResolvedIdentity,
    taxonomyNodeId: r.taxonomyNode?.nodeId ?? null,
    identityConfidence: r.identityConfidence,
    taxonomyConfidence: r.taxonomyConfidence,
  }));

  const catalog = buildPublicDeviceCatalog(input);
  const initialEntries = catalog.entries.slice(0, INITIAL_CATALOG_ENTRY_LIMIT);
  const remainingEntries = catalog.entries.slice(INITIAL_CATALOG_ENTRY_LIMIT);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Device Catalog</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-1 max-w-2xl">
          The open, <strong>portfolio-aware</strong> device-identification database. Fingerbank tells you <em>what</em> a
          device is; DPF tells you what <strong>and</strong> where it belongs in your digital-product estate. PII-free,
          versioned, and served read-only at{" "}
          <code className="text-xs">/api/v1/device-catalog</code>.
        </p>
        <div className="flex gap-4 mt-3 text-xs text-[var(--dpf-muted)]">
          <span>schema v{catalog.schemaVersion}</span>
          <span>catalog v{catalog.version}</span>
          <span>{catalog.count} identified device classes</span>
        </div>
      </div>

      {catalog.entries.length === 0 ? (
        <div
          className="p-6 text-sm text-[var(--dpf-muted)] rounded-lg text-center"
          style={{ background: "var(--dpf-surface-1)", border: "1px dashed var(--dpf-border)" }}
        >
          No published device fingerprints yet. As the seed catalog and hive-curated rules activate, they appear here.
        </div>
      ) : (
        <div className="space-y-3">
          <CatalogTable entries={initialEntries} />
          {remainingEntries.length > 0 && (
            <details
              data-dpf-disclosure
              className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]"
            >
              <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium text-[var(--dpf-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-focus)]">
                Show {remainingEntries.length} more catalog entries
              </summary>
              <div className="border-t border-[var(--dpf-border)] p-3">
                <CatalogTable entries={remainingEntries} />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
