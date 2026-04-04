"use client";
import { useState, useCallback } from "react";
import { ItemFormDialog, type ItemFormData } from "./ItemFormDialog";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

type Item = {
  id: string;
  itemId: string;
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
  categorySuggestions: string[];
  defaultCtaType: string;
};

const CTA_BADGES: Record<string, { color: string; label: string }> = {
  booking: { color: "#a78bfa", label: "Booking" },
  purchase: { color: "#4ade80", label: "Purchase" },
  inquiry: { color: "#fb923c", label: "Inquiry" },
  donation: { color: "#f472b6", label: "Donation" },
};

export function ItemsManager({ storefrontId, items: initial, vocabulary, categorySuggestions, defaultCtaType }: Props) {
  const [items, setItems] = useState(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Derive unique categories from items
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))] as string[];

  // Filter items by active category
  const filtered = activeCategory
    ? items.filter((i) => i.category === activeCategory)
    : items;

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
      // Update
      const res = await fetch(`/api/storefront/admin/items/${editingItem.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const updated = await res.json();
      setItems((prev) => prev.map((i) => i.id === editingItem.id ? { ...i, ...updated } : i));
    } else {
      // Create
      const res = await fetch("/api/storefront/admin/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const created = await res.json();
      setItems((prev) => [...prev, created]);
    }
  }, [editingItem]);

  async function handleDelete(item: Item) {
    const confirmed = window.confirm(`Delete "${item.name}"? This cannot be undone.`);
    if (!confirmed) return;

    const res = await fetch(`/api/storefront/admin/items/${item.id}`, { method: "DELETE" });
    const result = await res.json();

    if (result.softDeleted) {
      // Item was deactivated instead of deleted
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isActive: false } : i));
    } else {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }
  }

  async function toggleActive(id: string, isActive: boolean) {
    await fetch(`/api/storefront/admin/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    setItems((prev) => prev.map((i) => i.id === id ? { ...i, isActive } : i));
  }

  // ─── Drag-to-Reorder ─────────────────────────────────────────────────

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;

    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      return next;
    });
    setDragIdx(idx);
  }

  async function handleDragEnd() {
    setDragIdx(null);
    // Persist new order
    const reorderData = items.map((item, idx) => ({ id: item.id, sortOrder: idx }));
    await fetch("/api/storefront/admin/items/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: reorderData }),
    });
  }

  // ─── Form Data Conversion ─────────────────────────────────────────────

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
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-[var(--dpf-text)]">
          {vocabulary.itemsLabel}
        </h2>
        <button
          onClick={openCreate}
          className="px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          style={{ background: "var(--dpf-accent)", color: "#fff" }}
        >
          {vocabulary.addButtonLabel}
        </button>
      </div>

      {/* Category tabs */}
      {categories.length > 0 && (
        <div className="flex gap-1 mb-4 flex-wrap">
          <button
            onClick={() => setActiveCategory(null)}
            className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
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
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full transition-colors ${
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
        {filtered.map((item, idx) => {
          const badge = CTA_BADGES[item.ctaType] ?? { color: "#8888a0", label: item.ctaType };
          return (
            <div
              key={item.id}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className="flex items-center gap-3 p-3 rounded-lg transition-colors cursor-grab active:cursor-grabbing"
              style={{
                background: dragIdx === idx ? "var(--dpf-surface-2)" : "var(--dpf-surface-1)",
                opacity: item.isActive ? 1 : 0.5,
                borderLeft: `3px solid ${badge.color}`,
              }}
            >
              {/* Drag handle */}
              <span className="text-[var(--dpf-muted)] text-xs select-none" title="Drag to reorder">::</span>

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

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleActive(item.id, !item.isActive)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-border)] hover:bg-[var(--dpf-surface-2)] transition-colors"
                  style={{ color: item.isActive ? "#4ade80" : "var(--dpf-muted)" }}
                  title={item.isActive ? "Deactivate" : "Activate"}
                >
                  {item.isActive ? "On" : "Off"}
                </button>
                <button
                  onClick={() => openEdit(item)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] hover:bg-[var(--dpf-surface-2)] transition-colors"
                  title="Edit"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(item)}
                  className="text-[10px] px-2 py-0.5 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-red-400 hover:border-red-400/30 transition-colors"
                  title="Delete"
                >
                  Del
                </button>
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

      {/* Form dialog */}
      <ItemFormDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditingItem(null); }}
        onSave={handleSave}
        initial={editingItem ? itemToFormData(editingItem) : undefined}
        vocabulary={vocabulary}
        categorySuggestions={categorySuggestions}
        defaultCtaType={defaultCtaType}
        isEditing={!!editingItem}
      />
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(amount: string | null, currency: string, priceType: string | null): string {
  const symbol = currency === "GBP" ? "\u00a3" : currency === "USD" ? "$" : currency === "EUR" ? "\u20ac" : currency + " ";

  if (!priceType) return "\u2014";

  switch (priceType) {
    case "fixed":
      return amount ? `${symbol}${Number(amount).toFixed(2)}` : "\u2014";
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
