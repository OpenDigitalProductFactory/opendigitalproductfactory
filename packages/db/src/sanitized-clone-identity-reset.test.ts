import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import {
  CLONE_IDENTITY_CONFIG_KEYS,
  resetCloneInstallationIdentity,
} from "./sanitized-clone-identity-reset";

// BI-8F9A3499: the contributor preview is filled from production by the
// sanitized clone. PlatformConfig is `internal` and FederationLink falls back to
// `confidential`, so before this reset a preview carried production's
// installation id, signing key, operating intent and trusted federation links.
describe("resetCloneInstallationIdentity", () => {
  function recordingClient() {
    const statements: string[] = [];
    const client = {
      $executeRawUnsafe: vi.fn(async (sql: string) => {
        statements.push(sql);
        return 0;
      }),
    };
    return { client, statements };
  }

  it("removes production's identity, operating intent and federation trust from the clone", async () => {
    const { client, statements } = recordingClient();

    await resetCloneInstallationIdentity(client);

    const configDelete = statements.find((sql) => sql.includes('"PlatformConfig"'));
    expect(configDelete).toBeDefined();
    for (const key of [
      "federation.identity",
      "federation.membership.v1",
      "installation.operating-intent.v1",
      "installation.environment-class.v1",
      "installation.estate-identity.v1",
      "federation.work-sync.health.v1",
    ]) {
      expect(CLONE_IDENTITY_CONFIG_KEYS).toContain(key);
      expect(configDelete).toContain(`'${key}'`);
    }
    expect(statements).toContain('DELETE FROM "FederationLink"');
    expect(statements).toContain('DELETE FROM "FederatedRecordMirror"');
    expect(statements.some((sql) => sql.includes('"WorkItem"') && sql.includes("federation-demand-delivery"))).toBe(true);
  });

  it("removes outbox rows and their jobs before the links they reference", async () => {
    const { client, statements } = recordingClient();

    await resetCloneInstallationIdentity(client);

    const linkAt = statements.indexOf('DELETE FROM "FederationLink"');
    expect(statements.indexOf('DELETE FROM "FederatedRecordMirror"')).toBeLessThan(linkAt);
    expect(statements.findIndex((sql) => sql.includes('"WorkItem"'))).toBeLessThan(linkAt);
  });

  it("is applied by the clone after every table is copied", () => {
    const source = readFileSync(new URL("./sanitized-clone.ts", import.meta.url), "utf8");
    const resetAt = source.indexOf("await resetCloneInstallationIdentity(dev)");
    expect(resetAt).toBeGreaterThan(source.indexOf("for (const { tablename } of tables)"));
    expect(resetAt).toBeLessThan(source.indexOf("await provisionContributorPreviewAdmin(dev"));
  });
});
