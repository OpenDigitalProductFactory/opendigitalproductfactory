"use client";
import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ItemFormDialog, type ItemFormData } from "./ItemFormDialog";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";
import type { ResidueGroup } from "@/lib/storefront/content-fit";
import {
  RowActionSheet,
  MutationStatus,
  useRowMutations,
  confirmPublicChange,
  GeneratedResidueBanner,
  type RowAction,
} from "./content-editing-ui";

type Item = {
  id: string;
  itemId: string;
  catalogItemId?: string | null;
  compatibilitySource?: "catalog" | "storefront";
  name: string;
  description: string | null;
  category: string | null;
  priceAmount: string | null;
  priceCurrency: string;
  priceType: string | null;
  ctaType: string;
  ctaLabel: string | null;
  imageUrl: string | null;
  isActive: boolean;
  sortOrder: number;
  bookingConfig: Record<string, unknown> | null;
};

type Props = {
  storefrontId: string;
  items: Item[];
  vocabulary: ArchetypeVocabulary;
  archetypeCategory?: string;
  categorySuggestions: string[];
  defaultCtaType: string;
  defaultCurrency?: string;
  isPublished: boolean;
  residueGroups: ResidueGroup[];
  productLines?: Array<{ id: string; name: string }>;
};

const CTA_BADGES: Record<string, { color: string; label: string }> = {
  booking: { color: "var(--dpf-accent)", label: "Booking" },
  purchase: { color: "var(--dpf-success)", label: "Purchase" },
  inquiry: { color: "var(--dpf-warning)", label: "Inquiry" },
  donation: { color: "var(--dpf-info)", label: "Donation" },
  rental: { color: "var(--dpf-info)", label: "Rental" },
};

