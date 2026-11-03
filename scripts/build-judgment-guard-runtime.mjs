#!/usr/bin/env node
// Exact package distribution -> dependency-free Node20 golden guard.
// Canonical implementation: scoped-judgment; receiving owner @markdbodman, BI-BDF358CB.
import assert from "node:assert/strict";
import { loadPinnedGuardTypeScript } from "./lib/load-pinned-guard-typescript.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const ts = loadPinnedGuardTypeScript({ repoRoot: ROOT });
export const IDENTITY_PATH = "packages/validators/vendor/JUDGMENT-ADOPTION.json";
export const SOURCE_PATHS = ["packages/validators/src/judgment/option-scoring.ts", "packages/validators/src/judgment/mcda-quality-gates.ts"];
export const PACKAGE_FILES = ["dist/judgment/option-scoring.js", "dist/judgment/mcda-quality-gates.js"];
export const ARTIFACT_DIRECTORY = "scripts/generated/judgment";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const readIdentity = () => JSON.parse(readFileSync(join(ROOT, IDENTITY_PATH), "utf8"));
function readArchive(identity) {
  const artifact = identity.componentArtifact;
  assert.equal(artifact.name, "@opendigitalproductfactory/dpf-scoped-judgment");
  assert(/^0\.1\.0-candidate\.\d+$/.test(artifact.version), "Explicit immutable candidate required");
  assert.equal(artifact.path, `packages/validators/vendor/opendigitalproductfactory-dpf-scoped-judgment-${artifact.version}.tgz`);
  const path = join(ROOT, artifact.path);
  assert(lstatSync(path).isFile() && realpathSync(path) === path, "Archive must be a regular checkout file");
  return readFileSync(path);
}

// Read bytes only: never extract paths to disk or execute package lifecycle code.
export function readPackageFiles(archive, expectedSha256) {
  assert(Buffer.isBuffer(archive) && archive.length <= 4 * 1024 * 1024, "Bounded package archive required");
  assert.equal(hash(archive), expectedSha256, "Approved archive integrity changed");
  const tar = gunzipSync(archive, { maxOutputLength: 16 * 1024 * 1024 });
  const files = new Map();
  const number = field => { const value = field.toString("ascii").replaceAll("\0", "").trim(); assert(/^[0-7]+$/.test(value), "Invalid tar number"); return Number.parseInt(value, 8); };
  const text = field => field.toString("utf8").split("\0", 1)[0];
  let offset = 0;
  for (; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const checksum = number(header.subarray(148, 156));
    assert.equal([...header].reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0), checksum, "Tar header checksum changed");
    const prefix = text(header.subarray(345, 500));
    const name = (prefix ? prefix + "/" : "") + text(header.subarray(0, 100));
    assert(name.startsWith("package/") && !name.split("/").some(part => part === ".." || part === "."), "Invalid package entry");
    const size = number(header.subarray(124, 136)), type = header[156];
    assert(type === 0 || type === 48, "Only regular package files are admitted");
    assert(!files.has(name) && files.size < 1000, "Duplicate or excessive package entries");
    const start = offset + 512, end = start + size;
    assert(end <= tar.length, "Truncated package entry");
    files.set(name, tar.subarray(start, end));
    offset = start + Math.ceil(size / 512) * 512;
  }
  assert(offset < tar.length && tar.subarray(offset).every(byte => byte === 0), "Invalid tar termination");
  return files;
}

export function verifyGuardClosure(files) {
  assert.equal(ts.version, "6.0.3", "Reassess the pinned guard parser before changing it");
  for (const path of PACKAGE_FILES) {
    const contents = files.get("package/" + path);
    assert(contents, `Missing emitted guard file: ${path}`);
    const imports = ts.preProcessFile(contents.toString("utf8")).importedFiles.map(item => item.fileName);
    assert.deepEqual(imports, path.endsWith("/option-scoring.js") ? ["./mcda-quality-gates.js"] : [], `Unreviewed runtime dependency in ${path}`);
  }
}

export function buildArtifacts(options = {}) {
  const identity = options.identity ?? readIdentity();
  const artifact = identity.componentArtifact;
  const files = readPackageFiles((options.readArchive ?? readArchive)(identity), artifact.sha256);
  const metadata = JSON.parse(files.get("package/package.json").toString("utf8"));
  assert.equal(metadata.name, artifact.name); assert.equal(metadata.version, artifact.version);
  assert.deepEqual(metadata.dependencies, {}, "The guard foundation has no runtime dependencies");
  verifyGuardClosure(files);
  const provenance = JSON.parse(files.get("package/PROVENANCE.json").toString("utf8"));
  const artifacts = new Map(), sources = {};
  artifacts.set(ARTIFACT_DIRECTORY + "/package.json", JSON.stringify({ private: true, type: "module", license: "Apache-2.0" }, null, 2) + "\n");
  for (let i = 0; i < PACKAGE_FILES.length; i++) {
    const path = PACKAGE_FILES[i], contents = files.get("package/" + path);
    assert.equal(hash(contents), identity.guardDistribution.files[path], `Approved emitted file changed: ${path}`);
    const record = provenance.files.find(file => file.path === SOURCE_PATHS[i]);
    assert(record && /^[a-f0-9]{64}$/.test(record.sha256), "Canonical source provenance missing");
    sources[SOURCE_PATHS[i]] = record.sha256;
    artifacts.set(ARTIFACT_DIRECTORY + "/" + path.split("/").at(-1),
      `// Generated from ${artifact.name}@${artifact.version}/${path} by scripts/build-judgment-guard-runtime.mjs; do not edit.\n` + contents.toString("utf8"));
  }
  artifacts.set(ARTIFACT_DIRECTORY + "/manifest.json", JSON.stringify({
    schemaVersion: 2, owner: "@markdbodman", backlogItem: "BI-BDF358CB", license: "Apache-2.0",
    componentArtifact: artifact,
    builder: { path: "scripts/build-judgment-guard-runtime.mjs", sha256: hash(readFileSync(fileURLToPath(import.meta.url))), parser: "typescript@6.0.3", mode: "verified-emitted-file-copy" },
    sources, emittedFiles: identity.guardDistribution.files,
    outputs: Object.fromEntries([...artifacts].map(([path, contents]) => [path, hash(contents)])), runtimeDependencies: [],
  }, null, 2) + "\n");
  return artifacts;
}

export function staleArtifacts(artifacts, read = path => {
  try { return readFileSync(join(ROOT, path), "utf8"); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}) {
  return [...artifacts].filter(([path, contents]) => read(path) !== contents).map(([path]) => path);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifacts = buildArtifacts();
  if (process.argv.includes("--check")) {
    const stale = staleArtifacts(artifacts);
    if (stale.length) { console.error(`Judgment guard runtime is stale: ${stale.join(", ")}. Regenerate with scripts/build-judgment-guard-runtime.mjs.`); process.exitCode = 1; }
    else console.log("Judgment guard runtime fresh (verified package closure and generated bytes match).");
  } else {
    for (const [path, contents] of artifacts) { const target = join(ROOT, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents); }
    console.log(`Wrote ${artifacts.size} judgment guard distribution artifacts.`);
  }
}
