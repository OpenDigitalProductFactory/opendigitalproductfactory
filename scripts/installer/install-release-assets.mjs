#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { restoreInstallState, updateInstallState } from "./install-state-transaction.mjs";

const VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

function safeRelativePath(root, manifestPath) {
  const normalized = manifestPath.replace(/^\.?[\\/]/, "").replaceAll("\\", "/");
  if (!normalized || normalized.split("/").some(part => !part || part === "." || part === "..")) {
    throw new Error(`release_asset_path_invalid:${manifestPath}`);
  }
  const absolute = resolve(root, ...normalized.split("/"));
  const rel = relative(resolve(root), absolute);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error(`release_asset_path_invalid:${manifestPath}`);
  return { relative: normalized, absolute };
}

function parseManifest(bytes, root) {
  const entries = new Map();
  for (const line of bytes.toString("utf8").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!match) throw new Error("release_asset_manifest_invalid");
    const path = safeRelativePath(root, match[2]);
    if (entries.has(path.relative)) throw new Error(`release_asset_manifest_duplicate:${path.relative}`);
    entries.set(path.relative, { ...path, digest: match[1].toLowerCase() });
  }
  if (entries.size === 0) throw new Error("release_asset_manifest_empty");
  return entries;
}

async function listFiles(root, directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).replaceAll("\\", "/"));
    else throw new Error(`release_asset_unsupported_entry:${entry.name}`);
  }
  return files;
}

async function verifiedManifest(sourceDir) {
  const manifestBytes = await readFile(join(sourceDir, "SHA256SUMS"));
  const entries = parseManifest(manifestBytes, sourceDir);
  for (const [name, entry] of entries) {
    let bytes;
    try { bytes = await readFile(entry.absolute); } catch { throw new Error(`release_asset_missing:${name}`); }
    if (sha256(bytes) !== entry.digest) throw new Error(`release_asset_integrity_failed:${name}`);
  }
  const listed = new Set(entries.keys());
  for (const name of await listFiles(sourceDir)) {
    if (name !== "SHA256SUMS" && !listed.has(name)) throw new Error(`release_asset_unverified:${name}`);
  }
  return { entries, manifestBytes };
}

