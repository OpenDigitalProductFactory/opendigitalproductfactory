"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { saveActiveThemePreset, saveThemePreset } from "@/lib/actions/branding";
import { registerActiveFormAssist } from "@/lib/agent-form-assist";
import { applyBrandingFormAssistUpdates } from "./branding-form-assist";

type ThemeTokenInput = {
  version: string;
  palette_bg: string;
  palette_surface1: string;
  palette_surface2: string;
  palette_accent: string;
  palette_muted: string;
  palette_border: string;
  typography_fontFamily: string;
  typography_headingFontFamily: string;
  spacing_xs: string;
  spacing_sm: string;
  spacing_md: string;
  spacing_lg: string;
  spacing_xl: string;
  radius_sm: string;
  radius_md: string;
  radius_lg: string;
  radius_xl: string;
  surfaces_page: string;
  surfaces_panel: string;
  surfaces_card: string;
  surfaces_sidebar: string;
  surfaces_modal: string;
  states_idle: string;
  states_hover: string;
  states_active: string;
  states_focus: string;
  states_success: string;
  states_warning: string;
  states_error: string;
  states_info: string;
  shadows_panel: string;
  shadows_card: string;
  shadows_button: string;
};

type BrandPresetForForm = {
  id: string;
  scope: string;
  companyName: string;
  logoUrl: string;
  tokens: ThemeTokenInput;
};

type BrandingConfiguratorProps = {
  builtInPresets: BrandPresetForForm[];
  savedPresets: BrandPresetForForm[];
  activePreset: {
    companyName: string;
    logoUrl: string;
    tokens: ThemeTokenInput;
  };
};

type FieldKind = "color" | "text";

type FieldDef = {
  key: keyof ThemeTokenInput;
  label: string;
  kind: FieldKind;
};

type FieldSection = {
  title: string;
  fields: FieldDef[];
};

const FIELD_SECTIONS: FieldSection[] = [
  {
    title: "Color palette",
    fields: [
      { key: "palette_bg", label: "Page background", kind: "color" },
      { key: "palette_surface1", label: "Surface 1", kind: "color" },
      { key: "palette_surface2", label: "Surface 2", kind: "color" },
      { key: "palette_accent", label: "Accent", kind: "color" },
      { key: "palette_muted", label: "Muted", kind: "color" },
      { key: "palette_border", label: "Border", kind: "color" },
    ],
  },
  {
    title: "Surfaces",
    fields: [
      { key: "surfaces_page", label: "Page", kind: "color" },
      { key: "surfaces_panel", label: "Panel", kind: "color" },
      { key: "surfaces_card", label: "Card", kind: "color" },
      { key: "surfaces_sidebar", label: "Sidebar", kind: "color" },
      { key: "surfaces_modal", label: "Modal", kind: "color" },
    ],
  },
  {
    title: "States",
    fields: [
      { key: "states_idle", label: "Idle", kind: "color" },
      { key: "states_hover", label: "Hover", kind: "color" },
      { key: "states_active", label: "Active", kind: "color" },
      { key: "states_focus", label: "Focus", kind: "color" },
      { key: "states_success", label: "Success", kind: "color" },
      { key: "states_warning", label: "Warning", kind: "color" },
      { key: "states_error", label: "Error", kind: "color" },
      { key: "states_info", label: "Info", kind: "color" },
    ],
  },
  {
    title: "Typography",
    fields: [
      { key: "typography_fontFamily", label: "Body font", kind: "text" },
      { key: "typography_headingFontFamily", label: "Heading font", kind: "text" },
    ],
  },
  {
    title: "Spacing",
    fields: [
      { key: "spacing_xs", label: "XS", kind: "text" },
      { key: "spacing_sm", label: "SM", kind: "text" },
      { key: "spacing_md", label: "MD", kind: "text" },
      { key: "spacing_lg", label: "LG", kind: "text" },
      { key: "spacing_xl", label: "XL", kind: "text" },
    ],
  },
  {
    title: "Radius",
    fields: [
      { key: "radius_sm", label: "Small", kind: "text" },
      { key: "radius_md", label: "Medium", kind: "text" },
      { key: "radius_lg", label: "Large", kind: "text" },
      { key: "radius_xl", label: "XL", kind: "text" },
    ],
  },
  {
    title: "Shadows",
    fields: [
      { key: "shadows_panel", label: "Panel", kind: "text" },
      { key: "shadows_card", label: "Card", kind: "text" },
      { key: "shadows_button", label: "Button", kind: "text" },
    ],
  },
];

