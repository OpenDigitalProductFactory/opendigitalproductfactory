"use client";

import { BrainCircuit, Download, Fingerprint, PackageCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type {
  ProductCompositionBomRows,
  ProductCompositionComponentRow,
} from "@/lib/assurance/bom-read";
import type { ActiveAssuranceFindingRow } from "@/lib/assurance/finding-read";
import { AssuranceFindingsList } from "@/components/build/AssuranceFindingsList";
import { ButtonLink } from "@/components/ui/Button";
import { LocalTime } from "@/components/ui/LocalTime";
import { DataTable, StatusBadge, type Column, type Intent } from "@/components/ui/report-kit";
import { Surface } from "@/components/ui/Surface";
import { deriveCurrency, deriveSupportEndDate, type Currency } from "@/lib/lifecycle";

export type ProductCompositionComponent = ProductCompositionComponentRow;
export type ProductCompositionLatestBom = NonNullable<ProductCompositionBomRows["latestBom"]>;

function shortDigest(value: string): string {
  return value.length > 16 ? value.slice(0, 16) : value;
}

const currencyLabels: Record<Currency, string> = {
  current: "Current",
  "approaching-eol": "Approaching EOL",
  unsupported: "Unsupported",
  "end-of-life": "End of life",
};

function formatSupportDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function componentLifecycle(component: ProductCompositionComponent): {
  currency: Currency | null;
  supportEndsAt: Date | null;
  intent: Intent;
} {
  const supportEndsAt = deriveSupportEndDate(component.lifecycleMilestones);
  const currency = deriveCurrency({ supportEndsAt });
  const intent = currency === "current"
    ? "success"
    : currency === "approaching-eol"
      ? "warning"
      : currency
        ? "danger"
        : "neutral";
  return { currency, supportEndsAt, intent };
}

export function ProductSoftwareCompositionPanel({
  productId,
  latestBom,
  components,
  findingSummary,
  scanner,
  findings = [],
  platformProduct = false,
}: {
  productId: string;
  latestBom: ProductCompositionLatestBom | null;
  components: ProductCompositionComponent[];
  findingSummary: ProductCompositionBomRows["findingSummary"];
  scanner: ProductCompositionBomRows["scanner"];
  findings?: ActiveAssuranceFindingRow[];
  platformProduct?: boolean;
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
  const columns: Column<ProductCompositionComponent>[] = [
    {
      key: "component",
      header: "Component",
      cell: (component) => <span className="font-medium text-[var(--dpf-text)]">{component.name}</span>,
      sortAccessor: (component) => component.name,
    },
    {
      key: "version",
      header: "Version",
      cell: (component) => component.version ?? "unknown",
      sortAccessor: (component) => component.version ?? "",
    },
    { key: "type", header: "Type", cell: (component) => component.componentType },
    { key: "ecosystem", header: "Ecosystem", cell: (component) => component.ecosystem ?? "unknown" },
    {
      key: "currency",
      header: "Currency",
      cell: (component) => {
        const { currency, intent } = componentLifecycle(component);
        return (
          <StatusBadge
            intent={intent}
            label={currency ? currencyLabels[currency] : "Not sourced"}
            uppercase={false}
            variant="soft"
          />
        );
      },
      sortAccessor: (component) => componentLifecycle(component).currency ?? "not-sourced",
    },
    {
      key: "support-ends",
      header: "Support ends",
      cell: (component) => {
        const supportEndsAt = componentLifecycle(component).supportEndsAt;
        return supportEndsAt ? formatSupportDate(supportEndsAt) : "Not sourced";
      },
      sortAccessor: (component) => componentLifecycle(component).supportEndsAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
    },
    {
      key: "package-url",
      header: "Package URL",
      cell: (component) => (
        <span className="block max-w-xs break-all font-mono text-dpf-caption">
          {component.packageUrl ?? "not applicable"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id="software-composition" className="scroll-mt-6 text-xl font-semibold text-[var(--dpf-text)]">Software composition</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[var(--dpf-muted)]">
            The product SBOM, canonical lifecycle currency, active findings, and shareable evidence.
          </p>
        </div>
        {latestBom ? (
          <ButtonLink
            size="sm"
            href={`/api/portfolio/product/${productId}/supply-chain/bom`}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export full SBOM
          </ButtonLink>
        ) : null}
      </div>

      {!latestBom ? (
        <Surface as="section" rounded="md">
          <div className="flex items-start gap-3">
            <PackageCheck className="mt-0.5 h-5 w-5 text-[var(--dpf-muted)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-[var(--dpf-text)]">No BOM has been generated for this product yet.</p>
              <p className="mt-1 text-xs leading-5 text-[var(--dpf-muted)]">
                {platformProduct
                  ? "Platform SBOM seed ingestion has not completed. Run the governed seed to load the repository CycloneDX document."
                  : "Generate a Build Studio BOM for a build linked to this product to populate the ledger."}
              </p>
              <p className="mt-3 text-xs font-medium text-[var(--dpf-warning)]">
                {scannerDetail}
              </p>
            </div>
          </div>
        </Surface>
      ) : (
        <>
          <section className="grid gap-3 md:grid-cols-4" aria-label="Software composition summary">
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

          <Surface padding="none" rounded="md" className="overflow-x-auto">
            <DataTable
              ariaLabel="Software composition components"
              columns={columns}
              getRowKey={(component) => `${component.name}:${component.version ?? ""}:${component.componentType}`}
              initialSort={{ key: "component", dir: "asc" }}
              pageSize={25}
              rows={components}
            />
          </Surface>
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
    <Surface rounded="md">
      <div className="flex items-center gap-2 text-xs font-medium text-[var(--dpf-muted)]">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-base font-semibold text-[var(--dpf-text)]">{value}</p>
      <p className="mt-1 truncate text-xs text-[var(--dpf-muted)]" title={typeof detail === "string" ? detail : undefined}>{detail}</p>
    </Surface>
  );
}
