#!/usr/bin/env node
// scripts/check-ci-node-qualified.mjs (BI-2FAE2E5C)
//
// CI's Node is the exact version in the repo-root .node-version, and that
// version must be one the vendored first-party artifacts were qualified on.
//
// Why: setup-node `node-version: 24` resolves to the newest 24.x the runner
// image caches. Runner image 20261101 shipped 24.22.2, and the engine-strict
// install of @opendigitalproductfactory/dpf-workroom@0.1.0-candidate.4
// (qualified on 24.16.0, 24.22.0 and 24.22.1) failed for every PR. The
// qualification is evidence bound to its bytes; it is never widened by hand.
// To move CI to a newer Node, requalify the artifact first, then bump
// .node-version.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, relative } from "node:path";

const VENDOR_DIR = "packages/validators/vendor";
const WORKFLOW_DIRS = [".github/workflows", ".github/actions"];

export function parseNodeVersionPin(text) {
  if (typeof text !== "string") return null;
  const match = /^v?(\d+\.\d+\.\d+)$/.exec(text.trim());
  return match ? match[1] : null;
}

/** setup-node `node-version:` values on the pinned major that do not name an exact release. */
export function findFloatingNodeVersions(text, major) {
  const findings = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const match = /^\s*node-version:\s*["']?([^"'#\s]+)["']?/.exec(line);
    if (!match) return;
    const value = match[1];
    if (value.split(".")[0] !== major) return;
    findings.push({ line: index + 1, value });
  });
  return findings;
}

export function checkCiNodeQualified({ pinText, qualifications, workflows }) {
  const errors = [];
  const pin = parseNodeVersionPin(pinText);
  if (!pin) {
    errors.push(".node-version must hold one exact Node release (X.Y.Z) that CI installs via node-version-file.");
    return { ok: false, pin: null, errors };
  }
  for (const { path, json } of qualifications) {
    const supported = json.supportedNodeVersions;
    if (!supported.includes(pin)) {
      errors.push(`.node-version ${pin} is not in ${path} supportedNodeVersions [${supported.join(", ")}]. `
        + "Pin a qualified version, or requalify the artifact before moving CI.");
    }
  }
  const major = pin.split(".")[0];
  for (const { path, text } of workflows) {
    for (const { line, value } of findFloatingNodeVersions(text, major)) {
      errors.push(`${path}:${line} sets node-version: ${value}; use node-version-file: .node-version `
        + "so CI runs the qualified exact version, not whatever the runner image caches.");
    }
  }
  return { ok: errors.length === 0, pin, errors };
}

async function listYaml(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listYaml(path));
    else if (/\.ya?ml$/.test(entry.name)) out.push(path);
  }
  return out;
}

export async function loadRepositoryInputs(rootUrl) {
  const root = fileURLToPath(rootUrl);
  const pinText = await readFile(join(root, ".node-version"), "utf8").catch(() => null);
  const qualifications = [];
  for (const name of (await readdir(join(root, VENDOR_DIR))).sort()) {
    if (!name.endsWith(".qualification.json")) continue;
    const json = JSON.parse(await readFile(join(root, VENDOR_DIR, name), "utf8"));
    if (Array.isArray(json.supportedNodeVersions)) qualifications.push({ path: `${VENDOR_DIR}/${name}`, json });
  }
  const workflows = [];
  for (const dir of WORKFLOW_DIRS) {
    for (const file of (await listYaml(join(root, dir))).sort()) {
      workflows.push({ path: relative(root, file), text: await readFile(file, "utf8") });
    }
  }
  return { pinText, qualifications, workflows };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = checkCiNodeQualified(await loadRepositoryInputs(new URL("..", import.meta.url)));
  if (!result.ok) {
    for (const error of result.errors) console.error(`::error::${error}`);
    process.exit(1);
  }
  console.log(`CI Node ${result.pin} is pinned and qualified.`);
}
