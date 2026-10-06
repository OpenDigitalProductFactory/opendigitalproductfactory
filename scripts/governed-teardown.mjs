#!/usr/bin/env node

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { inspectRepository } from "./salvage-sweep.mjs";

const exec = promisify(execFile);
const INSTALL_MOUNT = "/install";
const EVIDENCE_MOUNT = "/evidence";
const SECRET_FILE = "/run/secrets/dpf-runtime-transition";
const MAX_TTL_MS = 5 * 60_000;
const SCOPES = new Set(["containers", "volumes", "source", "everything"]);

export function canonical(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((child) => JSON.parse(canonical(child))));
  if (value && typeof value === "object") {
    const sorted = Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, JSON.parse(canonical(child))]));
    return JSON.stringify(sorted);
  }
  return JSON.stringify(value);
}

function isNestedPath(parent, child) {
  const windows = /^[A-Za-z]:[\\/]/.test(parent) && /^[A-Za-z]:[\\/]/.test(child);
  let left = parent.replaceAll("\\", "/").replace(/\/+$/, "");
  let right = child.replaceAll("\\", "/").replace(/\/+$/, "");
  if (windows) { left = left.toLowerCase(); right = right.toLowerCase(); }
  return right === left || right.startsWith(`${left}/`);
}

export function validateDeletionRoots({ installPath, backupsPath, installMount = INSTALL_MOUNT, evidenceMount = EVIDENCE_MOUNT }) {
  const normalizedInstall = installPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalizedLower = normalizedInstall.toLowerCase();
  const broadPosix = ["/etc", "/home", "/opt", "/root", "/srv", "/tmp", "/usr", "/users", "/var"].includes(normalizedLower) || /^\/(?:home|users)\/[^/]+$/i.test(normalizedInstall);
  const broadWindows = /^[a-z]:\/(?:documents and settings|program files(?: \(x86\))?|programdata|users|windows)$/i.test(normalizedInstall) || /^[a-z]:\/(?:documents and settings|users)\/[^/]+$/i.test(normalizedInstall);
  if (!normalizedInstall || normalizedInstall === "/" || /^[A-Za-z]:$/.test(normalizedInstall) || normalizedInstall.split("/").filter(Boolean).length < 2 || broadPosix || broadWindows) {
    throw new Error("unsafe_teardown_install_root");
  }
  if (isNestedPath(installPath, backupsPath)) throw new Error("teardown_evidence_inside_source");
  if (resolve(installMount) === resolve(evidenceMount) || isNestedPath(resolve(installMount), resolve(evidenceMount))) throw new Error("teardown_mounts_overlap");
}

export function buildComposeDownArgs({ composeProject, composeFiles, scope }) {
  const args = ["compose", "--project-name", composeProject];
  for (const file of composeFiles) args.push("-f", posix.join(INSTALL_MOUNT, file.replaceAll("\\", "/")));
  args.push("down", "--remove-orphans");
  // Do not remove images here: this finalizer is itself running from the local
  // lifecycle image. Volume deletion is the fresh-install boundary; image
  // garbage collection is a separate, non-critical host concern.
  if (scope === "volumes" || scope === "everything") args.push("--volumes");
  return args;
}

export async function removeTreeContentsNoFollow(root) {
  const receipt = { linksUnlinked: 0, filesDeleted: 0, directoriesDeleted: 0 };
  async function removeEntry(target) {
    const stat = await lstat(target);
    if (stat.isSymbolicLink()) {
      await rm(target, { force: true });
      receipt.linksUnlinked += 1;
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of await readdir(target)) await removeEntry(join(target, entry));
      await rmdir(target);
      receipt.directoriesDeleted += 1;
      return;
    }
    await rm(target, { force: true });
    receipt.filesDeleted += 1;
  }
  for (const entry of await readdir(root)) await removeEntry(join(root, entry));
  return receipt;
}

export function salvageFingerprint(report) {
  const bounded = {
    classification: report.classification ?? null,
    dirtyPaths: report.dirtyPaths ?? 0,
    stashes: report.stashes ?? 0,
    unreachableCommits: report.unreachableCommits ?? 0,
    branches: (report.branches ?? []).map(({ branch, commitsUnreachableFromRemotes }) => ({ branch, commitsUnreachableFromRemotes })),
    atRisk: Boolean(report.atRisk),
    error: report.error ?? null,
  };
  return createHash("sha256").update(canonical(bounded)).digest("hex");
}

