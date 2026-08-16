// docker-compose.release.yml states its own contract at the top of the file:
//
//   "every installed-runtime service resolves to a versioned multi-arch GHCR image.
//    The base docker-compose.yml's `build:` entries are reset to null so the runtime
//    never silently builds when a release tag is meant to be pulled."
//
// `postgres` violated that for the entire life of the consumer install path: it is
// BUILT in the base compose (baked pgvector + inngest init, deliberately no host
// bind mount) and had no override in the release overlay, and dpf-postgres was not
// in the publish matrix at all. A "Ready to go" install therefore reached
//
//   Image dpf-postgres  Building
//   resolve : GetFileAttributesEx D:\DPF\docker: The system cannot find the file specified.
//
// because a no-checkout install has no ./docker context to build from. The install
// had no database and could never become healthy.
//
// This asserts the contract mechanically, so the next service added with a `build:`
// cannot quietly reintroduce it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = readFileSync(join(repoRoot, "docker-compose.yml"), "utf8");
const release = readFileSync(join(repoRoot, "docker-compose.release.yml"), "utf8");
const publishWorkflow = readFileSync(join(repoRoot, ".github/workflows/publish-image.yml"), "utf8");

/**
 * Services excluded from the release overlay by documented classification —
 * developer/test-only, never published to GHCR. Keep this list tiny and justified;
 * it is the only sanctioned way to skip a pin.
 */
const DEV_ONLY_SERVICES = Object.freeze(["integration-test-harness", "dev-init", "dev-portal"]);

/** Service names that declare a `build:` in a compose file. */
function servicesWithBuild(source) {
  const lines = source.split(/\r?\n/);
  let inServices = false;
  let current = null;
  const found = new Set();
  for (const line of lines) {
    if (/^services:/.test(line)) { inServices = true; continue; }
    if (!inServices) continue;
    if (/^[a-zA-Z]/.test(line)) { inServices = false; continue; } // left the services block
    const svc = line.match(/^ {2}([a-zA-Z0-9._-]+):\s*$/);
    if (svc) { current = svc[1]; continue; }
    if (current && /^ {4}build:/.test(line)) found.add(current);
  }
  return [...found];
}

/** Service names given an `image:` in the release overlay. */
function servicesWithReleaseImage(source) {
  const lines = source.split(/\r?\n/);
  let current = null;
  const found = new Set();
  for (const line of lines) {
    const svc = line.match(/^ {2}([a-zA-Z0-9._-]+):\s*$/);
    if (svc) { current = svc[1]; continue; }
    if (current && /^ {4}image:\s*\S/.test(line)) found.add(current);
  }
  return [...found];
}

const built = servicesWithBuild(base);
const pinned = servicesWithReleaseImage(release);

test("every built service is pinned to a published image in the release overlay", () => {
  const needPin = built.filter((s) => !DEV_ONLY_SERVICES.includes(s));
  const unpinned = needPin.filter((s) => !pinned.includes(s));
  assert.deepEqual(
    unpinned,
    [],
    "these build from source in the base compose but have no release image, so a " +
      "consumer install (no checkout) cannot start them: " + unpinned.join(", "),
  );
});

test("every pinned service also resets its build so the runtime cannot silently build", () => {
  for (const svc of pinned) {
    const block = release.slice(release.indexOf(`\n  ${svc}:`));
    const nextSvc = block.slice(1).search(/\n {2}[a-zA-Z0-9._-]+:\s*$/m);
    const scoped = nextSvc > 0 ? block.slice(0, nextSvc + 1) : block;
    if (!servicesWithBuild(base).includes(svc)) continue; // nothing to reset
    assert.match(
      scoped,
      /build:\s*!reset null/,
      `${svc} is pinned to an image but does not reset its build: — the runtime could still build it`,
    );
  }
});

test("postgres specifically is pinned — the exact consumer-install outage", () => {
  assert.ok(built.includes("postgres"), "postgres should still be built in the base compose");
  assert.ok(
    pinned.includes("postgres"),
    "postgres must be pinned in the release overlay or the consumer install has no database",
  );
  assert.match(release, /dpf-postgres:\$\{DPF_IMAGE_TAG:-latest\}/);
});

/** Image names in the build matrix (`- name: dpf-x`) and the merge matrix (`- dpf-x`). */
function publishMatrices(source) {
  const builds = new Set([...source.matchAll(/^\s*- name:\s*(dpf-[a-z0-9-]+)\s*$/gm)].map((m) => m[1]));
  const mergeBlock = source.slice(source.indexOf("\n  merge:"));
  const merges = new Set([...mergeBlock.matchAll(/^\s*-\s*(dpf-[a-z0-9-]+)\s*$/gm)].map((m) => m[1]));
  return { builds, merges };
}

test("every release-pinned dpf image is actually BUILT by the workflow", () => {
  const { builds } = publishMatrices(publishWorkflow);
  const imageNames = [...new Set([...release.matchAll(/\/(dpf-[a-z0-9-]+):\$\{DPF_IMAGE_TAG/g)].map((m) => m[1]))];
  const missing = imageNames.filter((n) => !builds.has(n));
  assert.deepEqual(
    missing,
    [],
    "the release overlay pins images that publish-image.yml never builds, so the pull " +
      "will 404: " + missing.join(", "),
  );
});

test("every built image is also MERGED into a tag manifest", () => {
  // Building without merging pushes per-arch images BY DIGEST ONLY -- no human tag
  // is ever created, so `docker compose pull` fails with:
  //     postgres Error manifest unknown
  // That shipped once: dpf-postgres was added to the build matrix but not the merge
  // matrix, so both arches built green and the tag still did not exist.
  const { builds, merges } = publishMatrices(publishWorkflow);
  const unmerged = [...builds].filter((n) => !merges.has(n));
  assert.deepEqual(
    unmerged,
    [],
    "these are built per-arch but never assembled into a tag manifest, so pulling the " +
      "tag returns 'manifest unknown': " + unmerged.join(", "),
  );
});
