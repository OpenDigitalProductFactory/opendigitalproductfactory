#!/usr/bin/env node
import { parseArgs as utilParseArgs } from "node:util";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, mkdir, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { restoreInstallState, updateInstallState } from "./install-state-transaction.mjs";

const VERSION = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,253}[A-Za-z0-9])?$/;

const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_ENV_BYTES = 1024 * 1024;
const ENV_READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

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

const sameEnvIdentity = (left, right) => left !== null && right !== null && left.dev === right.dev && left.ino === right.ino;
const sameEnvVersion = (left, right) => sameEnvIdentity(left, right)
  && ["size", "mtimeNs", "ctimeNs", "mtimeMs", "ctimeMs"].every(key => left[key] === right[key]);

async function readEnvDescriptor(handle) {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size > BigInt(MAX_ENV_BYTES)) throw new Error("remote_action_dispatch_input_invalid");
  const bytes = Buffer.alloc(Number(before.size));
  let count = 0;
  while (count < bytes.length) {
    // Position is explicit: the caller may already have consumed this handle.
    const { bytesRead } = await handle.read(bytes, count, bytes.length - count, count);
    if (!bytesRead) break;
    count += bytesRead;
  }
  if (count !== bytes.length || !sameEnvVersion(before, await handle.stat({ bigint: true }))) {
    throw new Error("remote_action_dispatch_input_changed");
  }
  return { bytes, identity: before };
}

async function readEnvSnapshot(path) {
  let handle;
  try { handle = await open(path, ENV_READ_FLAGS); }
  catch (error) { if (error?.code === "ENOENT") return { bytes: null, identity: null }; throw error; }
  try {
    const snapshot = await readEnvDescriptor(handle);
    // Bind the inspected descriptor to a fresh observation of the pathname.
    // Hard-link aliases are supported; this is not an exclusive-writer lock.
    const current = await open(path, ENV_READ_FLAGS);
    try {
      if (!sameEnvVersion(snapshot.identity, await current.stat({ bigint: true }))) {
        throw new Error("remote_action_dispatch_input_changed");
      }
    } finally { await current.close(); }
    return snapshot;
  } finally { await handle.close(); }
}

async function sameFileSnapshot(path, expected) {
  const current = await readEnvSnapshot(path);
  return (current.bytes === null ? expected.bytes === null : expected.bytes !== null && current.bytes.equals(expected.bytes))
    && (current.identity === null ? expected.identity === null : sameEnvIdentity(current.identity, expected.identity));
}

async function atomicWrite(path, bytes, expected) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes);
    const identity = await lstat(temporary, { bigint: true });
    // Optimistic conflict check immediately before replacement, not filesystem CAS.
    if (expected && !await sameFileSnapshot(path, expected)) throw new Error("release_env_input_changed");
    await rename(temporary, path);
    return identity;
  }
  finally { await rm(temporary, { force: true }); }
}

// BI-FEE77B68: compose publishes every host port through this variable. A
// fresh install gets loopback (kernel decision DI-946636F6E8F6). An install
// that predates the key keeps the all-interfaces exposure it already has, and
// says so in its .env, rather than losing LAN access on an upgrade.
export const HOST_BIND_KEY = "DPF_HOST_BIND_ADDRESS";
export const HOST_BIND_FRESH = "127.0.0.1";
export const HOST_BIND_PRE_EXISTING = "0.0.0.0";

// BI-C26D5DC5: the Git update receiver's signing secret. promote.sh exports the
// value the recreated portal was started with; persisting that same value keeps
// the running portal and the install .env in step. A real value is never
// replaced, because the operator may have pasted it into the repository webhook.
export const GIT_WEBHOOK_SECRET_KEY = "DPF_GIT_WEBHOOK_SECRET";

function hasRealValue(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  const value = match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  return value.length > 0 && !value.startsWith("<");
}

