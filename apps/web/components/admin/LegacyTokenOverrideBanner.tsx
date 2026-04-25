import { prisma } from "@dpf/db";

/**
 * Admin banner surfaced on Platform Development when the deprecated
 * `HIVE_CONTRIBUTION_TOKEN` env var is overriding a credential that was
 * configured through the UI. Without this, operators silently lose their
 * UI-configured token to an env-var shadow and have no feedback.
 *
 * Renders nothing when:
 *   - the env var is not set, OR
 *   - no active hive-contribution credential exists in the DB.
 */
export default async function LegacyTokenOverrideBanner() {
  const hasEnvToken = !!process.env.HIVE_CONTRIBUTION_TOKEN;
  if (!hasEnvToken) return null;

  const dbCred = await prisma.credentialEntry.findUnique({
    where: { providerId: "hive-contribution" },
    select: { secretRef: true, status: true },
  });
  const hasDbToken = !!(dbCred?.status === "active" && dbCred.secretRef);
  if (!hasDbToken) return null;

  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-yellow-500 bg-yellow-50 p-4 text-sm text-yellow-900"
    >
      <strong>Legacy env-var token is overriding your configured credential.</strong>{" "}
      <code>HIVE_CONTRIBUTION_TOKEN</code> is set in this install&apos;s environment
      and takes priority over the token you configured here. Unset the env var to
      use your UI-configured credential.
    </div>
  );
}
