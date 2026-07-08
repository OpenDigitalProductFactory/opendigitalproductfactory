// apps/web/app/(shell)/finance/assets/page.tsx
import { listAssets } from "@/lib/actions/assets";
import { getOrgSettings } from "@/lib/actions/currency";
import { getCurrencySymbol } from "@/lib/currency-symbol";
import { FinanceTabNav } from "@/components/finance/FinanceTabNav";
import { PlatformGridSection, parseSurfaceView } from "@/components/workbooks/PlatformGridSection";
import Link from "next/link";
import { AssetsTable, type AssetRow } from "./AssetsTable";

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

const ALL_STATUSES = ["active", "disposed", "written_off"];
const ALL_CATEGORIES = ["equipment", "vehicle", "furniture", "IT", "property", "other"];

type Props = { searchParams: Promise<{ status?: string; category?: string; view?: string }> };

export default async function AssetsPage({ searchParams }: Props) {
  const sp = await searchParams;
  const { status, category } = sp;
  const view = parseSurfaceView(sp.view);

  const [assets, orgSettings] = await Promise.all([
    listAssets({
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
    }),
    getOrgSettings(),
  ]);
  const sym = getCurrencySymbol(orgSettings.baseCurrency);

  const rows: AssetRow[] = assets.map((asset) => {
    const purchaseCost = Number(asset.purchaseCost);
    const accumulatedDepreciation = Number(asset.accumulatedDepreciation);
    return {
      id: asset.id,
      assetId: asset.assetId,
      name: asset.name,
      category: asset.category,
      purchaseCost,
      currentBookValue: Number(asset.currentBookValue),
      pctDepreciated:
        purchaseCost > 0 ? (accumulatedDepreciation / purchaseCost) * 100 : 0,
      status: asset.status,
    };
  });

  return (
    <div>
      {/* Breadcrumb */}
      <div className="mb-2">
        <Link href="/finance" className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]">
          Finance
        </Link>
        <span className="text-xs text-[var(--dpf-muted)]"> / </span>
        <span className="text-xs text-[var(--dpf-text)]">Assets</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Fixed Assets</h1>
        <Link
          href="/finance/assets/new"
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--dpf-accent)] text-white hover:opacity-90 transition-opacity"
        >
          New Asset
        </Link>
      </div>

      <FinanceTabNav />

      <PlatformGridSection entityType="fixed_asset" view={view} />

      {!view && (<>
      {/* Status filter pills */}
      <div className="flex flex-wrap gap-2 mb-3">
        <Link
          href={category ? `/finance/assets?category=${category}` : "/finance/assets"}
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !status
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All statuses
        </Link>
        {ALL_STATUSES.map((s) => {
          const colour = STATUS_COLOURS[s] ?? "#6b7280";
          const isActive = status === s;
          const href = category
            ? `/finance/assets?status=${s}&category=${category}`
            : `/finance/assets?status=${s}`;
          return (
            <Link
              key={s}
              href={href}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {s.replace(/_/g, " ")}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <Link
          href={status ? `/finance/assets?status=${status}` : "/finance/assets"}
          className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
            !category
              ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
              : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
          }`}
        >
          All categories
        </Link>
        {ALL_CATEGORIES.map((c) => {
          const colour = CATEGORY_COLOURS[c] ?? "#6b7280";
          const isActive = category === c;
          const href = status
            ? `/finance/assets?status=${status}&category=${c}`
            : `/finance/assets?category=${c}`;
          return (
            <Link
              key={c}
              href={href}
              className={`text-[10px] px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? "border-[var(--dpf-accent)] text-[var(--dpf-text)] bg-[var(--dpf-accent)]/10"
                  : "border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              <span style={{ color: isActive ? undefined : colour }}>
                {c}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Assets table */}
      {assets.length === 0 ? (
        <div className="p-8 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] text-center">
          <p className="text-sm text-[var(--dpf-muted)] mb-3">No assets found.</p>
          <Link
            href="/finance/assets/new"
            className="text-xs text-[var(--dpf-accent)] hover:underline"
          >
            Register your first asset →
          </Link>
        </div>
      ) : (
        <AssetsTable rows={rows} currencySymbol={sym} />
      )}
      </>)}
    </div>
  );
}