export function ensureGitWebhookSecret(text, newline, secret = process.env[GIT_WEBHOOK_SECRET_KEY]) {
  if (hasRealValue(text, GIT_WEBHOOK_SECRET_KEY)) return text;
  const value = secret && secret.trim() ? secret.trim() : randomBytes(32).toString("hex");
  const pattern = new RegExp(`^${GIT_WEBHOOK_SECRET_KEY}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, `${GIT_WEBHOOK_SECRET_KEY}=${value}`);
  const why = "# Signing secret for GitHub update deliveries (BI-C26D5DC5). Paste into the repository webhook Secret field.";
  return `${text}${text && !text.endsWith("\n") ? newline : ""}${why}${newline}${GIT_WEBHOOK_SECRET_KEY}=${value}${newline}`;
}

// BI-8541D491: the HMAC key GPP permits are signed with. Same contract as the
// webhook secret: promote.sh exports the value the recreated portal was started
// with, this persists that same value, and a real value is never replaced,
// because rotating it would invalidate every outstanding permit.
export const GPP_PERMIT_SECRET_KEY = "DPF_GPP_PERMIT_SECRET";

export function ensureGppPermitSecret(text, newline, secret = process.env[GPP_PERMIT_SECRET_KEY]) {
  if (hasRealValue(text, GPP_PERMIT_SECRET_KEY)) return text;
  const value = secret && secret.trim() ? secret.trim() : randomBytes(32).toString("hex");
  const pattern = new RegExp(`^${GPP_PERMIT_SECRET_KEY}=.*$`, "m");
  if (pattern.test(text)) return text.replace(pattern, `${GPP_PERMIT_SECRET_KEY}=${value}`);
  const why = "# Signing key for GPP permits (BI-8541D491). Generated by the self-upgrade; never rotated.";
  return `${text}${text && !text.endsWith("\n") ? newline : ""}${why}${newline}${GPP_PERMIT_SECRET_KEY}=${value}${newline}`;
}

// BI-F6929F50: dedicated signing keys for attention reach links and coworker
// delegation receipts; BI-231A4BC7: self-upgrade target bindings and delivery
// task hub cursors. Same contract as the GPP permit key: promote.sh exports
// the value the recreated portal was started with, this persists that same
// value, and a real value is never replaced, because rotating it would
// invalidate every outstanding signed handle.
export const DEDICATED_SIGNING_KEYS = Object.freeze([
  "DPF_ATTENTION_REACH_SECRET",
  "DPF_DELEGATION_RECEIPT_SECRET",
  "DPF_SELF_UPGRADE_TARGET_BINDING_SECRET",
  "DPF_DELIVERY_TASK_CURSOR_SECRET",
]);

export function ensureDedicatedSigningKeys(text, newline, env = process.env) {
  for (const key of DEDICATED_SIGNING_KEYS) {
    if (hasRealValue(text, key)) continue;
    const secret = env[key];
    const value = secret && secret.trim() ? secret.trim() : randomBytes(32).toString("hex");
    const pattern = new RegExp(`^${key}=.*$`, "m");
    if (pattern.test(text)) {
      text = text.replace(pattern, `${key}=${value}`);
      continue;
    }
    const why = `# Signing key ${key} (BI-F6929F50, BI-231A4BC7). Generated by the self-upgrade; never rotated.`;
    text = `${text}${text && !text.endsWith("\n") ? newline : ""}${why}${newline}${key}=${value}${newline}`;
  }
  return text;
}

// BI-3267763F: Inngest signing and event keys. Compose used to fall back to
// values published in the repository, so installs verified /api/inngest
// signatures against a public key. promote.sh exports the value the recreated
// portal and inngest were started with; persisting that same value keeps them
// and the install .env in step. Unlike the webhook secret, a known public
// default is replaced, not kept.
export const INNGEST_KEYS = ["INNGEST_SIGNING_KEY", "INNGEST_EVENT_KEY"];
export const INNGEST_PUBLIC_DEFAULTS = new Set(["abcdef0123456789", "deadbeefcafebabe"]);

