import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  allowedForImporter,
  findUnlockedPackages,
  listInstalledPackages,
} from "./assert-deploy-matches-lockfile.mjs";

// A two-importer workspace: services/svc depends on a workspace package and on
// net-snmp, whose closure pulls asn1-ber. vitest is a devDependency and must not
// count as shippable.
const LOCKFILE = `lockfileVersion: '9.0'

importers:

  .: {}

  packages/validators:
    dependencies:
      zod:
        specifier: 'catalog:'
        version: 4.6.5

  services/svc:
    dependencies:
      '@dpf/validators':
        specifier: workspace:*
        version: link:../../packages/validators
      net-snmp:
        specifier: 'catalog:'
        version: 3.26.3
    devDependencies:
      vitest:
        specifier: 'catalog:'
        version: 4.1.11

packages:

  asn1-ber@1.2.2:
    resolution: {integrity: sha512-x}

  net-snmp@3.26.3:
    resolution: {integrity: sha512-x}

  vitest@4.1.11:
    resolution: {integrity: sha512-x}

  zod@4.6.5:
    resolution: {integrity: sha512-x}

snapshots:

  asn1-ber@1.2.2: {}

  net-snmp@3.26.3:
    dependencies:
      asn1-ber: 1.2.2

  vitest@4.1.11: {}

  zod@4.6.5: {}
`;

function write(root, rel, content) {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

function pkg(dir, name, version) {
  write(dir, "package.json", JSON.stringify({ name, version }));
}

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "deploy-lockfile-"));
  write(root, "pnpm-lock.yaml", LOCKFILE);
  pkg(join(root, "packages/validators"), "@dpf/validators", "0.0.1");
  pkg(join(root, "services/svc"), "svc", "0.1.0");
  return root;
}

test("the allowed set is the importer's production closure, not its devDependencies", () => {
  const root = workspace();
  try {
    const { external, workspace: ws } = allowedForImporter(root, "services/svc");
    assert.deepEqual([...external].sort(), ["asn1-ber@1.2.2", "net-snmp@3.26.3", "zod@4.6.5"]);
    assert.equal(ws.get("@dpf/validators"), "0.0.1");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an unknown importer is an error, not an empty pass", () => {
  const root = workspace();
  try {
    assert.throws(() => allowedForImporter(root, "services/missing"), /not in/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reads the isolated virtual store and skips the top-level symlinks", () => {
  const root = workspace();
  try {
    const nm = join(root, "deploy/node_modules");
    pkg(join(nm, ".pnpm/net-snmp@3.26.3/node_modules/net-snmp"), "net-snmp", "3.26.3");
    pkg(join(nm, ".pnpm/asn1-ber@1.2.2/node_modules/asn1-ber"), "asn1-ber", "1.2.2");
    pkg(join(nm, ".pnpm/@dpf+validators@file+packages+validators/node_modules/@dpf/validators"), "@dpf/validators", "0.0.1");
    write(nm, ".pnpm/lock.yaml", "lockfileVersion: '9.0'\n");
    symlinkSync(join(nm, ".pnpm/net-snmp@3.26.3/node_modules/net-snmp"), join(nm, "net-snmp"));
    const installed = listInstalledPackages(nm);
    assert.deepEqual(
      installed.map((p) => `${p.name}@${p.version}`).sort(),
      ["@dpf/validators@0.0.1", "asn1-ber@1.2.2", "net-snmp@3.26.3"],
    );
    const { problems, checked } = findUnlockedPackages(installed, allowedForImporter(root, "services/svc"));
    assert.deepEqual(problems, []);
    assert.equal(checked, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags a re-resolved version in a hoisted tree and names the locked one", () => {
  const root = workspace();
  try {
    const nm = join(root, "deploy/node_modules");
    pkg(join(nm, "net-snmp"), "net-snmp", "3.29.1");
    pkg(join(nm, "asn1-ber"), "asn1-ber", "1.2.2");
    const { problems } = findUnlockedPackages(listInstalledPackages(nm), allowedForImporter(root, "services/svc"));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^net-snmp@3\.29\.1 .*the lockfile locks net-snmp@3\.26\.3$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags a nested package the lockfile never listed, and a devDependency", () => {
  const root = workspace();
  try {
    const nm = join(root, "deploy/node_modules");
    pkg(join(nm, "net-snmp"), "net-snmp", "3.26.3");
    pkg(join(nm, "net-snmp/node_modules/smart-buffer"), "smart-buffer", "4.2.0");
    pkg(join(nm, "vitest"), "vitest", "4.1.11");
    const { problems } = findUnlockedPackages(listInstalledPackages(nm), allowedForImporter(root, "services/svc"));
    assert.equal(problems.length, 2);
    assert.match(problems.join("\n"), /smart-buffer@4\.2\.0 .*does not list it/);
    assert.match(problems.join("\n"), /vitest@4\.1\.11 .*not in the lockfile closure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a workspace package must match its local version", () => {
  const root = workspace();
  try {
    const nm = join(root, "deploy/node_modules");
    pkg(join(nm, "@dpf/validators"), "@dpf/validators", "9.9.9");
    const { problems } = findUnlockedPackages(listInstalledPackages(nm), allowedForImporter(root, "services/svc"));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /workspace package, local version is 0\.0\.1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty or missing tree yields nothing to pass", () => {
  assert.deepEqual(listInstalledPackages(join(tmpdir(), "deploy-lockfile-does-not-exist")), []);
});
