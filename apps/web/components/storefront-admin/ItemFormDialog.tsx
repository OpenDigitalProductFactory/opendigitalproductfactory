"use client";
import { useState } from "react";
import type { ArchetypeVocabulary } from "@/lib/storefront/archetype-vocabulary";

export type ItemFormData = {
  id?: string;
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
  name: "",
  description: "",
  category: "",
  ctaType: "booking",
  priceType: "",
  priceAmount: "",
  priceCurrency: "GBP",
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

const CTA_TYPES = [
  { value: "booking", label: "Booking" },
  { value: "purchase", label: "Purchase" },
  { value: "inquiry", label: "Inquiry" },
  { value: "donation", label: "Donation" },
];

const PRICE_TYPES_BY_CTA: Record<string, Array<{ value: string; label: string }>> = {
  booking: [
    { value: "per-hour", label: "Per hour" },
    { value: "per-session", label: "Per session" },
    { value: "fixed", label: "Fixed price" },
    { value: "free", label: "Free" },
  ],
  purchase: [
    { value: "fixed", label: "Fixed price" },
    { value: "from", label: "From (minimum)" },
  ],
  inquiry: [
    { value: "quote", label: "Request a quote" },
    { value: "from", label: "From (starting at)" },
    { value: "per-hour", label: "Per hour" },
    { value: "fixed", label: "Fixed price" },
  ],
  donation: [
    { value: "donation", label: "Any amount" },
  ],
};

const CTA_LABEL_DEFAULTS: Record<string, string> = {
  booking: "Book now",
  purchase: "Order now",
  inquiry: "Get a quote",
  donation: "Donate now",
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (data: ItemFormData) => Promise<void>;
  initial?: Partial<ItemFormData>;
  vocabulary: ArchetypeVocabulary;
  categorySuggestions: string[];
  defaultCtaType: string;
  isEditing: boolean;
};

export function ItemFormDialog({
  open,
  onClose,
  onSave,
  initial,
  vocabulary,
  categorySuggestions,
  defaultCtaType,
  isEditing,
}: Props) {
  const [form, setForm] = useState<ItemFormData>(() => ({
    ...EMPTY_FORM,
    ctaType: defaultCtaType,
    priceType: PRICE_TYPES_BY_CTA[defaultCtaType]?.[0]?.value ?? "",
    ...initial,
  }));
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  function set(field: keyof ItemFormData, value: string) {
    setForm((prev) => {
      const next = { ...prev, [field]: value };
      // When CTA type changes, reset price type to first option for new type
      if (field === "ctaType") {
        next.priceType = PRICE_TYPES_BY_CTA[value]?.[0]?.value ?? "";
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

  const priceOptions = PRICE_TYPES_BY_CTA[form.ctaType] ?? [];
  const showPrice = form.ctaType !== "donation" && form.priceType !== "free" && form.priceType !== "quote";
  const showBookingConfig = form.ctaType === "booking";
  const showDonationConfig = form.ctaType === "donation";
  const showCapacity = form.schedulingPattern === "class";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--dpf-surface-1)", borderRadius: 12,
          padding: 24, width: "100%", maxWidth: 520, maxHeight: "85vh",
          overflowY: "auto", border: "1px solid var(--dpf-border)",
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

            <Field label="Type">
              <select
                value={form.ctaType}
                onChange={(e) => set("ctaType", e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]"
              >
                {CTA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
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
                      {form.priceCurrency === "GBP" ? "\u00a3" : form.priceCurrency === "USD" ? "$" : form.priceCurrency === "EUR" ? "\u20ac" : form.priceCurrency}
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
                  placeholder={CTA_LABEL_DEFAULTS[form.ctaType] ?? ""}
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
                    {form.priceCurrency === "GBP" ? "\u00a3" : form.priceCurrency === "USD" ? "$" : form.priceCurrency === "EUR" ? "\u20ac" : form.priceCurrency}
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
                    {form.priceCurrency === "GBP" ? "\u00a3" : form.priceCurrency === "USD" ? "$" : form.priceCurrency === "EUR" ? "\u20ac" : form.priceCurrency}
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

          {/* Image URL (all types) */}
          <details className="text-sm pt-3 border-t border-[var(--dpf-border)]">
            <summary className="text-[10px] text-[var(--dpf-muted)] cursor-pointer hover:text-[var(--dpf-text)]">
              Image
            </summary>
            <div className="mt-2">
              <Field label="Image URL">
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
              disabled={saving || !form.name.trim()}
              className="px-4 py-1.5 text-sm rounded-md font-medium transition-colors disabled:opacity-50"
              style={{ background: "var(--dpf-accent)", color: "#fff" }}
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
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}
