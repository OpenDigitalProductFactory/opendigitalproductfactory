// Pure classification of subscription OAuth renewal errors (BI-A53C594E).
// Kept free of prisma so routing and the background renewal can share it.

/**
 * True only for renewal errors that mean a person must sign in again: a
 * confirmed invalid_grant, or no refresh token to renew with. Every other
 * renewal failure (HTTP 5xx/429, a bare 401/403, a network error) is retryable.
 */
export function isConfirmedReauthenticationRequired(error: string): boolean {
  return /re-authentication required|must re-authenticate|sign in again/i.test(error);
}
