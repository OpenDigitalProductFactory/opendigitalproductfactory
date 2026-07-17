import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { compareDebt, scanSource } from "./check-no-provider-local-connector-lifecycle.mjs";

const kinds = (source, file = "apps/web/lib/integrations/connectors/acme.ts") =>
  scanSource(source, file).map(({ kind }) => kind);

test("rejects every IntegrationCredential delegate mutation outside the store", () => {
  for (const method of ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"]) {
    assert.deepEqual(kinds(`await prisma.integrationCredential.${method}({});`), ["integration-credential-mutation"]);
  }
  assert.deepEqual(kinds("const { integrationCredential: credentials } = prisma; await credentials.upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("const credentials = prisma.integrationCredential; await credentials.deleteMany({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds(`
    const first = prisma.integrationCredential;
    const second = first;
    let third; third = second;
    const { upsert: write } = third;
    await write({});
  `), ["integration-credential-mutation"]);
  assert.deepEqual(kinds('const { ["integrationCredential"]: rows } = prisma; const remove = rows.deleteMany; await remove({});'), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; await (prisma.integrationCredential).upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; await (prisma.integrationCredential as any)!.update({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const rows = (prisma.integrationCredential satisfies unknown); await rows.delete({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const holder = { c: prisma.integrationCredential }; await holder.c.upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const d = prisma.integrationCredential; const holder = { d }; await holder.d.upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const holder = { c: prisma.integrationCredential }; const { c } = holder; const rows = c; await rows.update({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const holder = { c: prisma.integrationCredential }; const { c: rows = fallback } = holder; await rows.deleteMany({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds('export {}; const holder = { c: prisma.integrationCredential }; const { ["c"]: rows } = holder; await rows.create({});'), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const holder = { c: prisma.integrationCredential }; let rows; ({ c: rows } = holder); await rows.upsert({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const { c = prisma.integrationCredential } = source; await c.update({});"), ["integration-credential-mutation"]);
  assert.deepEqual(kinds("export {}; const { c: rows = (prisma.integrationCredential as any)! } = source; await rows.delete({});"), ["integration-credential-mutation"]);
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
  for (const sql of [
    'INSERT INTO "IntegrationCredential" (id) VALUES (1)',
    'WITH stale AS (SELECT 1) UPDATE "IntegrationCredential" SET status = 1 RETURNING id',
    'MERGE INTO "IntegrationCredential" target USING source ON true WHEN MATCHED THEN UPDATE SET status = 1',
    'ALTER TABLE "IntegrationCredential" ADD COLUMN x int',
    'DROP TABLE "IntegrationCredential"',
    'TRUNCATE TABLE "IntegrationCredential"',
  ]) assert.deepEqual(kinds(`await prisma.$queryRawUnsafe(${JSON.stringify(sql)});`), ["integration-credential-raw-sql"]);
  assert.deepEqual(kinds('const statement = Prisma.sql`UPDATE "IntegrationCredential" SET status = ${status}`; const run = prisma.$executeRaw; await run(statement);'), ["integration-credential-raw-sql"]);
  assert.deepEqual(kinds('const { $executeRawUnsafe: run } = prisma; const statement = "DELETE FROM \\"IntegrationCredential\\""; await run(statement);'), ["integration-credential-raw-sql"]);
  assert.deepEqual(kinds('const run = prisma.$executeRawUnsafe; await run(userSuppliedSql);'), ["integration-credential-dynamic-raw-sql"]);
  assert.deepEqual(kinds('const run = (prisma.$executeRawUnsafe as any)!; await run("TRUNCATE IntegrationCredential");'), ["integration-credential-raw-sql"]);
});

test("rejects provider-local connection-state unions", () => {
  assert.deepEqual(kinds('export type SetupState = "unconfigured" | "connected" | "error" | "degraded";'), ["provider-connection-state"]);
  assert.deepEqual(kinds('type BaseConnectionState = "connected" | "error"; type ConnectorState = BaseConnectionState | "unconfigured";'), ["provider-connection-state", "provider-connection-state"]);
  assert.deepEqual(kinds('enum ConnectionState { Ready = "connected", Failed = "error" }'), ["provider-connection-state"]);
  assert.deepEqual(kinds('const CONNECTION_STATES = { ready: "connected", failed: "error" } as const;'), ["provider-connection-state"]);
  assert.deepEqual(kinds('type ButtonState = "connected" | "error";', "apps/web/components/Button.tsx"), []);
  assert.deepEqual(kinds('type ConnectionState = "connected" | "error";', "apps/web/lib/providers/acme/state.ts"), ["provider-connection-state"]);
  assert.deepEqual(kinds('import { connectorRegistry } from "@/lib/integrations/connectors"; type SetupState = "connected" | "error";', "apps/web/app/api/acme/route.ts"), ["provider-connection-state"]);
  assert.deepEqual(kinds('type ConnectorState = { connection: { status: "connected" | "error" } };'), ["provider-connection-state"]);
  assert.deepEqual(kinds('type S = "connected" | "error"; type ConnectorState = { status: S } & { metadata: string };'), ["provider-connection-state"]);
  assert.deepEqual(kinds('enum S { Ready = "connected", Failed = "error" } type ConnectorState = { status: S[] };'), ["provider-connection-state"]);
  assert.deepEqual(kinds('const S = { ready: "connected", failed: "error" } as const; type ConnectorState = { status: (typeof S)[keyof typeof S] };'), ["provider-connection-state"]);
  assert.deepEqual(kinds('type S = "connected" | "error"; interface Base { status: S } interface ConnectorState extends Base {}'), ["provider-connection-state"]);
});

test("rejects refresh orchestration but permits explicitly low-level token primitives", () => {
  const source = `export async function refreshAccessToken() { return singleFlight.run("acme", exchange); }`;
  assert.deepEqual(kinds(source), ["provider-refresh-orchestration"]);
  assert.deepEqual(kinds(source, "apps/web/lib/integrate/acme/token-client.ts"), []);
  for (const name of ["refreshMicrosoftOAuth", "renewAccessToken", "rotateOAuthCredential", "renewAuthSession"]) {
    assert.deepEqual(kinds(`export async function ${name}() {}`), ["provider-refresh-orchestration"]);
  }
  assert.deepEqual(kinds("export async function refreshDashboard() {}"), []);
});

test("counted debt fails on growth and reports shrink as stale improvement", () => {
  const baseline = [{ file: "apps/web/lib/providers/acme.ts", kind: "integration-credential-mutation", count: 1 }];
  assert.deepEqual(compareDebt(baseline, [
    { file: baseline[0].file, kind: baseline[0].kind, line: 1 },
    { file: baseline[0].file, kind: baseline[0].kind, line: 9 },
  ]).growth[0], { ...baseline[0], actual: 2 });
  assert.deepEqual(compareDebt([{ ...baseline[0], count: 2 }], [
    { file: baseline[0].file, kind: baseline[0].kind, line: 40 },
  ]).improvements[0], { ...baseline[0], count: 2, actual: 1 });
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

test("Repo Guard Loop provisions the pinned isolated AST runtime", () => {
  const runtimePackage = JSON.parse(readFileSync("packages/repo-guard-runtime/package.json", "utf8"));
  assert.equal(runtimePackage.devDependencies?.typescript, "6.0.3");
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  const job = workflow.slice(workflow.indexOf("  repo-guard-loop:"), workflow.indexOf("  docs-link-integrity:"));
  assert.match(job, /corepack prepare pnpm@10\.33\.2 --activate/);
  assert.match(job, /pnpm install --frozen-lockfile --ignore-scripts --filter @dpf\/repo-guard-runtime/);
});
