import {
  prisma,
  buildPublicDeviceCatalog,
  type PublicCatalogRuleInput,
  type FingerprintMatchExpression,
  type ResolvedIdentity,
} from "@dpf/db";

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
        <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--dpf-border)" }}>
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
              {catalog.entries.map((e) => (
                <tr key={e.ruleKey} className="border-t align-top" style={{ borderColor: "var(--dpf-border)" }}>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">{e.identity.name}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">{e.identity.vendor ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">{e.identity.deviceClass ?? "—"}</td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)]">
                    {e.signals.map((s) => `${s.signal} "${s.match}"`).join(", ")}
                  </td>
                  <td className="px-3 py-2 text-[var(--dpf-text)]">
                    {e.placement.path.length > 0 ? e.placement.path.join(" › ") : "—"}
                  </td>
                  <td className="px-3 py-2 text-[var(--dpf-muted)] whitespace-nowrap">
                    {Math.round(Math.min(e.identityConfidence, e.taxonomyConfidence) * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
