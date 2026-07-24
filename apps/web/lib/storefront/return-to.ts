// apps/web/lib/storefront/return-to.ts
//
// `returnTo` is user-suppliable (a query string param threaded through the
// customer sign-in/sign-up forms so a Restaurant guest lands back on the
// booking/inquiry/order page they came from, not an unconditional `/portal`).
// Anything user-suppliable that feeds a redirect is an open-redirect vector,
// so this is the single choke point that decides whether a candidate
// `returnTo` is safe to hand to `router.push` (BI-CC4BEB5F).
//
// Only a same-origin, RELATIVE path scoped to this storefront (`/s/{orgSlug}`
// or `/s/{orgSlug}/...`) is accepted. Absolute URLs, protocol-relative `//`
// paths, paths outside this storefront's own scope, and the auth pages
// themselves (which would loop) all fall back to null so the caller uses its
// own safe default (the storefront home).

/**
 * Validate a candidate `returnTo` destination against the storefront it was
 * captured from. Returns the original string when it is safe to redirect to,
 * or `null` when it must be rejected (caller then falls back to a known-safe
 * default, e.g. `/s/{orgSlug}`).
 */
export function sanitizeStorefrontReturnTo(
  returnTo: string | null | undefined,
  orgSlug: string | null | undefined,
): string | null {
  if (!returnTo || !orgSlug) return null;

  // Must be a relative, single-slash path. Reject absolute URLs
  // ("https://evil.example"), protocol-relative URLs ("//evil.example", which
  // browsers resolve as same-scheme absolute), and backslash variants some
  // browsers still normalize into a protocol-relative URL.
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.includes("\\")) {
    return null;
  }

  // Reject anything that decodes to a scheme/host trick (e.g. "/\t/evil.com",
  // "/%09/evil.com") by requiring the decoded form to still be a plain path.
  let decoded: string;
  try {
    decoded = decodeURIComponent(returnTo);
  } catch {
    return null;
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\")) {
    return null;
  }

  // Must stay within THIS storefront's own scope — never another org's
  // storefront, and never a platform/workspace route.
  const scopePrefix = `/s/${orgSlug}`;
  if (returnTo !== scopePrefix && !returnTo.startsWith(`${scopePrefix}/`)) {
    return null;
  }

  // Never send a customer back into the auth pages themselves — that's a
  // redirect loop, not a journey to resume.
  const authRoutes = [`${scopePrefix}/sign-in`, `${scopePrefix}/sign-up`];
  const path = returnTo.split(/[?#]/)[0];
  if (authRoutes.includes(path)) {
    return null;
  }

  return returnTo;
}
