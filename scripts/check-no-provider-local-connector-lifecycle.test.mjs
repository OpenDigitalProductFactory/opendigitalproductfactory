import assert from "node:assert/strict";
import test from "node:test";

import { scanSource } from "./check-no-provider-local-connector-lifecycle.mjs";

const kinds = (source, file = "apps/web/lib/integrations/connectors/acme.ts") =>
  scanSource(source, file).map(({ kind }) => kind);

test("rejects every IntegrationCredential delegate mutation outside the store", () => {
  for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
    assert.deepEqual(kinds(`await prisma.integrationCredential.${method}({});`), ["integration-credential-mutation"]);
  }
  assert.deepEqual(kinds("const { integrationCredential: credentials } = prisma; await credentials.upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("const credentials = prisma.integrationCredential; await credentials.deleteMany({});"), ["integration-credential-mutation"]);
});

test("does not exempt connector adapters, but exempts the canonical credential store", () => {
  const source = `await tx.integrationCredential.upsert({});`;
  assert.deepEqual(kinds(source), ["integration-credential-mutation"]);
  assert.deepEqual(kinds(source, "apps/web/lib/integrations/kernel/credential-store.ts"), []);
});

test("rejects raw SQL IntegrationCredential mutations", () => {
  assert.deepEqual(kinds('await prisma.$executeRaw`UPDATE "IntegrationCredential" SET "status" = ${status}`;'), ["integration-credential-raw-sql"]);
  assert.deepEqual(kinds('await prisma.$executeRaw`DELETE FROM "public"."IntegrationCredential" WHERE id = ${id}`;'), ["integration-credential-raw-sql"]);
  assert.deepEqual(kinds('await prisma.$queryRaw`SELECT * FROM "IntegrationCredential"`;'), []);
});

test("rejects provider-local connection-state unions", () => {
  assert.deepEqual(kinds('export type SetupState = "unconfigured" | "connected" | "error" | "degraded";'), ["provider-connection-state"]);
});

test("rejects refresh orchestration but permits explicitly low-level token primitives", () => {
  const source = `export async function refreshAccessToken() { return singleFlight.run("acme", exchange); }`;
  assert.deepEqual(kinds(source), ["provider-refresh-orchestration"]);
  assert.deepEqual(kinds(source, "apps/web/lib/integrate/acme/token-client.ts"), []);
});

test("ignores comments, strings, and test fixtures", () => {
  const source = `
    // prisma.integrationCredential.upsert({})
    const example = 'type State = "connected" | "error"';
    const sql = 'UPDATE "IntegrationCredential" SET status = 1';
  `;
  assert.deepEqual(kinds(source), []);
  assert.deepEqual(kinds("prisma.integrationCredential.upsert({})", "apps/web/lib/acme.test.ts"), []);
  assert.deepEqual(kinds("prisma.integrationCredential.upsert({})", "apps/web/lib/acme.generated.ts"), []);
});
