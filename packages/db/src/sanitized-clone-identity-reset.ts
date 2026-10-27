/**
 * A sanitized clone copies production's data, never production's identity
 * (BI-8F9A3499).
 *
 * The clone copies `internal` tables verbatim and only obfuscates `confidential`
 * ones, and an installation's identity lives in exactly those places:
 * `PlatformConfig` holds its installation id, signing key, operating intent and
 * environment declaration, and `FederationLink` (unclassified, so treated as
 * `confidential`) keeps its link tokens and trust state through obfuscation.
 * Left in place, the contributor preview presents itself to every federation
 * peer as production and tells every agent it is a production install.
 *
 * Removal runs after the copy, with foreign-key actions live, so rows that
 * reference a link are nulled or cascaded by the schema's own rules. The
 * preview then mints a fresh identity on first use and starts with no links.
 */
export const CLONE_IDENTITY_CONFIG_KEYS = [
  "federation.identity",
  "federation.membership.v1",
  "federation.membership.relay.v1",
  "federation.reachedat.v1",
  "federation.work-sync.health.v1",
  "installation.operating-intent.v1",
  "installation.environment-class.v1",
  "installation.estate-identity.v1",
] as const;

type ResetClient = { $executeRawUnsafe(sql: string): Promise<unknown> };

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function resetCloneInstallationIdentity(client: ResetClient): Promise<void> {
  // The outbox and its delivery jobs belong to production's links: drop them
  // before the links so no job is left pointing at a link that no longer exists.
  await client.$executeRawUnsafe('DELETE FROM "WorkItem" WHERE "sourceType" = \'federation-demand-delivery\'');
  await client.$executeRawUnsafe('DELETE FROM "FederatedRecordMirror"');
  await client.$executeRawUnsafe('DELETE FROM "FederationLink"');
  await client.$executeRawUnsafe(
    `DELETE FROM "PlatformConfig" WHERE "key" IN (${CLONE_IDENTITY_CONFIG_KEYS.map(sqlLiteral).join(", ")})`,
  );
  console.log("[sanitized-clone] Removed production's installation identity and federation links from the clone");
}
