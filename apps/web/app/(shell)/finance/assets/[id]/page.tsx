// apps/web/app/(shell)/finance/assets/[id]/page.tsx
import { getAsset, calculateDepreciation } from "@/lib/actions/assets";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AssetDisposalForm } from "@/components/finance/AssetDisposalForm";

const CATEGORY_COLOURS: Record<string, string> = {
  equipment: "#38bdf8",
  vehicle: "#fb923c",
  furniture: "#a78bfa",
  IT: "#4ade80",
  property: "#fbbf24",
  other: "#8888a0",
};

const STATUS_COLOURS: Record<string, string> = {
  active: "#4ade80",
  disposed: "#8888a0",
  written_off: "#ef4444",
};

type Props = { params: Promise<{ id: string }> };

function DepreciationBar({ pct }: { pct: number }) {
  const colour = pct >= 80 ? "#ef4444" : pct >= 50 ? "#fbbf24" : "#4ade80";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-2 rounded-full bg-[var(--dpf-border)] overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(pct, 100)}%`, backgroundColor: colour }}
        />
      </div>
      <span className="text-sm font-semibold" style={{ color: colour }}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export default async function AssetDetailPage({ params }: Props) {
  const { id } = await params;
  const asset = await getAsset(id);

  if (!asset) notFound();

  const orgSettings = await getOrgSettings();
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const purchaseCost = Number(asset.purchaseCost);
  const currentBookValue = Number(asset.currentBookValue);
  const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
  const residualValue = Number(asset.residualValue);
  const pctDepreciated = purchaseCost > 0 ? (accumulatedDepreciation / purchaseCost) * 100 : 0;

  const categoryColour = CATEGORY_COLOURS[asset.category] ?? "#6b7280";
  const statusColour = STATUS_COLOURS[asset.status] ?? "#6b7280";

  const formatMoney = (amount: number) =>
    amount.toLocaleString("en-GB", { minimumFractionDigits: 2 });

  // Full depreciation schedule for the entire useful life
  const fullSchedule = calculateDepreciation(
    purchaseCost,
    residualValue,
    asset.usefulLifeMonths,
    asset.depreciationMethod,
  );

  const schedulePreview = fullSchedule.monthlySchedule.slice(0, 12);
  const remainingMonths = fullSchedule.monthlySchedule.length - 12;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <Link href="/finance/assets" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Assets
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">{asset.name}</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[9px] font-mono text-[var(--dpf-muted)]">{asset.assetId}</span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ color: statusColour, backgroundColor: `${statusColour}20` }}
            >
              {asset.status.replace(/_/g, " ")}
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full"
              style={{ color: categoryColour, backgroundColor: `${categoryColour}20` }}
            >
              {asset.category}
            </span>
          </div>
          <h1 className="text-xl font-bold text-[var(--dpf-text)]">{asset.name}</h1>
        </div>
        {asset.status === "active" && (
          <AssetDisposalForm assetId={asset.id} currentBookValue={currentBookValue} />
        )}
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Purchase Date</p>
          <p className="text-sm text-[var(--dpf-text)]">
            {new Date(asset.purchaseDate).toLocaleDateString("en-GB")}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Purchase Cost</p>
          <p className="text-sm text-[var(--dpf-text)]">
            {asset.currency} {formatMoney(purchaseCost)}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Method</p>
          <p className="text-sm text-[var(--dpf-text)]">
            {asset.depreciationMethod === "straight_line" ? "Straight Line" : "Reducing Balance"}
          </p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Useful Life</p>
          <p className="text-sm text-[var(--dpf-text)]">{asset.usefulLifeMonths} months</p>
        </div>
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Residual Value</p>
          <p className="text-sm text-[var(--dpf-text)]">
            {asset.currency} {formatMoney(residualValue)}
          </p>
        </div>
        {asset.serialNumber && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Serial Number</p>
            <p className="text-sm text-[var(--dpf-text)] font-mono">{asset.serialNumber}</p>
          </div>
        )}
        {asset.location && (
          <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-1">Location</p>
            <p className="text-sm text-[var(--dpf-text)]">{asset.location}</p>
          </div>
        )}
      </div>

      {/* Current status */}
      <div className="p-4 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] mb-6">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Current Status
        </p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Book Value</p>
            <p className="text-lg font-bold text-[var(--dpf-text)]">
              {sym}{formatMoney(currentBookValue)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Accumulated Depreciation</p>
            <p className="text-lg font-bold" style={{ color: "#fb923c" }}>
              {sym}{formatMoney(accumulatedDepreciation)}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Remaining Life</p>
            <p className="text-lg font-bold text-[var(--dpf-text)]">
              {Math.max(0, asset.usefulLifeMonths - Math.round((accumulatedDepreciation / (purchaseCost - residualValue || 1)) * asset.usefulLifeMonths))}m
            </p>
          </div>
        </div>
        <div>
          <p className="text-[10px] text-[var(--dpf-muted)] mb-2">% Depreciated</p>
          <DepreciationBar pct={pctDepreciated} />
        </div>
      </div>

      {/* Depreciation schedule */}
      <section>
        <h2 className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-3">
          Depreciation Schedule (first 12 months)
        </h2>
        <div className="rounded-lg border border-[var(--dpf-border)] overflow-hidden mb-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--dpf-border)]">
                <th className="text-left text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Month
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Opening Value
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Depreciation
                </th>
                <th className="text-right text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] px-4 py-2 font-normal">
                  Closing Value
                </th>
              </tr>
            </thead>
            <tbody>
              {schedulePreview.map((entry) => (
                <tr
                  key={entry.month}
                  className="border-b border-[var(--dpf-border)] last:border-0 hover:bg-[var(--dpf-surface-2)] transition-colors"
                >
                  <td className="px-4 py-2 text-[var(--dpf-muted)]">Month {entry.month}</td>
                  <td className="px-4 py-2 text-right text-[var(--dpf-text)]">
                    {sym}{formatMoney(entry.openingValue)}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: "#fb923c" }}>
                    {sym}{formatMoney(entry.depreciation)}
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--dpf-text)]">
                    {sym}{formatMoney(entry.closingValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {remainingMonths > 0 && (
          <p className="text-xs text-[var(--dpf-muted)] mb-3">
            + {remainingMonths} more month{remainingMonths !== 1 ? "s" : ""} not shown
          </p>
        )}

        {/* Summary */}
        <div className="p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Total Months</p>
              <p className="text-sm font-semibold text-[var(--dpf-text)]">{asset.usefulLifeMonths}</p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Total Depreciation</p>
              <p className="text-sm font-semibold" style={{ color: "#fb923c" }}>
                {sym}{formatMoney(fullSchedule.totalDepreciation)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--dpf-muted)] mb-1">Final Book Value</p>
              <p className="text-sm font-semibold text-[var(--dpf-text)]">
                {sym}{formatMoney(residualValue)}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Notes */}
      {asset.notes && (
        <div className="mt-6 p-3 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)]">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)] mb-2">Notes</p>
          <p className="text-xs text-[var(--dpf-text)]">{asset.notes}</p>
        </div>
      )}
    </div>
  );
}
