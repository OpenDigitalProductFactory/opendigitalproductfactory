import Link from "next/link";
import { BrainCircuit, Download, Fingerprint, PackageCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ProductSupplyChainBomRows,
  ProductSupplyChainComponentRow,
} from "@/lib/assurance/bom-read";
import type { ActiveAssuranceFindingRow } from "@/lib/assurance/finding-read";
import { AssuranceFindingsList } from "@/components/build/AssuranceFindingsList";
import { LocalTime } from "@/components/ui/LocalTime";

export type ProductSupplyChainComponent = ProductSupplyChainComponentRow;
export type ProductSupplyChainLatestBom = NonNullable<ProductSupplyChainBomRows["latestBom"]>;

function shortDigest(value: string): string {
  return value.length > 16 ? value.slice(0, 16) : value;
}

export function ProductSupplyChainPanel({
  productId,
  latestBom,
  components,
  findingSummary,
  scanner,
  findings = [],
}: {
  productId: string;
  latestBom: ProductSupplyChainLatestBom | null;
  components: ProductSupplyChainComponent[];
  findingSummary: ProductSupplyChainBomRows["findingSummary"];
  scanner: ProductSupplyChainBomRows["scanner"];
  findings?: ActiveAssuranceFindingRow[];
}) {
  const modelCount = components.filter((component) => component.componentType === "model").length;
  const packageCountLabel = `${latestBom?.componentCount ?? 0} component${latestBom?.componentCount === 1 ? "" : "s"}`;
  const modelCountLabel = `${modelCount} AI model${modelCount === 1 ? "" : "s"}`;
  const findingLabel = findingSummary.blocking > 0
    ? `${findingSummary.blocking} blocking`
    : `${findingSummary.total} active`;
  const findingDetail = findingSummary.blocking > 0
    ? `${findingSummary.total} active`
    : "No blocking findings";
  const scannerLabel = scanner.state === "ready" ? "Ready" : "Needs evaluation";
  const scannerDetail = scanner.state === "ready"
    ? scanner.scannerNames.join(", ")
    : "No approved vulnerability scanner";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--dpf-text)]">Supply Chain</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            BOM components, AI model dependencies, and shareable customer evidence.
          </p>
        </div>
        {latestBom ? (
          <Link
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--dpf-accent)] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--dpf-accent)]"
            href={`/api/portfolio/product/${productId}/supply-chain/bom`}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export shareable SBOM
          </Link>
        ) : null}
      </div>

      {!latestBom ? (
        <section className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-5">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-0.5 h-5 w-5 text-[var(--dpf-muted)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-[var(--dpf-text)]">No BOM has been generated for this product yet.</p>
              <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                Generate a Build Studio BOM for a build linked to this product to populate the ledger.
              </p>
              <p className="mt-3 text-xs font-medium text-[var(--dpf-warning)]">
                {scannerDetail}
              </p>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-4" aria-label="Supply chain summary">
            <Metric
              icon={<PackageCheck className="h-4 w-4" aria-hidden="true" />}
              label="Components"
              value={packageCountLabel}
              detail={<>Generated <LocalTime value={latestBom.generatedAt} /></>}
            />
            <Metric
              icon={<BrainCircuit className="h-4 w-4" aria-hidden="true" />}
              label="Models"
              value={modelCountLabel}
              detail="First-class runtime dependencies"
            />
            <Metric
              icon={<ShieldAlert className="h-4 w-4" aria-hidden="true" />}
              label="Findings"
              value={findingLabel}
              detail={findingDetail}
            />
            <Metric
              icon={<Fingerprint className="h-4 w-4" aria-hidden="true" />}
              label="Digest"
              value={shortDigest(latestBom.digest)}
              detail={latestBom.documentId}
            />
          </section>

          <section className="flex flex-wrap items-center gap-3 border-y border-[var(--dpf-border)] py-3 text-sm">
            {scanner.state === "ready" ? (
              <ShieldCheck className="h-4 w-4 text-[var(--dpf-success)]" aria-hidden="true" />
            ) : (
              <ShieldAlert className="h-4 w-4 text-[var(--dpf-warning)]" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="font-medium text-[var(--dpf-text)]">Scanner {scannerLabel}</p>
              <p className="truncate text-xs text-[var(--dpf-muted)]" title={scannerDetail}>{scannerDetail}</p>
            </div>
          </section>

          <section aria-label="Active assurance findings" className="space-y-2">
            <p className="text-sm font-semibold text-[var(--dpf-text)]">Active findings</p>
            <AssuranceFindingsList
              findings={findings}
              readOnly
              emptyLabel="No active findings. Run a build scan to populate."
            />
          </section>

          <div className="overflow-x-auto rounded-md border border-[var(--dpf-border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] text-xs text-[var(--dpf-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Component</th>
                  <th className="px-3 py-2 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Ecosystem</th>
                  <th className="px-3 py-2 font-medium">Package URL</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-[var(--dpf-text)]">
                {components.map((component) => (
                  <tr key={`${component.name}:${component.version ?? ""}:${component.componentType}`}>
                    <td className="px-3 py-2 font-medium">{component.name}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.version ?? "unknown"}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.componentType}</td>
                    <td className="px-3 py-2 text-[var(--dpf-muted)]">{component.ecosystem ?? "unknown"}</td>
                    <td className="max-w-xs break-all px-3 py-2 text-xs text-[var(--dpf-muted)]">
                      {component.packageUrl ?? "not applicable"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--dpf-muted)]">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-base font-semibold text-[var(--dpf-text)]">{value}</p>
      <p className="mt-1 truncate text-xs text-[var(--dpf-muted)]" title={typeof detail === "string" ? detail : undefined}>{detail}</p>
    </div>
  );
}
