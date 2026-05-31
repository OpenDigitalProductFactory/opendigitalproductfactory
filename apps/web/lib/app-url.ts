// Resolve the install's public base URL for links embedded in outbound emails.
//
// Prefers explicit configuration (NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL).
// In non-production it falls back to localhost (correct for local dev). In
// production with nothing configured it returns null — callers must NOT emit a
// knowingly-broken "http://localhost:3000" link in a real customer email.
export function resolveAppBaseUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}
