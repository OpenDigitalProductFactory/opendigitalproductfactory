// Resolve the install's public base URL for links embedded in outbound emails
// and for federation enrollment (advertising a reachable Authority URL to a peer).
//
// Prefers explicit build-time configuration (NEXT_PUBLIC_BASE_URL /
// NEXT_PUBLIC_APP_URL), then the runtime, compose-plumbed PUBLIC_URL — the
// install's public base URL, settable via .env. PUBLIC_URL is what a production
// HTTP/LAN install (no NEXT_PUBLIC_* baked in) uses to resolve its own URL; without
// this fallback resolveAppBaseUrl returned null in production and federation
// invitation/enroll failed with "base URL is not configured" (BI-9D2E4F17).
// In non-production it falls back to localhost (correct for local dev). In
// production with nothing configured it returns null — callers must NOT emit a
// knowingly-broken "http://localhost:3000" link in a real customer email.
export function resolveAppBaseUrl(): string | null {
  const configured =
    process.env.NEXT_PUBLIC_BASE_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || process.env.PUBLIC_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";
  return null;
}
