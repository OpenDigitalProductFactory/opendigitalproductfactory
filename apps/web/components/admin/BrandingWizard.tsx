"use client";

import { useState } from "react";
import { saveSimpleBrand, importBrandFromUrl } from "@/lib/actions/branding";
import { OOTB_PRESETS, deriveThemeTokens } from "@/lib/branding-presets";
import type { Correction } from "@/lib/branding-presets";
import { BrandingDualPreview } from "./BrandingPreview";

const FONT_OPTIONS = [
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Source Sans 3", value: "Source Sans 3, Arial, sans-serif" },
  { label: "Space Grotesk", value: "Space Grotesk, system-ui, sans-serif" },
  { label: "Lato", value: "Lato, Arial, sans-serif" },
  { label: "Nunito", value: "Nunito, Arial, sans-serif" },
  { label: "Roboto", value: "Roboto, Arial, sans-serif" },
  { label: "Poppins", value: "Poppins, system-ui, sans-serif" },
];

type Step = "choose" | "preview" | "finetune";

type Props = {
  existingName?: string | undefined;
  existingLogoUrl?: string | undefined;
  existingAccent?: string | undefined;
  existingFont?: string | undefined;
  onCancel?: (() => void) | undefined;
};

export function BrandingWizard({
  existingName,
  existingLogoUrl,
  existingAccent,
  existingFont,
  onCancel,
}: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [name, setName] = useState(existingName ?? "");
  const [logoUrl, setLogoUrl] = useState(existingLogoUrl ?? "");
  const [logoUrlLight, setLogoUrlLight] = useState("");
  const [accent, setAccent] = useState(existingAccent ?? "#7c8cf8");
  const [font, setFont] = useState(existingFont ?? "Inter, system-ui, sans-serif");
  const [saving, setSaving] = useState(false);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [urlInput, setUrlInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const handleAnalyzeUrl = async () => {
    if (!urlInput.trim()) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    const result = await importBrandFromUrl(urlInput.trim());
    setAnalyzing(false);
    if (!result.ok) {
      setAnalyzeError(result.error);
      return;
    }
    if (result.companyName) setName(result.companyName);
    if (result.logoUrl) setLogoUrl(result.logoUrl);
    if (result.logoUrlLight) setLogoUrlLight(result.logoUrlLight);
    if (result.accentColor) setAccent(result.accentColor);
    setStep("preview");
  };

  const applyPreset = (preset: (typeof OOTB_PRESETS)[number]) => {
    setAccent(preset.tokens.dark.palette.accent);
    setFont(preset.tokens.dark.typography.fontFamily);
    if (!name) setName(preset.label);
    setStep("preview");
  };

  const handleSave = async () => {
    setSaving(true);
    const fd = new FormData();
    fd.set("companyName", name || "Open Digital Product Factory");
    fd.set("logoUrl", logoUrl);
    fd.set("logoUrlLight", logoUrlLight);
    fd.set("accent", accent);
    fd.set("fontFamily", font);
    const { corrections: newCorrections } = await saveSimpleBrand(fd);
    setCorrections(newCorrections);
    setSaving(false);
  };

  /* ------------------------------------------------------------------ */
  /* Step: choose                                                         */
  /* ------------------------------------------------------------------ */
  if (step === "choose") {
    return (
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-0.5">Set up your brand</h2>
            <p className="text-xs text-[var(--dpf-muted)]">
              Import from a URL, upload a brand document, or pick a preset to get started quickly.
            </p>
          </div>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)] underline underline-offset-2 flex-shrink-0"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Import from URL */}
        <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">Import from URL</p>
          <p className="text-[11px] text-[var(--dpf-muted)]">
            Paste your company website and we&apos;ll extract your logo, colors, and name.
          </p>
          <div className="flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.currentTarget.value)}
              placeholder="https://yourcompany.com"
              disabled={analyzing}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAnalyzeUrl(); } }}
              className="flex-1 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)] disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleAnalyzeUrl}
              disabled={analyzing || !urlInput.trim()}
              className="px-3 py-2 rounded bg-[var(--dpf-accent)] text-xs text-white font-semibold disabled:opacity-50"
            >
              {analyzing ? "Analyzing…" : "Analyze"}
            </button>
          </div>
          {analyzeError && (
            <p className="text-[11px] text-red-400">{analyzeError}</p>
          )}
        </div>

        {/* Upload brand document */}
        <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">Upload brand document</p>
          <input
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.svg"
            disabled
            className="w-full bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-xs text-[var(--dpf-text)] opacity-60 cursor-not-allowed file:mr-3 file:rounded file:border-0 file:bg-[var(--dpf-surface-1)] file:text-[var(--dpf-muted)] file:px-2 file:py-1 file:text-xs"
          />
          <p className="text-[11px] text-[var(--dpf-muted)]">
            Accepts PDF, PNG, JPG, JPEG, SVG.
          </p>
        </div>

        {/* Preset grid */}
        <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--dpf-text)] uppercase tracking-widest">Or pick a preset</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {OOTB_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3 text-left hover:border-[var(--dpf-accent)] transition-colors group"
              >
                {/* Accent color bar */}
                <div
                  style={{ background: preset.tokens.dark.palette.accent }}
                  className="h-2 w-full rounded-full mb-2"
                />
                <p className="text-xs font-semibold text-[var(--dpf-text)] group-hover:text-[var(--dpf-accent)] transition-colors">
                  {preset.label}
                </p>
                <p className="text-[10px] text-[var(--dpf-muted)] mt-0.5 truncate">
                  {preset.tokens.dark.typography.fontFamily.split(",")[0]}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Step: preview                                                        */
  /* ------------------------------------------------------------------ */
  if (step === "preview") {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-0.5">Preview your brand</h2>
          <p className="text-xs text-[var(--dpf-muted)]">
            Adjust your company name and accent color, then apply when ready.
          </p>
        </div>

        {corrections.length > 0 && (
          <div
            className="rounded-lg p-3 mb-4 text-sm"
            style={{
              background: "color-mix(in srgb, var(--dpf-accent) 10%, var(--dpf-surface-1))",
              border: "1px solid var(--dpf-border)",
              color: "var(--dpf-text)",
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium">Accessibility adjustments applied</span>
              <button
                onClick={() => setCorrections([])}
                className="text-xs cursor-pointer"
                style={{ color: "var(--dpf-muted)", background: "none", border: "none" }}
              >
                Dismiss
              </button>
            </div>
            <ul className="list-disc pl-4 space-y-0.5">
              {corrections.map((c, i) => (
                <li key={i} className="text-xs" style={{ color: "var(--dpf-muted)" }}>
                  {c.mode} mode: {c.foreground} adjusted from{" "}
                  <code className="font-mono">{c.original}</code> to{" "}
                  <code className="font-mono">{c.corrected}</code>{" "}
                  (was {c.originalRatio}:1, now {c.correctedRatio}:1)
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: editable fields */}
          <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-5 space-y-4">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Company name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
                placeholder="Your Company"
                className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
              />
            </label>

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
                  className="flex-1 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
                />
              </div>
            </label>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-4 py-2 rounded bg-[var(--dpf-accent)] text-white text-xs font-semibold disabled:opacity-60"
              >
                {saving ? "Applying…" : "Looks good — apply"}
              </button>
              <button
                type="button"
                onClick={() => setStep("finetune")}
                className="px-4 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                Let me adjust
              </button>
              <button
                type="button"
                onClick={() => setStep("choose")}
                className="px-4 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              >
                Back
              </button>
            </div>
          </div>

          {/* Right: preview */}
          <div className="flex flex-col gap-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Live preview</p>
            {(() => { const tokens = deriveThemeTokens(accent); return (
              <BrandingDualPreview
                companyName={name}
                logoUrl={logoUrl}
                accentColor={accent}
                fontFamily={font}
                darkTokens={{ bg: tokens.dark.palette.bg, surface1: tokens.dark.palette.surface1, border: tokens.dark.palette.border, muted: tokens.dark.palette.muted, text: tokens.dark.palette.text, accent: tokens.dark.palette.accent }}
                lightTokens={{ bg: tokens.light.palette.bg, surface1: tokens.light.palette.surface1, border: tokens.light.palette.border, muted: tokens.light.palette.muted, text: tokens.light.palette.text, accent: tokens.light.palette.accent }}
              />
            ); })()}
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* Step: finetune                                                       */
  /* ------------------------------------------------------------------ */
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-[var(--dpf-text)] mb-0.5">Fine-tune your brand</h2>
        <p className="text-xs text-[var(--dpf-muted)]">
          For advanced changes, use the AI coworker in the panel.
        </p>
      </div>

      {corrections.length > 0 && (
        <div
          className="rounded-lg p-3 mb-4 text-sm"
          style={{
            background: "color-mix(in srgb, var(--dpf-accent) 10%, var(--dpf-surface-1))",
            border: "1px solid var(--dpf-border)",
            color: "var(--dpf-text)",
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-medium">Accessibility adjustments applied</span>
            <button
              onClick={() => setCorrections([])}
              className="text-xs cursor-pointer"
              style={{ color: "var(--dpf-muted)", background: "none", border: "none" }}
            >
              Dismiss
            </button>
          </div>
          <ul className="list-disc pl-4 space-y-0.5">
            {corrections.map((c, i) => (
              <li key={i} className="text-xs" style={{ color: "var(--dpf-muted)" }}>
                {c.mode} mode: {c.foreground} adjusted from{" "}
                <code className="font-mono">{c.original}</code> to{" "}
                <code className="font-mono">{c.corrected}</code>{" "}
                (was {c.originalRatio}:1, now {c.correctedRatio}:1)
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Full form */}
        <div className="rounded-lg bg-[var(--dpf-surface-1)] border border-[var(--dpf-border)] p-5 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Company name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              placeholder="Your Company"
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Logo URL</span>
            <input
              type="text"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.currentTarget.value)}
              placeholder="https://example.com/logo.png"
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </label>

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
                className="flex-1 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
              />
            </div>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Font family</span>
            <select
              value={font}
              onChange={(e) => setFont(e.currentTarget.value)}
              className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-[var(--dpf-text)] focus:outline-none focus:border-[var(--dpf-accent)]"
            >
              {FONT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[var(--dpf-surface-2)] text-[var(--dpf-text)]">
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-4 py-2 rounded bg-[var(--dpf-accent)] text-white text-xs font-semibold disabled:opacity-60"
            >
              {saving ? "Applying…" : "Apply brand"}
            </button>
            <button
              type="button"
              onClick={() => setStep("preview")}
              className="px-4 py-2 rounded border border-[var(--dpf-border)] text-xs text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
            >
              Back
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex flex-col gap-2">
          <p className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Live preview</p>
          {(() => { const tokens = deriveThemeTokens(accent); return (
            <BrandingDualPreview
              companyName={name}
              logoUrl={logoUrl}
              accentColor={accent}
              fontFamily={font}
              darkTokens={{ bg: tokens.dark.palette.bg, surface1: tokens.dark.palette.surface1, border: tokens.dark.palette.border, muted: tokens.dark.palette.muted, text: tokens.dark.palette.text, accent: tokens.dark.palette.accent }}
              lightTokens={{ bg: tokens.light.palette.bg, surface1: tokens.light.palette.surface1, border: tokens.light.palette.border, muted: tokens.light.palette.muted, text: tokens.light.palette.text, accent: tokens.light.palette.accent }}
            />
          ); })()}
        </div>
      </div>
    </div>
  );
}
