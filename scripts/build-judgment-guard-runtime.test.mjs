import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { SOURCE_PATHS, PACKAGE_FILES, IDENTITY_PATH, ARTIFACT_DIRECTORY, buildArtifacts, staleArtifacts, readPackageFiles, verifyGuardClosure } from "./build-judgment-guard-runtime.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (path) => readFileSync(join(root, path), "utf8");
const hash = (text) => createHash("sha256").update(text).digest("hex");

// Construct tiny approved test archives so malformed input reaches the parser,
// rather than failing the outer archive-hash comparison first.
function seal(header) {
  header.fill(32, 148, 156);
  header.write([...header].reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return header;
}
function tarFile({name = "package/value.js", contents = "safe", type = "0", size, prefix = ""} = {}) {
  const bytes = Buffer.from(contents), header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write((size ?? bytes.length).toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(type, 156, "ascii"); header.write(prefix, 345, 155, "utf8"); seal(header);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}
function parseTar(tar) { const archive = gzipSync(tar); return readPackageFiles(archive, hash(archive)); }
const terminated = (...entries) => Buffer.concat([...entries, Buffer.alloc(1024)]);

test("hash-bound regular TAR bytes are returned without extraction", () => {
  assert.equal(parseTar(terminated(tarFile())).get("package/value.js").toString(), "safe");
});
test("hash-bound TAR rejects changed checksums and non-octal sizes", () => {
  const changed = tarFile(); changed[1] ^= 1;
  assert.throws(() => parseTar(terminated(changed)), /Tar header checksum/);
  const badSize = tarFile(); badSize.fill(120, 124, 136); seal(badSize.subarray(0, 512));
  assert.throws(() => parseTar(terminated(badSize)), /Invalid tar number/);
});
test("hash-bound TAR refuses traversal, foreign roots and links", () => {
  for (const entry of [tarFile({name:"package/../escape"}), tarFile({name:"/absolute"}), tarFile({prefix:"../escape"})])
    assert.throws(() => parseTar(terminated(entry)), /Invalid package entry/);
  for (const type of ["1", "2", "5"]) assert.throws(() => parseTar(terminated(tarFile({type}))), /Only regular package files/);
});
test("hash-bound TAR rejects duplicate entries and the entry-count ceiling", () => {
  assert.throws(() => parseTar(terminated(tarFile(),tarFile())), /Duplicate or excessive/);
  const entries = Array.from({length:1001},(_,i)=>tarFile({name:`package/file${i}`,contents:""}));
  assert.throws(() => parseTar(terminated(...entries)), /Duplicate or excessive/);
});
test("hash-bound TAR rejects truncation, absent terminators and trailing bytes", () => {
  assert.throws(() => parseTar(terminated(tarFile({size:4096}))), /Truncated package entry/);
  assert.throws(() => parseTar(tarFile()), /Invalid tar termination/);
  assert.throws(() => parseTar(Buffer.concat([terminated(tarFile()),Buffer.from("trailing")])), /Invalid tar termination/);
  assert.throws(() => parseTar(tarFile().subarray(0,200)), /Invalid tar termination/);
});
test("archive bounds refuse oversized compressed and decompressed bytes", () => {
  const oversized = Buffer.alloc(4 * 1024 * 1024 + 1);
  assert.throws(() => readPackageFiles(oversized,hash(oversized)), /Bounded package archive/);
  const bomb = gzipSync(Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.throws(() => readPackageFiles(bomb,hash(bomb)), error => error.code === "ERR_BUFFER_TOO_LARGE");
  const compressed = gzipSync(terminated(tarFile())).subarray(0,20);
  assert.throws(() => readPackageFiles(compressed,hash(compressed)), error => ["Z_BUF_ERROR","Z_DATA_ERROR"].includes(error.code));
});

test("generated runtime is deterministic and binds exact canonical source/output bytes", () => {
  const artifacts = buildArtifacts();
  assert.equal(artifacts.size, 4);
  assert.deepEqual(artifacts, buildArtifacts());
  const manifest = JSON.parse(artifacts.get(ARTIFACT_DIRECTORY + "/manifest.json"));
  assert.equal(manifest.builder.parser, "typescript@6.0.3");
  const identity = JSON.parse(source(IDENTITY_PATH));
  assert.deepEqual(manifest.componentArtifact, identity.componentArtifact);
  assert.equal(manifest.owner, "@markdbodman");
  assert.deepEqual(Object.keys(manifest.sources), SOURCE_PATHS);
  const files = readPackageFiles(readFileSync(join(root, identity.componentArtifact.path)), identity.componentArtifact.sha256);
  const provenance = JSON.parse(files.get("package/PROVENANCE.json").toString("utf8"));
  for (const path of SOURCE_PATHS) assert.equal(manifest.sources[path], provenance.files.find(file => file.path === path).sha256);
  for (const path of PACKAGE_FILES) {
    const emitted = artifacts.get(ARTIFACT_DIRECTORY + "/" + path.split("/").at(-1)).split("\n").slice(1).join("\n");
    assert.equal(hash(emitted), identity.guardDistribution.files[path]);
  }
  for (const [path, digest] of Object.entries(manifest.outputs)) assert.equal(digest, hash(artifacts.get(path)));
  assert.deepEqual(manifest.runtimeDependencies, []);
});

test("freshness check rejects changed canonical source, generated bytes and missing output", () => {
  const artifacts = buildArtifacts();
  assert.deepEqual(staleArtifacts(artifacts, (path) => artifacts.get(path)), []);
  const identity = JSON.parse(source(IDENTITY_PATH));
  const archive = readFileSync(join(root, identity.componentArtifact.path));
  const changed = Buffer.from(archive); changed[changed.length - 1] ^= 1;
  assert.throws(() => buildArtifacts({readArchive: () => changed}), /Approved archive integrity changed/);
  const wrongFile = structuredClone(identity); wrongFile.guardDistribution.files[PACKAGE_FILES[0]] = "0".repeat(64);
  assert.throws(() => buildArtifacts({identity: wrongFile}), /Approved emitted file changed/);
  assert.ok(staleArtifacts(artifacts, (path) => path.endsWith("option-scoring.js") ? "altered bytes" : artifacts.get(path)).includes(ARTIFACT_DIRECTORY + "/option-scoring.js"));
  assert.ok(staleArtifacts(artifacts, () => undefined).length >= 4);
});

test("verified emitted closure refuses a new runtime dependency", () => {
  const identity = JSON.parse(source(IDENTITY_PATH));
  const files = readPackageFiles(readFileSync(join(root, identity.componentArtifact.path)), identity.componentArtifact.sha256);
  const changed = new Map(files);
  changed.set("package/" + PACKAGE_FILES[0], Buffer.concat([Buffer.from('import "node:fs";\n'), files.get("package/" + PACKAGE_FILES[0])]));
  assert.throws(() => verifyGuardClosure(changed), /Unreviewed runtime dependency/);
  changed.delete("package/" + PACKAGE_FILES[1]);
  assert.throws(() => verifyGuardClosure(changed));
});

test("committed guard executes synchronously without TypeScript, application source or node_modules", () => {
  const temporary = mkdtempSync(join(tmpdir(), "dpf-judgment-node-runtime-"));
  try {
    for (const path of [
      ...["package.json", "option-scoring.js", "mcda-quality-gates.js"].map((name) => ARTIFACT_DIRECTORY + "/" + name),
      "scripts/check-golden-decisions.mjs", "scripts/lib/git.mjs", "scripts/lib/script-argv.mjs",
    ]) {
      const target = join(temporary, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, source(path));
    }
    const url = pathToFileURL(join(temporary, ARTIFACT_DIRECTORY, "option-scoring.js")).href;
    const guardUrl = pathToFileURL(join(temporary, "scripts/check-golden-decisions.mjs")).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
      import { decide } from ${JSON.stringify(url)};
      const result = decide(
        [{id:"low",description:"Lower cost",features:{effort:.1,quality:.9,benefit:.8}},
         {id:"high",description:"Higher cost",features:{effort:.9,quality:.9,benefit:.8}}],
        [{id:"cost",name:"Cost is worse when higher",tier:"core",weight:1,dimensionVector:{effort:-1,quality:1,benefit:1}}]);
      if (result.recommendation?.optionId !== "low") throw new Error("cost sign or scoring changed");
      const {runCheck,SCENARIOS}=await import(${JSON.stringify(guardUrl)});
      const guard=runCheck(undefined,{commandments:[]});
      if (guard instanceof Promise || guard.results.length !== SCENARIOS.length || typeof guard.ok !== "boolean")
        throw new Error("golden guard synchronous/result contract changed");
      console.log(JSON.stringify(result.recommendation));
    `], { cwd: temporary, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).optionId, "low");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
