"use client";
import { useState, useEffect, useRef } from "react";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";
import { DEFAULT_CTA_LABELS } from "@/lib/storefront/cta-labels";
import { getCurrencySymbol } from "@/lib/finance/currency-symbol";
import {
  STOREFRONT_CTA_OPTIONS,
  storefrontPriceOptions,
} from "@/lib/products/storefront-commercial-options";
import { MediaUploader } from "./MediaUploader";

export type ItemFormData = {
  id?: string;
  productLineId: string;
  name: string;
  description: string;
  category: string;
  ctaType: string;
  priceType: string;
  priceAmount: string;
  priceCurrency: string;
  imageUrl: string;
  ctaLabel: string;
  // Booking fields
  durationMinutes: string;
  schedulingPattern: string;
  assignmentMode: string;
  capacity: string;
  beforeBufferMinutes: string;
  afterBufferMinutes: string;
  // Donation fields
  goalAmount: string;
  suggestedAmount: string;
};

const EMPTY_FORM: ItemFormData = {
  productLineId: "",
  name: "",
  description: "",
  category: "",
  ctaType: "booking",
  priceType: "",
  priceAmount: "",
  priceCurrency: "USD",
  imageUrl: "",
  ctaLabel: "",
  durationMinutes: "60",
  schedulingPattern: "slot",
  assignmentMode: "next-available",
  capacity: "",
  beforeBufferMinutes: "",
  afterBufferMinutes: "",
  goalAmount: "",
  suggestedAmount: "",
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (data: ItemFormData) => Promise<void>;
  initial?: Partial<ItemFormData>;
  vocabulary: ArchetypeVocabulary;
  categorySuggestions: string[];
  defaultCtaType: string;
  /** Workspace base currency; defaults to USD when not provided. */
  defaultPriceCurrency?: string;
  isEditing: boolean;
  /** DB id of the item being edited; enables the photo-gallery uploader. */
  editingItemId?: string;
  productLines?: Array<{ id: string; name: string }>;
};