function validateEnvelope(envelope, now = Date.now()) {
  if (envelope?.schemaVersion !== 1 || envelope.kind !== "installation-teardown") throw new Error("teardown_plan_schema_invalid");
  if (!/^TDR-[A-Z0-9]{8,32}$/.test(envelope.runId)) throw new Error("teardown_run_id_invalid");
  if (!SCOPES.has(envelope.scope)) throw new Error("teardown_scope_invalid");
  const issuedAt = Date.parse(envelope.issuedAt);
  const expiresAt = Date.parse(envelope.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TTL_MS) throw new Error("teardown_plan_time_invalid");
  if (now > expiresAt || issuedAt - now > 30_000) throw new Error("teardown_plan_expired");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(envelope.composeProject)) throw new Error("teardown_project_invalid");
  if (!Array.isArray(envelope.composeFiles) || envelope.composeFiles.length === 0 || envelope.composeFiles.some((file) => typeof file !== "string" || file.startsWith("/") || /^[A-Za-z]:/.test(file) || file.split(/[\\/]/).includes(".."))) throw new Error("teardown_compose_files_invalid");
  const destructive = envelope.scope !== "containers";
  if (destructive && (envelope.confirmation?.mode !== "pointer-hold" || envelope.confirmation.heldForMs < 2_000)) throw new Error("teardown_human_confirmation_missing");
  if ((envelope.scope === "volumes" || envelope.scope === "everything") && (envelope.recovery?.trialStatus !== "ok" || !/^[a-f0-9]{64}$/.test(envelope.recovery?.backupSha256 ?? ""))) throw new Error("teardown_recovery_unverified");
  if (envelope.scope === "source" || envelope.scope === "everything") validateDeletionRoots({ installPath: envelope.installPath, backupsPath: envelope.backupsPath });
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function runDocker(args) {
  const result = await exec("docker", args, { maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function createSourceRecovery(runDirectory) {
  const repository = inspectRepository(INSTALL_MOUNT);
  await atomicJson(join(runDirectory, "salvage.json"), repository);
  try {
    await exec("git", ["-C", INSTALL_MOUNT, "bundle", "create", join(runDirectory, "source.bundle"), "--all"], { windowsHide: true });
    const { stdout: diff } = await exec("git", ["-C", INSTALL_MOUNT, "diff", "--binary", "HEAD"], { maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const { stdout: untracked } = await exec("git", ["-C", INSTALL_MOUNT, "ls-files", "--others", "--exclude-standard", "-z"], { encoding: "buffer", maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    await writeFile(join(runDirectory, "working-tree.patch"), diff);
    await writeFile(join(runDirectory, "untracked.paths"), untracked);
    const linkTargets = {};
    for (const relative of untracked.toString("utf8").split("\0").filter(Boolean)) {
      if (relative.split(/[\\/]/).includes("..")) throw new Error("unsafe_untracked_path");
      const source = join(INSTALL_MOUNT, relative);
      const target = join(runDirectory, "untracked", relative);
      const stat = await lstat(source);
      await mkdir(dirname(target), { recursive: true });
      if (stat.isSymbolicLink()) {
        linkTargets[relative] = await readlink(source);
      } else if (stat.isFile()) {
        await copyFile(source, target);
      }
    }
    await atomicJson(join(runDirectory, "untracked-links.json"), linkTargets);
  } catch (error) {
    throw new Error(`teardown_source_salvage_failed:${error instanceof Error ? error.message : String(error)}`);
  }
  return repository;
}

export async function executeTeardown({ envelope, signature, secret, now = Date.now }) {
  validateEnvelope(envelope, now());
  const expected = createHmac("sha256", secret).update(canonical(envelope)).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) throw new Error("teardown_signature_invalid");

  const runDirectory = join(EVIDENCE_MOUNT, "teardown", envelope.runId);
  const evidencePath = join(runDirectory, "evidence.json");
  const existing = await readFile(evidencePath, "utf8").then(JSON.parse).catch(() => null);
  if (existing?.status === "completed") return existing;
  const evidence = {
    schemaVersion: 1,
    runId: envelope.runId,
    scope: envelope.scope,
    status: "planned",
    stage: "planned",
    startedAt: new Date(now()).toISOString(),
    completedStages: [],
    receipts: {},
  };
  await atomicJson(join(runDirectory, "plan.json"), { envelope, signatureDigest: createHash("sha256").update(signature).digest("hex") });
  await atomicJson(evidencePath, evidence);

  // The launcher must close the quiescence coordinator and return the durable
  // dispatch receipt to the browser before this sibling stops the portal.
  // A bounded grace period keeps that final handshake deterministic while the
  // signed envelope remains short-lived and already journaled externally.
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000));

  const mark = async (stage, receipt = {}) => {
    evidence.stage = stage;
    evidence.completedStages.push(stage);
    evidence.receipts[stage] = receipt;
    await atomicJson(evidencePath, evidence);
  };

  try {
    if (envelope.scope === "source" || envelope.scope === "everything") {
      evidence.status = "running";
      evidence.stage = "salvaging";
      await atomicJson(evidencePath, evidence);
      const salvage = await createSourceRecovery(runDirectory);
      const observedDigest = salvageFingerprint(salvage);
      if (observedDigest !== envelope.salvageDigest) throw new Error("teardown_salvage_changed");
      await mark("salvaging", { digest: observedDigest, atRisk: salvage.atRisk });
    }

    evidence.stage = "stopping";
    await atomicJson(evidencePath, evidence);
    const compose = await runDocker(buildComposeDownArgs(envelope));
    await mark("stopping", { stdoutTail: compose.stdout.slice(-1000), stderrTail: compose.stderr.slice(-1000) });
    if (envelope.scope === "volumes" || envelope.scope === "everything") await mark("deleting-volumes", { composeProject: envelope.composeProject });

    if (envelope.scope === "source" || envelope.scope === "everything") {
      evidence.stage = "deleting-source";
      await atomicJson(evidencePath, evidence);
      const receipt = await removeTreeContentsNoFollow(INSTALL_MOUNT);
      await mark("deleting-source", receipt);
    }

    evidence.status = "completed";
    evidence.stage = "completed";
    evidence.completedAt = new Date(now()).toISOString();
    await atomicJson(evidencePath, evidence);
    return evidence;
  } catch (error) {
    evidence.status = "failed";
    evidence.failure = error instanceof Error ? error.message : String(error);
    evidence.completedAt = new Date(now()).toISOString();
    await atomicJson(evidencePath, evidence);
    throw error;
  }
}

async function main() {
  const encoded = process.env.DPF_TEARDOWN_ENVELOPE ?? "";
  const signature = process.env.DPF_TEARDOWN_SIGNATURE ?? "";
  if (!encoded || !signature) throw new Error("teardown_handoff_missing");
  const envelope = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  const secret = (await readFile(SECRET_FILE, "utf8")).trim();
  if (secret.length < 32) throw new Error("teardown_signing_secret_invalid");
  await executeTeardown({ envelope, signature, secret });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 78;
  });
}