function envValue(text, key) {
  const matches = [...text.matchAll(new RegExp(`^${key}=(.*)$`, "gm"))];
  const last = matches.at(-1);
  return last ? last[1].trim().replace(/^["']|["']$/g, "") : "";
}

export function isRealInngestKey(value) {
  return typeof value === "string" && value.length > 0 && !value.startsWith("<") && !INNGEST_PUBLIC_DEFAULTS.has(value);
}

export function ensureInngestKeys(text, newline, exported = process.env) {
  for (const key of INNGEST_KEYS) {
    if (isRealInngestKey(envValue(text, key))) continue;
    const candidate = exported[key]?.trim();
    const value = isRealInngestKey(candidate) ? candidate : randomBytes(32).toString("hex");
    const pattern = new RegExp(`^${key}=.*$`, "gm");
    if (pattern.test(text)) {
      text = text.replace(pattern, `${key}=${value}`);
      continue;
    }
    const why = `# Inngest ${key} (BI-3267763F). Portal and inngest must share it.`;
    text = `${text}${text && !text.endsWith("\n") ? newline : ""}${why}${newline}${key}=${value}${newline}`;
  }
  return text;
}

// BI-084F85E5: the PKI bootstrap turns the remote-action channel on when it
// writes the trust bundle (BI-28EFE18A), but only on a fresh bootstrap. An
// install whose trust bundle predates that has the channel configured and off,
// so the host-upkeep agent can never be dispatched to. Converge it here, on
// every upgrade; an operator's explicit value, including 0, is kept.
export const REMOTE_ACTION_DISPATCH_KEY = "DPF_REMOTE_ACTION_DISPATCH_ENABLED";
export const EDGE_ACTION_DISPATCH_CONFIGURED_KEY = "DPF_EDGE_ACTION_DISPATCH_CONFIGURED";

function dispatchEnvEntry(text, key) {
  const lines = text.split(/\r?\n/).filter(line => new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}(?:[ \\t=]|$)`).test(line));
  if (lines.length > 1) throw new Error("remote_action_dispatch_input_ambiguous");
  if (!lines.length) return { present: false, value: "" };
  const match = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=(.*)$`).exec(lines[0]);
  if (!match) throw new Error("remote_action_dispatch_input_invalid");
  const raw = match[1].trim();
  const quoted = /^(?:"([^"]*)"|'([^']*)')(?:\s*#.*)?$/.exec(raw);
  return { present: true, value: quoted ? quoted[1] ?? quoted[2] : raw.replace(/\s+#.*$/, "").trim() };
}

export function resolveRemoteActionDispatch(text, environment = {}) {
  const configured = dispatchEnvEntry(text, EDGE_ACTION_DISPATCH_CONFIGURED_KEY);
  const dispatch = dispatchEnvEntry(text, REMOTE_ACTION_DISPATCH_KEY);
  const intentSha256 = sha256(JSON.stringify({ configured, dispatch }));
  let resolution = "preserve";
  if (!Object.hasOwn(environment, REMOTE_ACTION_DISPATCH_KEY) && !dispatch.present) {
    const override = Object.hasOwn(environment, EDGE_ACTION_DISPATCH_CONFIGURED_KEY);
    if ((override ? environment[EDGE_ACTION_DISPATCH_CONFIGURED_KEY] : configured.value) === "1") {
      resolution = override ? "derive-once" : "derive-persist";
    }
  }
  return { resolution, intentSha256 };
}

export function ensureRemoteActionDispatch(text, newline, context = {}) {
  // A derived override belongs to this procedure; a real invocation override
  // never becomes durable intent. Only the promoter passes a bound resolution.
  const decision = resolveRemoteActionDispatch(text, context.resolution === "derive-persist" ? {} : context.environment);
  if (context.resolution !== undefined) {
    if (!["preserve", "derive-once", "derive-persist"].includes(context.resolution)
      || !/^[a-f0-9]{64}$/.test(context.intentSha256 ?? "")
      || decision.intentSha256 !== context.intentSha256) throw new Error("remote_action_dispatch_intent_changed");
    if (context.resolution !== "derive-persist") return text;
    if (decision.resolution !== "derive-persist") throw new Error("remote_action_dispatch_intent_changed");
  }
  if (decision.resolution !== "derive-persist") return text;
  return `${text}${text && !text.endsWith("\n") ? newline : ""}${REMOTE_ACTION_DISPATCH_KEY}=1${newline}`;
}

export async function persistRemoteActionDispatch({ envPath, recoveryDir, resolution, intentSha256, failAfter, onCheckpoint }) {
  if (resolution !== "derive-persist") return { status: "unchanged" };
  const handle = await open(envPath, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let checkpoint;
  let checkpointOwned = false;
  try {
    const { bytes, identity: before } = await readEnvDescriptor(handle);
    await mkdir(recoveryDir, { recursive: true, mode: 0o700 });
    checkpoint = join(recoveryDir, "dispatch-env.json");
    await writeFile(join(recoveryDir, "env.before"), bytes, { flag: "wx", mode: 0o600 });
    await writeFile(checkpoint, JSON.stringify({ state: "prepared", intentSha256 }) + "\n", { flag: "wx", mode: 0o600 });
    checkpointOwned = true;
    const text = bytes.toString("utf8");
    const next = ensureRemoteActionDispatch(text, text.includes("\r\n") ? "\r\n" : "\n", { resolution, intentSha256 });
    const current = await readEnvSnapshot(envPath);
    if (!sameEnvIdentity(current.identity, before) || !current.bytes?.equals(bytes)) throw new Error("remote_action_dispatch_input_changed");
    const suffix = Buffer.from(next.slice(text.length));
    if (failAfter === "checkpoint") throw new Error("injected_failure:checkpoint");
    const written = await handle.write(suffix, 0, suffix.length, bytes.length);
    if (written.bytesWritten !== suffix.length) throw new Error("remote_action_dispatch_partial_write");
    await handle.sync();
    if (failAfter === "append") throw new Error("injected_failure:append");
    await onCheckpoint?.("after-append");
    const after = await readEnvSnapshot(envPath);
    if (!sameEnvIdentity(after.identity, before) || !after.bytes?.equals(Buffer.from(next))) throw new Error("remote_action_dispatch_readback_unproven");
    await writeFile(checkpoint, JSON.stringify({ state: "persisted", intentSha256 }) + "\n", { mode: 0o600 });
    return { status: "persisted" };
  } catch (cause) {
    if (checkpointOwned) await writeFile(checkpoint, JSON.stringify({ state: "unproven", intentSha256 }) + "\n", { mode: 0o600 }).catch(() => {});
    // The portal was already swapped. Neither a file snapshot nor unwinding
    // this process proves its running configuration was restored.
    throw new Error("remote_action_dispatch_persistence_unproven", { cause });
  } finally { await handle.close(); }
}

export function updateEnv(bytes, releaseTag, ghcrOwner, dispatchContext = {}) {
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
  text = ensureGitWebhookSecret(text, newline);
  text = ensureGppPermitSecret(text, newline);
  text = ensureDedicatedSigningKeys(text, newline);
  text = ensureInngestKeys(text, newline);
  text = ensureRemoteActionDispatch(text, newline, dispatchContext);
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
  const versionBytes = await maybeRead(versionPath);
  const stateBytes = await readFile(statePath);
  await mkdir(recoveryDir, { recursive: true });
  const stateRecovery = join(recoveryDir, "install-state.json");
  await writeFile(stateRecovery, stateBytes);
  let envBeforeWrite;
  let envWritten;
  let envWriteIdentity;

  try {
    for (const [name, entry] of verified.entries) await atomicWrite(safeRelativePath(installDir, name).absolute, await readFile(entry.absolute));
    for (const name of oldEntries.keys()) {
      if (!verified.entries.has(name)) await rm(safeRelativePath(installDir, name).absolute, { force: true });
    }
    // Local fixture boundary only; this callback is never exposed by the CLI.
    await options.onCheckpoint?.("assets-installed");
    if (options.failAfter === "files") throw new Error("injected_failure:files");
    await atomicWrite(oldManifestPath, verified.manifestBytes);
    await atomicWrite(versionPath, Buffer.from(releaseTag));
    envBeforeWrite = await readEnvSnapshot(envPath);
    const nextEnv = updateEnv(envBeforeWrite.bytes, releaseTag, ghcrOwner, {
      environment: process.env, resolution: options.remoteActionResolution, intentSha256: options.remoteActionIntentSha256,
    });
    envWriteIdentity = await atomicWrite(envPath, nextEnv, envBeforeWrite);
    envWritten = nextEnv;
    await options.onCheckpoint?.("env-written");
    let observedEnv;
    try { observedEnv = await readEnvSnapshot(envPath); }
    catch (cause) { throw new Error("release_env_readback_unproven", { cause }); }
    if (!sameEnvIdentity(observedEnv.identity, envWriteIdentity) || !observedEnv.bytes?.equals(nextEnv)) throw new Error("release_env_readback_unproven");
    await options.onCheckpoint?.("env-committed");
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
    let envRollbackUnproven = false;
    if (envWriteIdentity) {
      const expected = { bytes: envWritten, identity: envWriteIdentity };
      try {
        if (!await sameFileSnapshot(envPath, expected)) envRollbackUnproven = true;
        else {
          if (envBeforeWrite.bytes === null) await rm(envPath, { force: true });
          else await atomicWrite(envPath, envBeforeWrite.bytes, expected);
        }
      } catch { envRollbackUnproven = true; }
    }
    if ((await readFile(statePath)).compare(stateBytes) !== 0) await restoreInstallState(statePath, stateRecovery);
    if (envRollbackUnproven) throw new Error("release_env_rollback_unproven", { cause: error });
    throw error;
  }
}

function parseArgs(argv) {
  // strict: false keeps the old tolerance: unknown flags are ignored.
  const { values } = utilParseArgs({
    args: argv,
    strict: false,
    allowPositionals: true,
    options: Object.fromEntries(["source", "install", "state", "tag", "owner", "recovery", "remote-action", "install-env", "remote-action-resolution", "remote-action-intent-sha256"].map((name) => [name, { type: "string" }])),
  });
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, typeof value === "string" ? value : undefined]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const run = async () => {
    if (args["remote-action"] === "resolve") {
      const input = await readEnvSnapshot(args["install-env"]);
      const decision = resolveRemoteActionDispatch(input.bytes?.toString("utf8") ?? "", process.env);
      console.log(`${decision.resolution}:${decision.intentSha256}`);
      return;
    }
    if (args["remote-action"] === "persist") {
      await persistRemoteActionDispatch({ envPath: args["install-env"], recoveryDir: args.recovery,
        resolution: args["remote-action-resolution"], intentSha256: args["remote-action-intent-sha256"] });
      return;
    }
    if (args["remote-action"] !== undefined) throw new Error("remote_action_dispatch_operation_invalid");
    await installReleaseAssets({
      sourceDir: args.source,
      installDir: args.install,
      statePath: args.state,
      releaseTag: args.tag,
      ghcrOwner: args.owner,
      recoveryDir: args.recovery,
      remoteActionResolution: args["remote-action-resolution"], remoteActionIntentSha256: args["remote-action-intent-sha256"],
    });
  };
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
}
