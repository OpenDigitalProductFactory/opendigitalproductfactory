"use client";
// Edit the text a storefront section shows publicly (BI-C279E20B).
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { useT } from "@/lib/i18n/use-t";
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
  const t = useT("storefront");
  const fields = editableSectionTextFields(sectionType);
  const [text, setText] = useState<Record<string, string>>(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = t("sectionText.title", { name: sectionName });

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
      aria-label={title}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--dpf-bg)]/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <Surface padding="lg" rounded="xl" className="w-full max-w-[520px] max-h-[85vh] overflow-y-auto">
        <h2 className="mb-1 text-base font-semibold text-[var(--dpf-text)]">{title}</h2>
        <p className="mb-4 text-xs text-[var(--dpf-muted)]">{t("sectionText.hint")}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          {fields.map((field) => {
            const props = {
              value: text[field.key] ?? "",
              placeholder: t(`sectionText.fields.${field.key}.placeholder`),
              maxLength: field.maxLength,
              onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                setText((prev) => ({ ...prev, [field.key]: e.target.value })),
            };
            return (
              <label key={field.key} className="block">
                <span className="mb-1 block text-xs text-[var(--dpf-muted)]">
                  {t(`sectionText.fields.${field.key}.label`)}
                </span>
                {field.multiline ? (
                  <textarea {...props} rows={6} className={`${inputClass} resize-y`} />
                ) : (
                  <input {...props} type="text" className={inputClass} />
                )}
              </label>
            );
          })}
          {error && (
            <p role="alert" className="text-xs text-[var(--dpf-error)]">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-[var(--dpf-border)] pt-3">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              {t("sectionText.cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? t("sectionText.saving") : t("sectionText.save")}
            </Button>
          </div>
        </form>
      </Surface>
    </div>
  );
}
