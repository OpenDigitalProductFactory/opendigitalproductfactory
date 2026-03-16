"use client";

import { useState } from "react";
import { saveSimpleBrand } from "@/lib/actions/branding";
import { BrandingPreview } from "./BrandingPreview";

const FONT_OPTIONS = [
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Source Sans 3", value: "Source Sans 3, Arial, sans-serif" },
  { label: "Space Grotesk", value: "Space Grotesk, system-ui, sans-serif" },
  { label: "Lato", value: "Lato, Arial, sans-serif" },
  { label: "Nunito", value: "Nunito, Arial, sans-serif" },
  { label: "Roboto", value: "Roboto, Arial, sans-serif" },
  { label: "Poppins", value: "Poppins, system-ui, sans-serif" },
];

type Props = {
  currentName: string;
  currentLogoUrl: string;
  currentAccent: string;
  currentFont: string;
  onRerunWizard: () => void;
};

export function BrandingQuickEdit({
  currentName,
  currentLogoUrl,
  currentAccent,
  currentFont,
  onRerunWizard,
}: Props) {
  const [name, setName] = useState(currentName);
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl);
  const [accent, setAccent] = useState(currentAccent);
  const [font, setFont] = useState(currentFont);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    const fd = new FormData();
    fd.set("companyName", name);
    fd.set("logoUrl", logoUrl);
    fd.set("accent", accent);
    fd.set("fontFamily", font);
    await saveSimpleBrand(fd);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Form */}
      <form onSubmit={handleSubmit} className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white mb-0.5">Brand settings</h2>
          <p className="text-xs text-[var(--dpf-muted)]">Changes are reflected in the live preview on the right.</p>
        </div>

        {/* Company Name */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Company name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="Your Company"
            className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
          />
        </label>

        {/* Logo URL */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Logo URL</span>
          <input
            type="text"
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.currentTarget.value)}
            placeholder="https://example.com/logo.png"
            className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
          />
        </label>

        {/* Accent color */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Accent color</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={accent}
              onChange={(e) => setAccent(e.currentTarget.value)}
              className="w-12 h-9 rounded border border-[var(--dpf-border)] bg-transparent p-0.5 cursor-pointer"
            />
            <input
              type="text"
              value={accent}
              onChange={(e) => setAccent(e.currentTarget.value)}
              className="flex-1 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </div>
        </label>

        {/* Font family */}
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Font family</span>
          <select
            value={font}
            onChange={(e) => setFont(e.currentTarget.value)}
            className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-[var(--dpf-accent)]"
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-[var(--dpf-accent)] text-white text-xs font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : saved ? "Saved!" : "Save brand"}
          </button>
          <button
            type="button"
            onClick={onRerunWizard}
            className="text-xs text-[var(--dpf-muted)] hover:text-white underline underline-offset-2"
          >
            Re-run setup wizard
          </button>
        </div>
      </form>

      {/* Live preview */}
      <div className="flex flex-col gap-2">
        <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Live preview</p>
        <BrandingPreview
          companyName={name}
          logoUrl={logoUrl}
          accentColor={accent}
          fontFamily={font}
        />
      </div>
    </div>
  );
}
