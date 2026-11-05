// BI-4F89896B: the Build Studio guard gauntlet runs scripts/pregate-preflight.mjs
// inside the sandbox (apps/web/lib/build/sandbox/guard-gauntlet.ts), so every
// binary a guard command execs must be in the sandbox image. A missing one is
// not a skipped guard: the guard fails, the build is sent to repair for a
// failure it did not cause, and the next gauntlet fails the same way.
//
// Observed 2026-11-05 on FB-38E92712: Release Asset Contract failed on
// `spawnSync openssl ENOENT` (scripts/installer/edge-client-certificate.test.mjs).
//
// Conformance over repository state, patterned on
// sandbox-auth-secret-isolation-contract.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const read = (path) => readFile(join(root, path), "utf8");

/** Binaries a declared guard command execs, with the guard test that needs it. */
const GUARD_BINARIES = [
  { binary: "openssl", neededBy: "scripts/installer/edge-client-certificate.test.mjs" },
];

/** Every package the sandbox image installs with apk. */
function apkPackages(dockerfile) {
  const packages = new Set();
  for (const match of dockerfile.matchAll(/apk add\s+((?:[^\n\\]|\\\n)+)/g)) {
    for (const word of match[1].replace(/\\\n/g, " ").split(/\s+/)) {
      if (word && !word.startsWith("-")) packages.add(word);
    }
  }
  return packages;
}

test("the sandbox image installs every binary a guard command execs", async () => {
  const packages = apkPackages(await read("Dockerfile.sandbox"));
  for (const { binary, neededBy } of GUARD_BINARIES) {
    const source = await read(neededBy);
    assert.match(source, new RegExp(`['"]${binary}['"]`), `${neededBy} no longer execs ${binary}; update GUARD_BINARIES`);
    assert.ok(packages.has(binary), `Dockerfile.sandbox does not install ${binary}, which ${neededBy} execs`);
  }
});