export function ItemFormDialog({
  open,
  onClose,
  onSave,
  initial,
  vocabulary,
  categorySuggestions,
  defaultCtaType,
  defaultPriceCurrency = "USD",
  isEditing,
  editingItemId,
  productLines = [],
}: Props) {
  const [form, setForm] = useState<ItemFormData>(() => ({
    ...EMPTY_FORM,
    productLineId:
      productLines.length === 1 ? productLines[0]!.id : "",
    priceCurrency: defaultPriceCurrency,
    ctaType: defaultCtaType,
    priceType: storefrontPriceOptions(defaultCtaType)[0]?.value ?? "",
    ...initial,
  }));
  const [saving, setSaving] = useState(false);

  // Reset form when dialog opens so stale values from a previous item don't bleed
  // through (R6-003: edit modal opened with empty Name / wrong values on second open).
  const prevOpenRef = useRef(false);
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const defaultCtaTypeRef = useRef(defaultCtaType);
  defaultCtaTypeRef.current = defaultCtaType;
  const productLinesRef = useRef(productLines);
  productLinesRef.current = productLines;
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      const ct = defaultCtaTypeRef.current ?? "booking";
      setForm({
        ...EMPTY_FORM,
        productLineId:
          productLinesRef.current.length === 1
            ? productLinesRef.current[0]!.id
            : "",
        ctaType: ct,
        priceType: storefrontPriceOptions(ct)[0]?.value ?? "",
        ...initialRef.current,
      });
    }
    prevOpenRef.current = open;
  }, [open]);

  if (!open) return null;

  function set(field: keyof ItemFormData, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // When CTA type changes, reset price type to first option for new type
      if (field === "ctaType") {
        next.priceType = storefrontPriceOptions(value)[0]?.value ?? "";
      }
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const priceOptions = storefrontPriceOptions(form.ctaType);
  const showPrice = form.ctaType !== "donation" && form.priceType !== "free" && form.priceType !== "quote";
  const showBookingConfig = form.ctaType === "booking";
  const showDonationConfig = form.ctaType === "donation";
  const showCapacity = form.schedulingPattern === "class";

  return (
    <div
      className="bg-black/50"
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)]"
        style={{
          borderRadius: 12,
          padding: 24, width: "100%", maxWidth: 520, maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <h2 className="text-base font-semibold text-[var(--dpf-text)] mb-4">
          {isEditing ? `Edit ${vocabulary.singleItemLabel}` : vocabulary.addButtonLabel}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Section 1: Basics */}
          <div className="space-y-3">
            <Field label="Name" required>
              <input
                type="text"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder={`${vocabulary.singleItemLabel} name`}
                required
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Customer-facing description"
                rows={2}
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)] resize-none"
              />
            </Field>

            <Field label={vocabulary.categoryLabel}>
              <input
                type="text"
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="Type or select..."
                list="category-suggestions"
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
              />
              <datalist id="category-suggestions">
                {categorySuggestions.map((c) => <option key={c} value={c} />)}
              </datalist>
            </Field>

            {!isEditing && productLines.length > 1 && (
              <Field label="Product line" required>
                <select
                  value={form.productLineId}
                  onChange={(e) => set("productLineId", e.target.value)}
                  required
                  className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                >
                  <option value="">Choose a product line</option>
                  {productLines.map((line) => (
                    <option key={line.id} value={line.id}>{line.name}</option>
                  ))}
                </select>
                <span className="mt-1 block text-dpf-caption text-[var(--dpf-muted)]">
                  Shown because this business sells through more than one product line.
                </span>
              </Field>
            )}

            <Field label="Type">
              <select
                value={form.ctaType}
                onChange={(e) => set("ctaType", e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
              >
                {STOREFRONT_CTA_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </Field>
          </div>

          {/* Section 2: Pricing */}
          {priceOptions.length > 0 && (
            <div className="pt-3 border-t border-[var(--dpf-border)] space-y-3">
              <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider font-semibold">
                {vocabulary.priceLabel}
              </p>

              {priceOptions.length > 1 && (
                <Field label={`${vocabulary.priceLabel} type`}>
                  <select
                    value={form.priceType}
                    onChange={(e) => set("priceType", e.target.value)}
                    className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  >
                    {priceOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
              )}

              {showPrice && (
                <Field label="Amount">
                  <div className="flex gap-2">
                    <span className="flex items-center text-sm text-[var(--dpf-muted)]">
                      {getCurrencySymbol(form.priceCurrency)}
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={form.priceAmount}
                      onChange={(e) => set("priceAmount", e.target.value)}
                      placeholder="0.00"
                      className="flex-1 px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </div>
                </Field>
              )}

              <Field label="Button label">
                <input
                  type="text"
                  value={form.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                  placeholder={DEFAULT_CTA_LABELS[form.ctaType] ?? ""}
                  className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
              </Field>
            </div>
          )}

          {/* Section 3: Booking Config */}
          {showBookingConfig && (
            <div className="pt-3 border-t border-[var(--dpf-border)] space-y-3">
              <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider font-semibold">
                Booking settings
              </p>

              <Field label="Duration (minutes)" required>
                <input
                  type="number"
                  min="5"
                  step="5"
                  value={form.durationMinutes}
                  onChange={(e) => set("durationMinutes", e.target.value)}
                  required
                  className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Pattern">
                  <select
                    value={form.schedulingPattern}
                    onChange={(e) => set("schedulingPattern", e.target.value)}
                    className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  >
                    <option value="slot">1:1 Slot</option>
                    <option value="class">Class / Group</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </Field>

                <Field label="Assignment">
                  <select
                    value={form.assignmentMode}
                    onChange={(e) => set("assignmentMode", e.target.value)}
                    className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  >
                    <option value="next-available">Next available</option>
                    <option value="customer-choice">Customer chooses</option>
                  </select>
                </Field>
              </div>

              {showCapacity && (
                <Field label="Capacity (max attendees)">
                  <input
                    type="number"
                    min="1"
                    value={form.capacity}
                    onChange={(e) => set("capacity", e.target.value)}
                    placeholder="e.g. 20"
                    className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  />
                </Field>
              )}

              <details className="text-sm">
                <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text)]">
                  Advanced buffer settings
                </summary>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <Field label="Buffer before (min)">
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={form.beforeBufferMinutes}
                      onChange={(e) => set("beforeBufferMinutes", e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </Field>
                  <Field label="Buffer after (min)">
                    <input
                      type="number"
                      min="0"
                      step="5"
                      value={form.afterBufferMinutes}
                      onChange={(e) => set("afterBufferMinutes", e.target.value)}
                      placeholder="0"
                      className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                    />
                  </Field>
                </div>
              </details>
            </div>
          )}

          {/* Section 4: Donation Config */}
          {showDonationConfig && (
            <div className="pt-3 border-t border-[var(--dpf-border)] space-y-3">
              <p className="text-[10px] text-[var(--dpf-muted)] uppercase tracking-wider font-semibold">
                Donation settings
              </p>

              <Field label="Suggested amount">
                <div className="flex gap-2">
                  <span className="flex items-center text-sm text-[var(--dpf-muted)]">
                    {getCurrencySymbol(form.priceCurrency)}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.suggestedAmount}
                    onChange={(e) => set("suggestedAmount", e.target.value)}
                    placeholder="Optional"
                    className="flex-1 px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  />
                </div>
              </Field>

              <Field label="Goal amount">
                <div className="flex gap-2">
                  <span className="flex items-center text-sm text-[var(--dpf-muted)]">
                    {getCurrencySymbol(form.priceCurrency)}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={form.goalAmount}
                    onChange={(e) => set("goalAmount", e.target.value)}
                    placeholder="Optional fundraising target"
                    className="flex-1 px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                  />
                </div>
              </Field>
            </div>
          )}

          {/* Images */}
          <details className="text-sm pt-3 border-t border-[var(--dpf-border)]" open={Boolean(editingItemId)}>
            <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text)]">
              Images
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              {editingItemId ? (
                // Existing item: real upload + gallery via the media substrate.
                <MediaUploader
                  ownerType="StorefrontItem"
                  ownerId={editingItemId}
                  role="product"
                  label="Photos"
                  hint="First photo is the one shown on the storefront card"
                />
              ) : (
                // New item: gallery uploads need a saved item to attach to — save
                // first, then reopen to add photos. A URL still works immediately.
                <p className="text-[11px] text-[var(--dpf-muted)]">
                  Save the {vocabulary.singleItemLabel.toLowerCase()} first, then reopen it to add photos.
                </p>
              )}
              <Field label="Or paste an image URL">
                <input
                  type="url"
                  value={form.imageUrl}
                  onChange={(e) => set("imageUrl", e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
                />
              </Field>
            </div>
          </details>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--dpf-border)]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-md border border-[var(--dpf-border)] text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                saving ||
                !form.name.trim() ||
                (!isEditing &&
                  productLines.length > 1 &&
                  !form.productLineId)
              }
              className="px-4 py-1.5 text-sm rounded-md font-medium transition-colors disabled:opacity-50 bg-[var(--dpf-accent)] text-white"
            >
              {saving ? "Saving..." : isEditing ? "Save changes" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-[var(--dpf-muted)] mb-1 block">
        {label}{required && <span className="text-[var(--dpf-error)] ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