export function ItemsManager({
  storefrontId,
  items: initial,
  vocabulary,
  archetypeCategory = "",
  categorySuggestions,
  defaultCtaType,
  defaultCurrency,
  isPublished,
  residueGroups,
  productLines = [],
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const mutations = useRowMutations();

  const singular = vocabulary.singleItemLabel.toLowerCase();
  const publicWhere = `your public ${vocabulary.itemsLabel.toLowerCase()}`;

  // Derive unique categories from items
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];
  const filtered = activeCategory ? items.filter((i) => i.category === activeCategory) : items;

  // ─── CRUD Handlers ──────────────────────────────────────────────────

  function openCreate() {
    setEditingItem(null);
    setDialogOpen(true);
  }

  function openEdit(item: Item) {
    setEditingItem(item);
    setDialogOpen(true);
  }

  const handleSave = useCallback(async (formData: ItemFormData) => {
    const body = buildRequestBody(formData);

    if (editingItem) {
      const res = await fetch(`/api/storefront/admin/items/${editingItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const updated = await res.json();
      if (!res.ok) {
        throw new Error(
          updated.message ?? updated.error ?? `HTTP ${res.status}`,
        );
      }
      setItems((prev) => prev.map((i) => (i.id === editingItem.id ? { ...i, ...updated } : i)));
    } else {
      const res = await fetch("/api/storefront/admin/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await res.json();
      if (!res.ok) {
        throw new Error(
          created.message ?? created.error ?? `HTTP ${res.status}`,
        );
      }
      setItems((prev) => [...prev, created]);
    }
  }, [editingItem]);

  async function handleDelete(item: Item) {
    const confirmed = await confirmPublicChange({
      verb: "Remove",
      target: item.name,
      where: publicWhere,
      isPublished,
      danger: true,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;

    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await mutations.run(`${item.id}:delete`, async () => {
        const res = await fetch(`/api/storefront/admin/items/${item.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        // Soft-deleted (had bookings/inquiries) → keep it, deactivated.
        if (result.softDeleted) {
          setItems(snapshot.map((i) => (i.id === item.id ? { ...i, isActive: false } : i)));
        }
      });
    } catch {
      setItems(snapshot); // revert on failure
    }
  }

  async function toggleActive(item: Item) {
    const next = !item.isActive;
    const confirmed = await confirmPublicChange({
      verb: next ? "Show" : "Hide",
      target: item.name,
      where: publicWhere,
      isPublished,
    });
    if (!confirmed) return;

    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: next } : i)));
    try {
      await mutations.run(`${item.id}:active`, async () => {
        const res = await fetch(`/api/storefront/admin/items/${item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isActive: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
    } catch {
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, isActive: item.isActive } : i)));
    }
  }

  async function moveItem(item: Item, direction: "up" | "down") {
    const idx = items.findIndex((i) => i.id === item.id);
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= items.length) return;

    const snapshot = items;
    const next = [...items];
    const tmp = next[idx]!;
    next[idx] = next[swapIdx]!;
    next[swapIdx] = tmp;
    setItems(next);

    try {
      await mutations.run(`${item.id}:order`, async () => {
        const res = await fetch("/api/storefront/admin/items/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: next.map((it, i) => ({ id: it.id, sortOrder: i })) }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      });
    } catch {
      setItems(snapshot);
    }
  }

  function itemToFormData(item: Item): Partial<ItemFormData> {
    const bc = item.bookingConfig as Record<string, unknown> | null;
    return {
      id: item.id,
      name: item.name,
      description: item.description ?? "",
      category: item.category ?? "",
      ctaType: item.ctaType,
      priceType: item.priceType ?? "",
      priceAmount: item.priceAmount ?? "",
      priceCurrency: item.priceCurrency,
      imageUrl: item.imageUrl ?? "",
      ctaLabel: item.ctaLabel ?? "",
      durationMinutes: String(bc?.durationMinutes ?? "60"),
      schedulingPattern: String(bc?.schedulingPattern ?? "slot"),
      assignmentMode: String(bc?.assignmentMode ?? "next-available"),
      capacity: bc?.capacity != null ? String(bc.capacity) : "",
      beforeBufferMinutes: bc?.beforeBufferMinutes != null ? String(bc.beforeBufferMinutes) : "",
      afterBufferMinutes: bc?.afterBufferMinutes != null ? String(bc.afterBufferMinutes) : "",
      goalAmount: bc?.goalAmount != null ? String(bc.goalAmount) : "",
      suggestedAmount: bc?.suggestedAmount != null ? String(bc.suggestedAmount) : "",
    };
  }

  // ─── Render ───────────────────────────────────────────────────────────

  return (
    <div>
      <GeneratedResidueBanner storefrontId={storefrontId} groups={residueGroups} isPublished={isPublished} />

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">{vocabulary.itemsLabel}</h2>
        <button
          onClick={openCreate}
          className="inline-flex min-h-[44px] items-center px-4 py-1.5 text-xs font-medium rounded-md transition-colors bg-[var(--dpf-accent)] text-white"
        >
          {vocabulary.addButtonLabel}
        </button>
      </div>

      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="flex gap-1 mb-4 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            aria-label={`Show all ${vocabulary.itemsLabel.toLowerCase()}`}
            className={`inline-flex min-h-[44px] items-center px-3 py-1 text-[10px] font-medium rounded-full transition-colors ${
              activeCategory === null
                ? "bg-[var(--dpf-accent)] text-white"
                : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            }`}
          >
            All
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat === activeCategory ? null : cat)}
              aria-label={`Filter to ${cat}`}
              className={`inline-flex min-h-[44px] items-center px-3 py-1 text-[10px] font-medium rounded-full transition-colors ${
                activeCategory === cat
                  ? "bg-[var(--dpf-accent)] text-white"
                  : "bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Item cards */}
      <div className="space-y-2">
        {filtered.map((item) => {
          const badge = CTA_BADGES[item.ctaType] ?? { color: "var(--dpf-muted)", label: item.ctaType };
          const globalIdx = items.findIndex((i) => i.id === item.id);
          const activeState = mutations.get(`${item.id}:active`);
          const orderState = mutations.get(`${item.id}:order`);
          const deleteState = mutations.get(`${item.id}:delete`);
          const rowState = deleteState.phase !== "idle"
            ? deleteState
            : activeState.phase !== "idle"
              ? activeState
              : orderState;

          const actions: RowAction[] = [
            { label: `Edit ${item.name}`, onSelect: () => openEdit(item) },
            ...(item.catalogItemId
              ? [
                  {
                    label: `Manage packaging and sales options for ${item.name}`,
                    onSelect: () =>
                      router.push(`/storefront/items/${item.id}/catalog`),
                  },
                ]
              : []),
            {
              label: item.isActive
                ? `Hide ${item.name} from ${publicWhere}`
                : `Show ${item.name} on ${publicWhere}`,
              onSelect: () => void toggleActive(item),
            },
            {
              label: `Move ${item.name} up`,
              onSelect: () => void moveItem(item, "up"),
              disabled: globalIdx <= 0,
            },
            {
              label: `Move ${item.name} down`,
              onSelect: () => void moveItem(item, "down"),
              disabled: globalIdx >= items.length - 1,
            },
            { label: `Remove ${item.name}`, onSelect: () => void handleDelete(item), tone: "danger" },
          ];

          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center gap-3 p-3 rounded-lg"
              style={{
                background: "var(--dpf-surface-1)",
                opacity: item.isActive ? 1 : 0.5,
                borderLeft: `3px solid ${badge.color}`,
              }}
            >
              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-[var(--dpf-text)] truncate">{item.name}</span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ background: `${badge.color}20`, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  {item.category && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] shrink-0">
                      {item.category}
                    </span>
                  )}
                  {item.compatibilitySource === "storefront" && (
                    <span
                      className="shrink-0 rounded-full px-1.5 py-0.5 text-dpf-caption text-[var(--dpf-warning)]"
                      style={{
                        background:
                          "color-mix(in srgb, var(--dpf-warning) 13%, transparent)",
                      }}
                      title="Finish the product-line setup so this item can use the shared commercial catalog."
                    >
                      Needs setup link
                    </span>
                  )}
                  {!item.isActive && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--dpf-surface-2)] text-[var(--dpf-muted)] shrink-0">
                      Hidden
                    </span>
                  )}
                </div>
                {item.description && (
                  <p className="text-[11px] text-[var(--dpf-muted)] truncate">{item.description}</p>
                )}
              </div>

              {/* Price */}
              <div className="text-right shrink-0">
                <span className="text-xs text-[var(--dpf-text)]">
                  {formatPrice(item.priceAmount, item.priceCurrency, item.priceType)}
                </span>
              </div>

              {/* Status + single labelled action trigger */}
              <div className="flex items-center gap-2 shrink-0">
                <MutationStatus
                  state={rowState}
                  onRetry={() => mutations.retry(
                    deleteState.phase === "failed"
                      ? `${item.id}:delete`
                      : activeState.phase === "failed"
                        ? `${item.id}:active`
                        : `${item.id}:order`,
                  )}
                  label={singular}
                />
                <RowActionSheet rowLabel={item.name} actions={actions} />
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-[var(--dpf-muted)] py-8 text-center">
          {activeCategory
            ? `No ${vocabulary.itemsLabel.toLowerCase()} in "${activeCategory}".`
            : `No ${vocabulary.itemsLabel.toLowerCase()} yet. Click "${vocabulary.addButtonLabel}" to create one.`}
        </p>
      )}

      {/* Form dialog — key forces remount when editing item changes so useState initializer re-runs */}
      <ItemFormDialog
        key={editingItem?.id ?? "new"}
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSave}
        initial={editingItem ? itemToFormData(editingItem) : undefined}
        vocabulary={vocabulary}
        archetypeCategory={archetypeCategory}
        categorySuggestions={categorySuggestions}
        defaultCtaType={defaultCtaType}
        defaultPriceCurrency={defaultCurrency}
        isEditing={!!editingItem}
        editingItemId={editingItem?.id}
        productLines={productLines}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(amount: string | null, currency: string, priceType: string | null): string {
  const symbol = getCurrencySymbol(currency);

  if (!priceType) return "—";

  switch (priceType) {
    case "fixed":
      return amount ? `${symbol}${Number(amount).toFixed(2)}` : "—";
    case "from":
      return amount ? `From ${symbol}${Number(amount).toFixed(2)}` : "From...";
    case "per-hour":
      return amount ? `${symbol}${Number(amount).toFixed(2)}/hr` : "/hr";
    case "per-session":
      return amount ? `${symbol}${Number(amount).toFixed(2)}/session` : "/session";
    case "free":
      return "Free";
    case "donation":
      return "Donation";
    case "quote":
      return "Quote";
    default:
      return priceType;
  }
}

