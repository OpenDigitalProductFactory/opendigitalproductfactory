import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./reassessment-capability-probe.mjs", import.meta.url));
const digest = value => createHash("sha256").update(value).digest("hex");
const owners = ["transport", "approval", "worker", "writer"];
const sourceSha = "a".repeat(40);
const sourceContentHash = "b".repeat(64);
const leaf = `export const REASSESSMENT_OWNERS = ${JSON.stringify(owners)};
export const REASSESSMENT_PROTOCOL_VERSION = 2;
export const REASSESSMENT_OWNER_VERSIONS = ${JSON.stringify(Object.fromEntries(owners.map(owner => [owner, 2])))};
export const REASSESSMENT_OWNER_PATHS = ${JSON.stringify(Object.fromEntries(owners.map(owner => [owner, `${owner}.ts`])))};
export function assertReassessmentOwnerSupport(owner, version) { if (!REASSESSMENT_OWNERS.includes(owner) || version !== 2) throw new Error("unsupported"); }
`;

async function fixture(t, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "dpf-reassessment-probe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = { ".dpf-image-version": sourceSha, ".dpf-source-content-hash": sourceContentHash,
    "apps/web-src/lib/shared/reassessment-owner-versions.ts": leaf,
    ...Object.fromEntries(owners.map(owner => [`apps/web-src/lib/${owner}.ts`, `assertReassessmentOwnerSupport("${owner}", 2);\nexport const ${owner} = true;\n`])), ...overrides };
  for (const [path, value] of Object.entries(files)) {
    if (value === null) continue;
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), value);
  }
  return { root, files };
}

test("reports exact immutable packaged identity and every actual owner byte hash", async t => {
  const { inspectReassessmentCapability } = await import("./reassessment-capability-probe.mjs");
  const f = await fixture(t);
  assert.deepEqual(await inspectReassessmentCapability({ root: f.root }), { schemaVersion: 1, sourceSha, sourceContentHash,
    contractSha256: digest(leaf), owners: Object.fromEntries(owners.map(owner => [owner, { version: 2, sourceSha256: digest(f.files[`apps/web-src/lib/${owner}.ts`]) }])) });
});

test("the real pure TypeScript contract is executable without loading any owner", async t => {
  const { inspectReassessmentCapability } = await import("./reassessment-capability-probe.mjs");
  const contractUrl = new URL("../apps/web/lib/shared/reassessment-owner-versions.ts", import.meta.url);
  const contract = await import(contractUrl.href);
  const contractBytes = await readFile(contractUrl);
  const f = await fixture(t, { "apps/web-src/lib/shared/reassessment-owner-versions.ts": contractBytes,
    ...Object.fromEntries(contract.REASSESSMENT_OWNERS.map(owner => [`apps/web-src/lib/${contract.REASSESSMENT_OWNER_PATHS[owner]}`, `assertReassessmentOwnerSupport("${owner}", 2);\nthrow new Error("not imported");`])) });
  const result = await inspectReassessmentCapability({ root: f.root });
  assert.equal(result.contractSha256, digest(contractBytes));
  assert.deepEqual(contract.validateReassessmentCapabilityInfo(result), result);
});

test("the actual transport, approval, worker and writer sources declare the packaged protocol", async t => {
  const { inspectReassessmentCapability } = await import("./reassessment-capability-probe.mjs");
  const contractUrl = new URL("../apps/web/lib/shared/reassessment-owner-versions.ts", import.meta.url);
  const contract = await import(contractUrl.href), overrides = {
    "apps/web-src/lib/shared/reassessment-owner-versions.ts": await readFile(contractUrl),
  };
  for (const owner of contract.REASSESSMENT_OWNERS) {
    overrides[`apps/web-src/lib/${contract.REASSESSMENT_OWNER_PATHS[owner]}`] = await readFile(
      new URL(`../apps/web/lib/${contract.REASSESSMENT_OWNER_PATHS[owner]}`, import.meta.url));
  }
  const f = await fixture(t, overrides), result = await inspectReassessmentCapability({ root: f.root });
  for (const owner of contract.REASSESSMENT_OWNERS) {
    assert.equal(result.owners[owner].sourceSha256, digest(overrides[`apps/web-src/lib/${contract.REASSESSMENT_OWNER_PATHS[owner]}`]));
  }
});

