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