function buildRequestBody(form: ItemFormData): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    description: form.description.trim() || null,
    category: form.category.trim() || null,
    ctaType: form.ctaType,
    priceType: form.priceType || null,
    priceAmount: form.priceAmount ? parseFloat(form.priceAmount) : null,
    priceCurrency: form.priceCurrency,
    imageUrl: form.imageUrl.trim() || null,
    ctaLabel: form.ctaLabel.trim() || null,
    productLineId: form.productLineId || null,
  };

  if (form.ctaType === "booking") {
    body.bookingConfig = {
      durationMinutes: parseInt(form.durationMinutes, 10) || 60,
      schedulingPattern: form.schedulingPattern || "slot",
      assignmentMode: form.assignmentMode || "next-available",
      ...(form.capacity && { capacity: parseInt(form.capacity, 10) }),
      ...(form.beforeBufferMinutes && { beforeBufferMinutes: parseInt(form.beforeBufferMinutes, 10) }),
      ...(form.afterBufferMinutes && { afterBufferMinutes: parseInt(form.afterBufferMinutes, 10) }),
    };
  }

  if (form.ctaType === "donation") {
    if (form.goalAmount) body.goalAmount = parseFloat(form.goalAmount);
    if (form.suggestedAmount) body.suggestedAmount = parseFloat(form.suggestedAmount);
  }

  return body;
}