async function maybeRead(path) {
  try { return await readFile(path); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.${randomUUID()}.tmp`);
  try { await writeFile(temporary, bytes); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

// BI-FEE77B68: compose publishes every host port through this variable. A
// fresh install gets loopback (kernel decision DI-946636F6E8F6). An install
// that predates the key keeps the all-interfaces exposure it already has, and
// says so in its .env, rather than losing LAN access on an upgrade.
export const HOST_BIND_KEY = "DPF_HOST_BIND_ADDRESS";
export const HOST_BIND_FRESH = "127.0.0.1";
export const HOST_BIND_PRE_EXISTING = "0.0.0.0";

export function updateEnv(bytes, releaseTag, ghcrOwner) {
  let text = bytes?.toString("utf8") ?? "";
  const preExisting = text.trim().length > 0;
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  for (const [key, value] of [["DPF_IMAGE_TAG", releaseTag], ["GHCR_OWNER", ghcrOwner]]) {
    const pattern = new RegExp(`^${key}=.*$`, "gm");
    if (pattern.test(text)) text = text.replace(pattern, `${key}=${value}`);
    else text += `${text && !text.endsWith("\n") ? newline : ""}${key}=${value}${newline}`;
  }
  if (!new RegExp(`^${HOST_BIND_KEY}=`, "m").test(text)) {
    const value = preExisting ? HOST_BIND_PRE_EXISTING : HOST_BIND_FRESH;
    const why = preExisting
      ? "# Kept the exposure this install had before DPF_HOST_BIND_ADDRESS existed (BI-FEE77B68). Set 127.0.0.1 to serve this machine only."
      : "# Loopback by default (BI-FEE77B68). Set 0.0.0.0 to serve the LAN.";
    text += `${text && !text.endsWith("\n") ? newline : ""}${why}${newline}${HOST_BIND_KEY}=${value}${newline}`;
  }
  return Buffer.from(text);
}

export async function installReleaseAssets(options) {
  const { sourceDir, installDir, statePath, releaseTag, ghcrOwner, recoveryDir } = options;
  if (!VERSION.test(releaseTag)) throw new Error("release_version_invalid");
  if (!OWNER.test(ghcrOwner)) throw new Error("release_owner_invalid");
  const verified = await verifiedManifest(sourceDir);
  const oldManifestPath = join(installDir, ".verified-release-assets.sha256");
  const oldManifestBytes = await maybeRead(oldManifestPath);
  const oldEntries = oldManifestBytes ? parseManifest(oldManifestBytes, installDir) : new Map();
  const managedNames = new Set([...oldEntries.keys(), ...verified.entries.keys()]);
  const snapshots = new Map();
  for (const name of managedNames) snapshots.set(name, await maybeRead(safeRelativePath(installDir, name).absolute));
  const envPath = join(installDir, ".env");
  const versionPath = join(installDir, ".verified-release-assets-version");
  const envBytes = await maybeRead(envPath);
  const versionBytes = await maybeRead(versionPath);
  const stateBytes = await readFile(statePath);
  await mkdir(recoveryDir, { recursive: true });
  const stateRecovery = join(recoveryDir, "install-state.json");
  await writeFile(stateRecovery, stateBytes);

  try {
    for (const [name, entry] of verified.entries) await atomicWrite(safeRelativePath(installDir, name).absolute, await readFile(entry.absolute));
    for (const name of oldEntries.keys()) {
      if (!verified.entries.has(name)) await rm(safeRelativePath(installDir, name).absolute, { force: true });
    }
    if (options.failAfter === "files") throw new Error("injected_failure:files");
    await atomicWrite(oldManifestPath, verified.manifestBytes);
    await atomicWrite(versionPath, Buffer.from(releaseTag));
    await atomicWrite(envPath, updateEnv(envBytes, releaseTag, ghcrOwner));
    if (options.failAfter === "identity") throw new Error("injected_failure:identity");
    await updateInstallState(statePath, current => ({
      ...current,
      installerVersion: releaseTag,
      lastSuccessfulInstallVersion: releaseTag,
      // installDir is the promoter's bind-mount path (/host-source), not the
      // durable host identity (for example D:\\DPF). Preserve the installer-
      // recorded host path across the container boundary.
      installPath: current?.installPath ?? installDir,
      installMode: current?.installMode ?? "consumer",
      imageTag: releaseTag,
    }), { recoveryPath: stateRecovery, runId: process.env.DPF_SELF_UPGRADE_RUN_ID });
    if (options.failAfter === "state") throw new Error("injected_failure:state");
  } catch (error) {
    for (const [name, bytes] of snapshots) {
      const path = safeRelativePath(installDir, name).absolute;
      if (bytes === null) await rm(path, { force: true }); else await atomicWrite(path, bytes);
    }
    if (oldManifestBytes === null) await rm(oldManifestPath, { force: true }); else await atomicWrite(oldManifestPath, oldManifestBytes);
    if (versionBytes === null) await rm(versionPath, { force: true }); else await atomicWrite(versionPath, versionBytes);
    if (envBytes === null) await rm(envPath, { force: true }); else await atomicWrite(envPath, envBytes);
    if ((await readFile(statePath)).compare(stateBytes) !== 0) await restoreInstallState(statePath, stateRecovery);
    throw error;
  }
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 2) result[argv[i].replace(/^--/, "")] = argv[i + 1];
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  installReleaseAssets({
    sourceDir: args.source,
    installDir: args.install,
    statePath: args.state,
    releaseTag: args.tag,
    ghcrOwner: args.owner,
    recoveryDir: args.recovery,
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
