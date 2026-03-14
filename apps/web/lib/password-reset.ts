const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;

export function createPasswordResetToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export async function hashPasswordResetToken(rawToken: string): Promise<string> {
  const data = new TextEncoder().encode(rawToken);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function buildPasswordResetExpiry(now = new Date()): Date {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MS);
}

export function isPasswordResetExpired(expiresAt: Date, now = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function resolvePasswordResetDeliveryMode(input: {
  emailEnabled: boolean;
}): "email" | "manual" {
  return input.emailEnabled ? "email" : "manual";
}
