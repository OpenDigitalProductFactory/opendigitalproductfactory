"use client";
// Edit the text a storefront section shows publicly (BI-C279E20B).
import { useState } from "react";
import { editableSectionTextFields } from "@/lib/storefront/section-text";

type Props = {
  sectionName: string;
  sectionType: string;
  initialText: Record<string, string>;
  onSave: (text: Record<string, string>) => Promise<string | null>;
  onClose: () => void;
};

const inputClass =
  "w-full px-3 py-1.5 text-sm rounded-md bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] text-[var(--dpf-text)] outline-none focus:border-[var(--dpf-accent)]";

export function SectionTextDialog({ sectionName, sectionType, initialText, onSave, onClose }: Props) {
  const fields = editableSectionTextFields(sectionType);
  const [text, setText] = useState<Record<string, string>>(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const failure = await onSave(text);
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${sectionName} text`}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--dpf-bg)]/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[520px] max-h-[85vh] overflow-y-auto rounded-xl border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-6">
        <h2 className="mb-1 text-base font-semibold text-[var(--dpf-text)]">Edit {sectionName} text</h2>
        <p className="mb-4 text-xs text-[var(--dpf-muted)]">Visitors see this on your public page as soon as you save.</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => (
            <label key={field.key} className="block">
              <span className="mb-1 block text-xs text-[var(--dpf-muted)]">{field.label}</span>
              {field.multiline ? (
                <textarea
                  value={text[field.key] ?? ""}
                  onChange={(e) => setText((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  rows={6}
                  className={`${inputClass} resize-y`}
                />
              ) : (
                <input
                  type="text"
                  value={text[field.key] ?? ""}
                  onChange={(e) => setText((prev) => ({ ...prev, [field.key]: e.target.value }))}
                  placeholder={field.placeholder}
                  maxLength={field.maxLength}
                  className={inputClass}
                />
              )}
            </label>
          ))}
          {error && (
            <p role="alert" className="text-xs text-[var(--dpf-error)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-[var(--dpf-border)] pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-[var(--dpf-border)] px-4 py-1.5 text-sm text-[var(--dpf-muted)] transition-colors hover:text-[var(--dpf-text)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[var(--dpf-accent)] px-4 py-1.5 text-sm font-medium text-[var(--dpf-on-accent)] transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save text"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