function initialsFrom(name: string): string {
  const words = name
    .trim()
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "DPF";
  }

  if (words.length === 1) {
    return (words[0] ?? "").slice(0, 2);
  }

  return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`;
}

export function BrandingConfigurator({
  builtInPresets,
  savedPresets,
  activePreset,
}: BrandingConfiguratorProps) {
  const allPresets = useMemo(() => {
    const built = builtInPresets.map((preset) => ({
      ...preset,
      source: "builtin" as const,
      optionId: `builtin:${preset.scope}`,
    }));

    const saved = savedPresets.map((preset) => ({
      ...preset,
      source: "saved" as const,
      optionId: `saved:${preset.id}`,
    }));

    return [...built, ...saved];
  }, [builtInPresets, savedPresets]);

  const presetById = useMemo(() => {
    const entries = new Map<string, (typeof allPresets)[number]>();
    for (const preset of allPresets) {
      entries.set(preset.optionId, preset);
    }
    return entries;
  }, [allPresets]);

  const [selectedPreset, setSelectedPreset] = useState("custom");
  const [savePresetScope, setSavePresetScope] = useState("custom");
  const [savePresetId, setSavePresetId] = useState("");
  const [companyName, setCompanyName] = useState(activePreset.companyName);
  const [logoUrl, setLogoUrl] = useState(activePreset.logoUrl);
  const [logoPreview, setLogoPreview] = useState(activePreset.logoUrl);
  const [uploadedLogoName, setUploadedLogoName] = useState("");
  const [logoUrlError, setLogoUrlError] = useState("");
  const logoFileInputRef = useRef<HTMLInputElement>(null);
  const [tokens, setTokens] = useState<ThemeTokenInput>(activePreset.tokens);

  const selectPreset = (optionValue: string): void => {
    setSelectedPreset(optionValue);

    if (optionValue === "custom") {
      setSavePresetScope("custom");
      setSavePresetId("");
      setUploadedLogoName("");
      setLogoUrlError("");
      return;
    }

    const preset = presetById.get(optionValue);
    if (!preset) return;

    setCompanyName(preset.companyName);
    setLogoUrl(preset.logoUrl);
    setLogoPreview(preset.logoUrl);
    setTokens(preset.tokens);
    setLogoUrlError("");
    setSavePresetScope(preset.scope);
    setSavePresetId(preset.source === "saved" ? preset.id : "");
    if (logoFileInputRef.current) {
      logoFileInputRef.current.value = "";
    }
    setUploadedLogoName("");
  };

  const updateField = (key: keyof ThemeTokenInput, value: string): void => {
    setTokens((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  const onLogoFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      setUploadedLogoName("");
      setLogoPreview(logoUrl);
      setLogoUrlError("");
      return;
    }

    if (!file.type.startsWith("image/")) {
      event.currentTarget.value = "";
      setUploadedLogoName("");
      setLogoPreview(logoUrl);
      setLogoUrlError("Uploaded file must be an image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      const result = loadEvent.target?.result;
      if (typeof result === "string") {
        setLogoPreview(result);
      }
    };
    reader.readAsDataURL(file);
    setUploadedLogoName(file.name);
    setLogoUrlError("");
  };

  const normalizeLogoUrl = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    if (trimmed.startsWith("/") || trimmed.startsWith("data:")) {
      return trimmed;
    }

    if (trimmed.startsWith("//")) {
      return `https:${trimmed}`;
    }

    if (/^[a-z][a-z\d+\-.]*:\/\//i.test(trimmed)) {
      return trimmed;
    }

    if (trimmed.startsWith("www.") || (trimmed.includes(".") && !trimmed.includes(" "))) {
      return `https://${trimmed}`;
    }

    return trimmed;
  };

  const setLogoSourceFromUrl = (value: string): void => {
    const next = normalizeLogoUrl(value);
    setLogoUrl(next);
    setLogoPreview(next);
    setLogoUrlError("");
    if (logoFileInputRef.current) {
      logoFileInputRef.current.value = "";
    }
    setUploadedLogoName("");
  };

  useEffect(() => {
    return registerActiveFormAssist({
      routeContext: "/admin",
      formId: "branding-configurator",
      formName: "Branding configurator",
      fields: [
        { key: "companyName", label: "Company name", type: "text" },
        { key: "logoUrl", label: "Logo URL", type: "text" },
        { key: "paletteAccent", label: "Accent color", type: "text" },
        { key: "paletteBg", label: "Page background", type: "text", shareCurrentValue: false },
        { key: "typographyFontFamily", label: "Body font", type: "text", shareCurrentValue: false },
      ],
      getValues: () => ({
        companyName,
        logoUrl,
        paletteAccent: tokens.palette_accent,
        paletteBg: tokens.palette_bg,
        typographyFontFamily: tokens.typography_fontFamily,
      }),
      applyFieldUpdates: (updates) => {
        const next = applyBrandingFormAssistUpdates(
          {
            companyName,
            logoUrl,
            tokens,
          },
          updates,
        );
        setCompanyName(next.companyName);
        setLogoSourceFromUrl(next.logoUrl);
        setTokens(next.tokens as ThemeTokenInput);
      },
    });
  }, [companyName, logoUrl, tokens]);

  const renderTokenField = (field: FieldDef): JSX.Element => {
    const value = tokens[field.key];

    if (field.kind === "color") {
      return (
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">{field.label}</span>
          <div className="flex items-center gap-2">
            <input
              className="w-12 h-9 rounded border border-[var(--dpf-border)] bg-transparent p-0.5"
              type="color"
              value={value}
              onChange={(event) => updateField(field.key, event.currentTarget.value)}
            />
            <input
              type="text"
              name={field.key}
              value={value}
              onChange={(event) => updateField(field.key, event.currentTarget.value)}
              required
              className="flex-1 bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
            />
          </div>
        </label>
      );
    }

    return (
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">{field.label}</span>
        <input
          type="text"
          name={field.key}
          value={value}
          onChange={(event) => updateField(field.key, event.currentTarget.value)}
          required
          className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
        />
      </label>
    );
  };

  return (
    <form encType="multipart/form-data">
      <input type="hidden" name="scope" value={savePresetScope} />
      <input type="hidden" name="id" value={savePresetId} />

      <div className="rounded-lg bg-[var(--dpf-surface-1)] p-4">
        <div className="flex flex-wrap items-start gap-4">
          <div className="w-full sm:w-auto">
            <div className="w-28 h-16 rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] grid place-items-center overflow-hidden">
              {logoPreview.trim().length > 0 ? (
                <img
                  src={logoPreview}
                  alt={`${companyName} logo`}
                  className="w-full h-full object-contain p-0"
                  onError={(event) => {
                    const image = event.currentTarget as HTMLImageElement;
                    setLogoPreview("");
                    image.src = "";
                    image.style.display = "none";
                    setLogoUrlError("This URL/path could not be loaded. Try a direct image URL or local /logos path.");
                  }}
                  onLoad={() => setLogoUrlError("")}
                />
              ) : (
                <span className="text-xs font-bold text-[var(--dpf-muted)]">{initialsFrom(companyName)}</span>
              )}
            </div>
          </div>
          <div className="space-y-2 min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-white">Branding preset</h3>
            <p className="text-[11px] text-[var(--dpf-muted)]">
              Choose from an OOTB preset, one you previously saved, or create your own.
            </p>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Preset</span>
                <select
                  value={selectedPreset}
                  onChange={(event) => selectPreset(event.currentTarget.value)}
                  className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white"
                >
                  <option value="custom">Custom</option>
                  <optgroup label="Company presets">
                    {builtInPresets.map((preset) => (
                      <option key={preset.scope} value={`builtin:${preset.scope}`}>
                        {preset.companyName}
                      </option>
                    ))}
                  </optgroup>
                  {savedPresets.length > 0 && (
                    <optgroup label="Saved presets">
                      {savedPresets.map((preset) => (
                        <option key={preset.id} value={`saved:${preset.id}`}>
                          {preset.companyName}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Company name</span>
                <input
                  name="companyName"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.currentTarget.value)}
                  required
                  className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
                />
              </label>

                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Logo URL</span>
                  <input
                    name="logoUrl"
                    value={logoUrl}
                    onChange={(event) => setLogoSourceFromUrl(event.currentTarget.value)}
                    placeholder="https://example.com/logo.png or /logos/brand.svg"
                    className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-sm text-white placeholder:text-[var(--dpf-muted)] focus:outline-none focus:border-[var(--dpf-accent)]"
                  />
                  <span className="text-[10px] text-[var(--dpf-muted)]">
                    Enter an absolute image URL (https) or an app-local path like <span className="text-white">/logos/company.svg</span>.
                  </span>
                  {logoUrlError.length > 0 && <span className="text-[10px] text-red-400">{logoUrlError}</span>}
                </label>

              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-[10px] uppercase tracking-widest text-[var(--dpf-muted)]">Upload logo</span>
                <input
                  ref={logoFileInputRef}
                  type="file"
                  name="logoFile"
                  accept="image/*"
                  onChange={onLogoFileChange}
                  className="bg-[var(--dpf-surface-2)] border border-[var(--dpf-border)] rounded px-3 py-2 text-xs text-white file:mr-3 file:rounded file:border-0 file:bg-[var(--dpf-surface-1)] file:text-[var(--dpf-muted)] file:px-2 file:py-1 file:text-xs"
                />
                {uploadedLogoName.length > 0 && (
                  <span className="text-[10px] text-[var(--dpf-muted)]">Using uploaded file: {uploadedLogoName}</span>
                )}
              </label>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <input type="hidden" name="version" value={tokens.version} />
          {FIELD_SECTIONS.map((section) => (
            <div key={section.title} className="rounded border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)]/70 p-3">
              <p className="text-xs font-semibold text-white uppercase tracking-widest mb-2">{section.title}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {section.fields.map((field) => (
                  <div key={field.key}>{renderTokenField(field)}</div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            formAction={saveActiveThemePreset}
            className="px-3 py-2 rounded bg-[var(--dpf-accent)] text-white text-xs font-semibold"
          >
            Apply active theme
          </button>
          <button
            type="submit"
            formAction={saveThemePreset}
            className="px-3 py-2 rounded border border-[var(--dpf-border)] text-[var(--dpf-muted)] text-xs font-semibold hover:text-white"
          >
            Save this preset
          </button>
        </div>
      </div>
    </form>
  );
}
