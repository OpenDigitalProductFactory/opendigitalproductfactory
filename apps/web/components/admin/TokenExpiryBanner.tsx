import { prisma } from "@dpf/db";

/**
 * Admin banner surfaced on Platform Development when the install's stored
 * GitHub token is approaching expiry (Tier 2 fine-grained PAT). Driven by
 * `PlatformNotification` rows written by the daily `tokenExpiryMonitor`
 * Inngest function.
 *
 * Severity tiers
 *   - `info`  → not shown here (too quiet for a banner; lives in admin notifications list)
 *   - `warning`  → yellow banner
 *   - `critical` → red banner
 *   - `expired`  → red banner
 *
 * Action links scroll to the existing remediation surfaces — Reconnect via
 * OAuth (ConnectGitHubCard) or Update token (AdvancedTokenPaste) — both
 * rendered by `PlatformDevelopmentForm`.
 *
 * Phase 6 of the 2026-04-24 GitHub auth 2FA readiness spec.
 */
export default async function TokenExpiryBanner() {
  const notification = await prisma.platformNotification.findFirst({
    where: {
      category: "token-expiry",
      resolvedAt: null,
      severity: { in: ["warning", "critical", "expired"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!notification) return null;

  const isRed =
    notification.severity === "critical" || notification.severity === "expired";
  const colorClass = isRed
    ? "border-red-500 bg-red-50 text-red-900"
    : "border-yellow-500 bg-yellow-50 text-yellow-900";

  return (
    <div
      role="alert"
      className={`mb-4 rounded-md border ${colorClass} p-4 text-sm`}
    >
      <p>{notification.message}</p>
      <div className="mt-2 flex gap-3">
        <a href="#connect-github" className="underline">
          Reconnect GitHub
        </a>
        <a href="#advanced-token" className="underline">
          Update token
        </a>
      </div>
    </div>
  );
}