for (const [name, overrides] of [
  ["missing source identity", { ".dpf-image-version": null }],
  ["environment-style source identity", { ".dpf-image-version": "current-dirty" }],
  ["missing source content identity", { ".dpf-source-content-hash": null }],
  ["malformed source content identity", { ".dpf-source-content-hash": "sha256:" + sourceContentHash }],
  ["missing owner", { "apps/web-src/lib/worker.ts": null }],
  ["missing acknowledgment", { "apps/web-src/lib/worker.ts": "export const worker = true;" }],
  ["old owner", { "apps/web-src/lib/worker.ts": 'assertReassessmentOwnerSupport("worker", 1);' }],
  ["wrong owner", { "apps/web-src/lib/worker.ts": 'assertReassessmentOwnerSupport("writer", 2);' }],
  ["commented acknowledgment", { "apps/web-src/lib/worker.ts": '/*\nassertReassessmentOwnerSupport("worker", 2);\n*/' }],
  ["string acknowledgment", { "apps/web-src/lib/worker.ts": '`\nassertReassessmentOwnerSupport("worker", 2);\n`;' }],
  ["nonliteral acknowledgment", { "apps/web-src/lib/worker.ts": 'assertReassessmentOwnerSupport("worker", REASSESSMENT_PROTOCOL_VERSION);' }],
  ["conflicting acknowledgment", { "apps/web-src/lib/worker.ts": 'assertReassessmentOwnerSupport("worker", 2);\nassertReassessmentOwnerSupport("worker", 1);' }],
  ["old contract", { "apps/web-src/lib/shared/reassessment-owner-versions.ts": leaf.replace("PROTOCOL_VERSION = 2", "PROTOCOL_VERSION = 1") }],
  ["old declared owner", { "apps/web-src/lib/shared/reassessment-owner-versions.ts": leaf.replace('"worker":2', '"worker":1') }],
  ["incomplete owner contract", { "apps/web-src/lib/shared/reassessment-owner-versions.ts": leaf.replace(JSON.stringify(owners), '["transport","approval","worker"]') }],
  ["escaping owner path", { "apps/web-src/lib/shared/reassessment-owner-versions.ts": leaf.replace('"worker.ts"', '"../worker.ts"') }],
]) test(`refuses ${name} without producing compatibility evidence`, async t => {
  const { inspectReassessmentCapability } = await import("./reassessment-capability-probe.mjs");
  const f = await fixture(t, overrides);
  await assert.rejects(inspectReassessmentCapability({ root: f.root }), /reassessment_probe_/);
});

test("hashes the complete owner bytes and performs no import of owner modules", async t => {
  const { inspectReassessmentCapability } = await import("./reassessment-capability-probe.mjs");
  const code = 'assertReassessmentOwnerSupport("worker", 2);\nthrow new Error("must never execute owner code");\n' + "x".repeat(40_000);
  const f = await fixture(t, { "apps/web-src/lib/worker.ts": code });
  const reads = [];
  const result = await inspectReassessmentCapability({ root: f.root, readFile: async (...args) => { reads.push(args[0]); return readFile(...args); } });
  assert.equal(result.owners.worker.sourceSha256, digest(code));
  assert.ok(reads.every(path => path.startsWith(f.root + "/")));
  assert.equal(reads.length, 7);
});

test("CLI rejects all arguments before consulting a root or environment override", () => {
  const result = spawnSync(process.execPath, [script, "--root", "/tmp/forged"], { encoding: "utf8", env: { ...process.env, DPF_REASSESSMENT_PROBE_ROOT: "/tmp/forged", DEPLOYED_SHA: sourceSha } });
  assert.equal(result.status, 64, result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /reassessment_probe_arguments_invalid/);
});
