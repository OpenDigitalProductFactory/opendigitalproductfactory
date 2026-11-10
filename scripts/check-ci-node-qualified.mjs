#!/usr/bin/env node
// scripts/check-ci-node-qualified.mjs (BI-2FAE2E5C, BI-827FA1C9)
//
// CI's Node comes from the repo-root .node-version, and every vendored
// first-party artifact must admit it under the engines range declared inside
// its own tarball. Dockerfiles must run the same Node major.
//
// Why: dpf-workroom@0.1.0-candidate.4 listed exact patches, so each Node 24
// patch (24.22.2 on runner image 20261101) failed its engine-strict install
// for every PR. Candidate.5 admits the whole Node 24 line and its own CI
// tests the newest patch weekly (DI-89054A6F7D1A), so .node-version can hold
// the major line that production's node:24-alpine images already run. The
// range is read from the artifact bytes, never copied by hand.
import { readFile, readdir } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, relative } from "node:path";

const VENDOR_DIR = "packages/validators/vendor";
const WORKFLOW_DIRS = [".github/workflows", ".github/actions"];

/** An exact X.Y.Z release or a bare major line N. */
export function parseNodeVersionPin(text) {
  if (typeof text !== "string") return null;
  const match = /^v?(\d+)(?:\.(\d+)\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  return match[2] === undefined
    ? { kind: "major", major: Number(match[1]), text: match[1] }
    : { kind: "exact", version: [1, 2, 3].map(i => Number(match[i])), text: `${match[1]}.${match[2]}.${match[3]}` };
}

function parseVersion(text) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(text);
  return match ? [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)] : null;
}

function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** engines.node as comparator sets joined by ||. Supports X.Y.Z, >=, >, <=, < and =; null for anything else. */
export function parseEnginesRange(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  const sets = [];
  for (const part of text.split("||")) {
    const comparators = [];
    for (const token of part.trim().split(/\s+/)) {
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(token);
      const version = match && parseVersion(match[2]);
      if (!version) return null;
      comparators.push({ op: match[1] ?? "=", version });
    }
    sets.push(comparators);
  }
  return sets;
}

function satisfies(version, comparators) {
  return comparators.every(({ op, version: bound }) => {
    const c = compare(version, bound);
    return op === "=" ? c === 0 : op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : c < 0;
  });
}

/** True when the range admits the pin: an exact release, or every patch from one floor to the end of the major line. */
export function rangeAdmitsPin(sets, pin) {
  if (pin.kind === "exact") return sets.some(set => satisfies(pin.version, set));
  return sets.some(set => {
    const floors = set.filter(c => c.op === ">=" || c.op === ">");
    const ceilings = set.filter(c => c.op === "<");
    return set.length === floors.length + ceilings.length
      && floors.length === 1 && floors[0].version[0] === pin.major
      && ceilings.length === 1 && compare(ceilings[0].version, [pin.major + 1, 0, 0]) === 0;
  });
}

/** setup-node `node-version:` values on the pinned major; workflows read .node-version instead. */
export function findFloatingNodeVersions(text, major) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*node-version:\s*["']?([^"'#\s]+)["']?/.exec(line);
    if (!match) return;
    const value = match[1];
    if (value.split(".")[0] !== String(major)) return;
    findings.push({ line: index + 1, value });
  });
  return findings;
}

/** `FROM node:<major>` lines that leave the pinned major. */
export function findDockerfileNodeMajors(text, major) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?node:(\d+)/i.exec(line);
    if (match && Number(match[1]) !== major) findings.push({ line: index + 1, value: match[1] });
  });
  return findings;
}

export function checkCiNodeQualified({ pinText, artifacts, workflows, dockerfiles = [] }) {
  const errors = [];
  const pin = parseNodeVersionPin(pinText);
  if (!pin) {
    errors.push(".node-version must hold a Node major line (N) or one exact release (X.Y.Z) that CI installs via node-version-file.");
    return { ok: false, pin: null, errors };
  }
  for (const { path, engines } of artifacts) {
    const sets = parseEnginesRange(engines);
    if (!sets) {
      errors.push(`${path} declares engines.node ${JSON.stringify(engines)}, which this check cannot evaluate.`);
    } else if (!rangeAdmitsPin(sets, pin)) {
      errors.push(`.node-version ${pin.text} is outside ${path} engines.node "${engines}". `
        + "Pin a version the artifact admits, or vendor a candidate whose own CI tests the newer Node first.");
    }
  }
  const major = pin.kind === "major" ? pin.major : pin.version[0];
  for (const { path, text } of workflows) {
    for (const { line, value } of findFloatingNodeVersions(text, major)) {
      errors.push(`${path}:${line} sets node-version: ${value}; use node-version-file: .node-version `
        + "so every job runs the one Node the vendored artifacts admit.");
    }
  }
  for (const { path, text } of dockerfiles) {
    for (const { line, value } of findDockerfileNodeMajors(text, major)) {
      errors.push(`${path}:${line} uses node:${value}; .node-version and the vendored artifacts are on Node ${major}.`);
    }
  }
  return { ok: errors.length === 0, pin: pin.text, errors };
}

/** package/package.json from an npm pack tarball (gzip + ustar). */
export function readPackedManifest(tgz) {
  const tar = gunzipSync(tgz);
  const field = (header, start, end) => header.subarray(start, end).toString("utf8").replace(/\0.*$/s, "");
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const name = field(header, 0, 100);
    if (!name) break;
    const prefix = field(header, 345, 500);
    const size = parseInt(field(header, 124, 136).trim() || "0", 8);
    if ((prefix ? `${prefix}/${name}` : name) === "package/package.json") {
      return JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString("utf8"));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error("package/package.json not found in tarball");
}

async function listFiles(dir, accept) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path, accept));
    else if (accept(entry.name)) out.push(path);
  }
  return out;
}

export async function loadRepositoryInputs(rootUrl) {
  const root = fileURLToPath(rootUrl);
  const pinText = await readFile(join(root, ".node-version"), "utf8").catch(() => null);
  const artifacts = [];
  for (const name of (await readdir(join(root, VENDOR_DIR))).sort()) {
    if (!name.endsWith(".tgz")) continue;
    const manifest = readPackedManifest(await readFile(join(root, VENDOR_DIR, name)));
    if (manifest.engines?.node !== undefined) artifacts.push({ path: `${VENDOR_DIR}/${name}`, engines: manifest.engines.node });
  }
  const read = async files => Promise.all(files.sort().map(async file => ({ path: relative(root, file), text: await readFile(file, "utf8") })));
  const workflows = (await Promise.all(WORKFLOW_DIRS.map(dir => listFiles(join(root, dir), name => /\.ya?ml$/.test(name))))).flat();
  const dockerfiles = await listFiles(root, name => name === "Dockerfile" || name.startsWith("Dockerfile."));
  return { pinText, artifacts, workflows: await read(workflows), dockerfiles: await read(dockerfiles) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = checkCiNodeQualified(await loadRepositoryInputs(new URL("..", import.meta.url)));
  if (!result.ok) {
    for (const error of result.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`CI Node ${result.pin} is admitted by every vendored artifact and matches every Dockerfile.`);
}
