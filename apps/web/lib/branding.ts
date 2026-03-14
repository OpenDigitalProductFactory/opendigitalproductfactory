export function resolveBrandingLogoUrl(
  logoUrl: string | null | undefined,
  _companyName: string,
): string {
  if (!logoUrl) return "";

  const trimmed = logoUrl.trim();
  return trimmed.length > 0 ? trimmed : "";
}
