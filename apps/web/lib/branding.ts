export function normalizeLogoUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";
  return trimmed;
}

export function resolveBrandingLogoUrl(
  logoUrl: string | null | undefined,
  _companyName: string,
): string {
  return normalizeLogoUrl(logoUrl);
}

type TokenRecord = Record<string, unknown>;

function isRecord(v: unknown): v is TokenRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function safeString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function buildBrandingStyleTag(tokens: unknown): string {
  if (!isRecord(tokens)) return "";

  const palette = isRecord(tokens.palette) ? tokens.palette : {};
  const typography = isRecord(tokens.typography) ? tokens.typography : {};

  const pairs: [string, string | null][] = [
    ["--dpf-bg", safeString(palette.bg)],
    ["--dpf-surface-1", safeString(palette.surface1)],
    ["--dpf-surface-2", safeString(palette.surface2)],
    ["--dpf-accent", safeString(palette.accent)],
    ["--dpf-muted", safeString(palette.muted)],
    ["--dpf-border", safeString(palette.border)],
    ["--dpf-font-body", safeString(typography.fontFamily)],
    ["--dpf-font-heading", safeString(typography.headingFontFamily)],
  ];

  const declarations = pairs
    .filter((p): p is [string, string] => p[1] !== null)
    .map(([prop, val]) => `  ${prop}: ${val};`)
    .join("\n");

  if (declarations.length === 0) return "";

  return `:root {\n${declarations}\n}`;
}
