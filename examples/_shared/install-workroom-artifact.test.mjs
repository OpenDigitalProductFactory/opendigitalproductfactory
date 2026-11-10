import assert from "node:assert/strict";
import { test } from "node:test";
import { lstat, mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { installWorkroomArtifact } from "./install-workroom-artifact.mjs";

const identity = { name: "@opendigitalproductfactory/dpf-workroom", version: "0.1.0-candidate.2",
  path: "packages/validators/vendor/candidate.tgz", sha256: "0".repeat(64) };

test("rejects an unrelated package before installing it", async () => {
  await assert.rejects(installWorkroomArtifact({ artifact: { ...identity, name: "unreviewed-package" } }),
    /Only the reviewed Workroom dependency/);
});

test("rejects traversal in the artifact locator", async () => {
  await assert.rejects(installWorkroomArtifact({ artifact: { ...identity, path: "packages/validators/vendor/../candidate.tgz" } }),
    /Use the declared repository artifact/);
});

test("rejects changed bytes at the pinned archive path before npm runs", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-integrity-test-"));
  try {
    await mkdir(join(root, "packages/validators/vendor"), { recursive: true });
    await writeFile(join(root, identity.path), "changed archive bytes");
    await assert.rejects(installWorkroomArtifact({ root, destination: join(root, "consumer"), artifact: identity }),
      /Artifact integrity changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("rejects an archive symlink rather than following another checkout", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-link-test-"));
  try {
    await mkdir(join(root, "packages/validators/vendor"), { recursive: true });
    await writeFile(join(root, "other.tgz"), "not a receiving artifact");
    await symlink(join(root, "other.tgz"), join(root, identity.path));
    await assert.rejects(installWorkroomArtifact({ root, destination: join(root, "consumer"), artifact: identity }),
      /Artifact paths cannot redirect/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("installs the verified snapshot when the original archive pathname is replaced", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-snapshot-test-"));
  const previous = { cli: process.env.npm_execpath, original: process.env.DPF_ARTIFACT_TEST_ORIGINAL,
    expected: process.env.DPF_ARTIFACT_TEST_EXPECTED };
  try {
    const bytes = Buffer.from('export const witnessed = "verified original bytes";\n');
    const archive = join(root, identity.path);
    await mkdir(join(root, "packages/validators/vendor"), { recursive: true });
    await writeFile(archive, bytes);
    const cli = join(root, "npm-cli.js");
    // Simulate npm's read after another writer has replaced the repository path.
    // Same package name/version cannot establish which bytes the installer read.
    await writeFile(cli, `
const fs = require('node:fs'), path = require('node:path');
fs.writeFileSync(process.env.DPF_ARTIFACT_TEST_ORIGINAL, 'replacement bytes');
const installedBytes = fs.readFileSync(process.argv.at(-1));
if (!installedBytes.equals(Buffer.from(process.env.DPF_ARTIFACT_TEST_EXPECTED, 'base64'))) throw Error('Installer read replacement bytes');
const target = path.join(process.cwd(), 'node_modules/@opendigitalproductfactory/dpf-workroom');
fs.mkdirSync(path.join(target, 'dist'), {recursive:true});
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({name:'@opendigitalproductfactory/dpf-workroom',version:'0.1.0-candidate.2',type:'module',dependencies:{},exports:{'.':{import:'./dist/index.js',types:'./dist/index.d.ts'}}}));
fs.writeFileSync(path.join(target, 'dist/index.js'), installedBytes);
fs.writeFileSync(path.join(target, 'dist/index.d.ts'), 'export declare const witnessed: string;');
`);
    process.env.npm_execpath = cli;
    process.env.DPF_ARTIFACT_TEST_ORIGINAL = archive;
    process.env.DPF_ARTIFACT_TEST_EXPECTED = bytes.toString("base64");
    const artifact = { ...identity, sha256: createHash("sha256").update(bytes).digest("hex") };
    const destination = join(root, "consumer");
    const result = await installWorkroomArtifact({ root, destination, artifact, node: basename(process.execPath) });
    assert.equal(await readFile(archive, "utf8"), "replacement bytes");
    assert.equal(await readFile(join(destination, "node_modules/@opendigitalproductfactory/dpf-workroom/dist/index.js"), "utf8"), bytes.toString());
    assert.equal(result.evidence.sha256, artifact.sha256);
  } finally {
    for (const [key, value] of [["npm_execpath", previous.cli], ["DPF_ARTIFACT_TEST_ORIGINAL", previous.original], ["DPF_ARTIFACT_TEST_EXPECTED", previous.expected]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("inherited global and prefix settings cannot redirect writes outside the owned transport", async () => {
  const root = await mkdtemp(join(tmpdir(), "artifact-install-mode-test-"));
  const inherited = new Map();
  try {
    const manifest = JSON.parse(await readFile(new URL("../workroom-kernel/closure.json", import.meta.url), "utf8"));
    const bytes = await readFile(new URL("../../" + manifest.componentArtifact.path, import.meta.url));
    await mkdir(join(root, "packages/validators/vendor"), { recursive: true });
    await writeFile(join(root, identity.path), bytes);
    const globalPrefix = join(root, "simulated-global");
    const userConfig = join(root, "inherited.npmrc"), globalConfig = join(root, "global.npmrc");
    await writeFile(userConfig, "global=true\nlocation=global\n");
    await writeFile(globalConfig, "");
    // Every possible destination in the regression is inside this owned fixture.
    const settings = { GLOBAL: "true", LOCATION: "global", PREFIX: globalPrefix,
      USERCONFIG: userConfig, GLOBALCONFIG: globalConfig, CACHE: join(root, "cache"), LOGS_DIR: join(root, "logs") };
    for (const [suffix, value] of Object.entries(settings)) for (const key of ["NPM_CONFIG_" + suffix, "npm_config_" + suffix.toLowerCase()]) {
      inherited.set(key, process.env[key]); process.env[key] = value;
    }
    const result = await installWorkroomArtifact({ root, destination: join(root, "consumer"),
      artifact: { ...manifest.componentArtifact, path: identity.path } });
    assert.equal(result.evidence.version, manifest.componentArtifact.version);
    assert.equal(await lstat(globalPrefix).catch(error => { if (error.code !== "ENOENT") throw error; }), undefined,
      "No global installation directory may be created");
  } finally {
    for (const [key, value] of inherited) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
