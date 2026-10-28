// scripts/lib/guard-outcome-record.mjs
//
// BI-FEDD8F45 — one guard outcome record per runner invocation.
// Design: the 2026-10-14 guard outcome efficacy design spec, §4.1–§4.4.
// Submission lives in guard-outcome-submit.mjs, so the guard loop (which only
// spools) never reaches the MCP client.
//
// The record is what lets the platform say, per guard, how often it caught a
// real defect, how often it refused correct work and what it cost. Runners
// (pregate preflight, the guard loop, pre-push-gate) build it, SPOOL it under
// the git common dir and, where a credential exists, submit the spool through
// the `guardOutcomes` payload of `record_external_development_evidence`. The
// platform writes the row; this module never does.
//
// Recording is observation, never a verdict: every function a runner calls on
// its exit path returns a result instead of throwing, so a full disk, a dead
// portal or a malformed declaration cannot change a guard's exit code.

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";

export const GUARD_OUTCOME_SCHEMA = "guard-outcome-run.v1";
export const GUARD_OUTCOME_RUNNERS = Object.freeze(["pregate", "pre-push-gate", "guard-loop"]);
export const GUARD_VERDICTS = Object.freeze(["passed", "refused", "self-test-failed", "runner-failed", "skipped"]);
export const GUARD_KINDS = Object.freeze(["guard", "aggregate", "hook"]);
export const GUARD_OVERRIDE_KINDS = Object.freeze(["skip-env", "local-ci-override", "gate-infrastructure-unavailable"]);
export const GUARD_DECLARATIONS_PATH = "scripts/guard-declarations.json";
export const SPOOL_DIRECTORY_NAME = "dpf-guard-outcomes";
export const FLUSH_BATCH_SIZE = 20;
export const FLUSH_TIMEOUT_MS = 3_000;
export const OVERRIDE_REASON_LIMIT = 500;

const SHA_RE = /^[0-9a-f]{40}$/;
const DIGEST_RE = /^[0-9a-f]{64}$/;
const CLONE_KEY_RE = /^[0-9a-f]{16}$/;
const GUARD_ID_RE = /^(loop|policy|hook):[A-Za-z0-9._-]{1,120}$/;
const RELATIVE_IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;

export function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function toRepoPath(absolute, repoRoot) {
  return relative(repoRoot, absolute).split("\\").join("/");
}

/**
 * Digest a set of repository files. Sorted, path-qualified and tolerant of a
 * missing file (recorded as missing), so the digest changes exactly when one of
 * the files changes, appears or disappears.
 */
export function digestFiles(paths, { repoRoot = process.cwd(), readFile = readFileSync } = {}) {
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    hash.update(path).update("\0");
    try {
      hash.update(readFile(isAbsolute(path) ? path : join(repoRoot, path)));
    } catch {
      hash.update("<missing>");
    }
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * The file plus every file it reaches through relative imports, as repo paths.
 * Package imports (`node:*`, `@dpf/*`, npm) are not followed: a guard's
 * behaviour lives in the repository files it imports. Cycle-safe.
 */
export function importClosure(entryPath, { repoRoot = process.cwd(), readFile = readFileSync } = {}) {
  const seen = new Set();
  const pending = [normalize(isAbsolute(entryPath) ? entryPath : join(repoRoot, entryPath))];
  while (pending.length > 0) {
    const current = pending.pop();
    const key = toRepoPath(current, repoRoot);
    if (seen.has(key)) continue;
    seen.add(key);
    let source;
    try {
      source = String(readFile(current, "utf8"));
    } catch {
      continue; // a missing file is still part of the digest, as missing
    }
    for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
      const target = normalize(resolve(dirname(current), match[1]));
      if (/\.(mjs|cjs|js)$/.test(target)) pending.push(target);
    }
  }
  return [...seen].sort();
}

/** A guard-loop guard's version: the guard, its sibling self-test and their import closure. */
export function digestLoopGuard(guardFile, { repoRoot = process.cwd(), readFile = readFileSync } = {}) {
  const guardPath = `scripts/${guardFile}`;
  const testPath = guardPath.replace(/\.mjs$/, ".test.mjs");
  const files = new Set(importClosure(guardPath, { repoRoot, readFile }));
  for (const file of importClosure(testPath, { repoRoot, readFile })) files.add(file);
  return digestFiles([...files], { repoRoot, readFile });
}

/** Script files a policy guard command runs, in the order they appear. */
export function policyGuardScriptFiles(entry) {
  const files = [];
  for (const [, args = []] of entry?.commands ?? []) {
    for (const arg of args) {
      if (typeof arg === "string" && /^(scripts|apps|packages)\/.+\.(mjs|cjs|js|ts|mts|sh|ps1)$/.test(arg)) files.push(arg);
    }
  }
  return files;
}

/**
 * A policy guard's version: its command line plus the import closure of every
 * script those commands name. Editing the script, a helper it imports or the
 * command line all count as changing the guard.
 */
export function digestPolicyGuard(entry, { repoRoot = process.cwd(), readFile = readFileSync } = {}) {
  const commands = (entry?.commands ?? []).map(([command, args = []]) => [command, ...args]);
  const files = new Set();
  for (const script of policyGuardScriptFiles(entry)) {
    for (const file of importClosure(script, { repoRoot, readFile })) files.add(file);
  }
  return sha256Hex(`${JSON.stringify(commands)}\0${digestFiles([...files], { repoRoot, readFile })}`);
}

/** Read the declarations file. Missing or malformed reads as "nothing declared". */
export function loadGuardDeclarations({ repoRoot = process.cwd(), readFile = readFileSync } = {}) {
  try {
    const raw = readFile(join(repoRoot, GUARD_DECLARATIONS_PATH), "utf8");
    const guards = JSON.parse(raw)?.guards;
    return {
      guards: guards && typeof guards === "object" && !Array.isArray(guards) ? guards : {},
      raw: String(raw),
      digest: sha256Hex(String(raw)),
    };
  } catch {
    return { guards: {}, raw: null, digest: null };
  }
}

/** The baseline files a declaration names (design §4.1 `baselineDigest`). */
export function baselineDigestFor(guardId, guards = {}, { repoRoot, readFile } = {}) {
  const inputs = guards[guardId]?.baselineInputs;
  const files = Array.isArray(inputs) ? inputs.filter((p) => typeof p === "string" && p.trim()) : [];
  return files.length > 0 ? digestFiles(files, { repoRoot, readFile }) : null;
}

/** Map a policy-profile / preflight entry status onto the record's verdict vocabulary. */
export function policyStatusToVerdict(status) {
  switch (status) {
    case "passed": return "passed";
    case "failed": return "refused";
    case "skipped_environment": return "skipped";
    default: return "runner-failed"; // runner_failed, timed_out, cancelled, anything unknown
  }
}

/**
 * Policy entries whose child runner records its own per-guard results: their
 * refusals are the children's refusals, so they are cost, not catches (§4.1).
 */
export const AGGREGATE_POLICY_GUARD_IDS = Object.freeze(["repo-guard-loop"]);

/** Map classified preflight entries to `policy:` guard results. Unplanned ids are dropped. */
export function policyGuardResults(entries, plan, { repoRoot = process.cwd(), readFile = readFileSync, declarations = {} } = {}) {
  const planned = new Map((plan ?? []).map((entry) => [entry.id, entry]));
  const results = [];
  for (const entry of entries ?? []) {
    const definition = planned.get(entry.id);
    if (!definition) continue;
    const guardId = `policy:${entry.id}`;
    results.push(buildGuardResult({
      guardId,
      kind: AGGREGATE_POLICY_GUARD_IDS.includes(entry.id) ? "aggregate" : "guard",
      guardDigest: digestPolicyGuard(definition, { repoRoot, readFile }),
      baselineDigest: baselineDigestFor(guardId, declarations, { repoRoot, readFile }),
      verdict: policyStatusToVerdict(entry.status),
      durationMs: entry.durationMs,
    }));
  }
  return results;
}

export function buildGuardResult({ guardId, kind = "guard", guardDigest, baselineDigest = null, verdict, durationMs }) {
  return {
    guardId,
    kind,
    guardDigest,
    baselineDigest,
    verdict,
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The override a run carried, read from the environment the runner saw.
 * Only recorded overrides count; an unset variable is not an override.
 */
export function overrideFromEnv(env = process.env, { runner } = {}) {
  if (runner === "pregate" || runner === "guard-loop") {
    const reason = nonEmpty(env.DPF_SKIP_PREGATE_PREFLIGHT_REASON);
    if (reason) return { kind: "skip-env", code: "DPF_SKIP_PREGATE_PREFLIGHT_REASON", reason: reason.slice(0, OVERRIDE_REASON_LIMIT) };
  }
  if (runner === "pre-push-gate" && env.DPF_SKIP_PREPUSH_GATE === "1") {
    const reason = nonEmpty(env.DPF_SKIP_PREPUSH_GATE_REASON) ?? "";
    const code = reason.split(":")[0].trim();
    return code === "gate-infrastructure-unavailable"
      ? { kind: "gate-infrastructure-unavailable", code, reason: reason.slice(0, OVERRIDE_REASON_LIMIT) }
      : { kind: "local-ci-override", code: code || "unspecified", reason: reason.slice(0, OVERRIDE_REASON_LIMIT) };
  }
  return null;
}

/** Structural validation shared by the spool writer and its tests. Returns the failing fields. */
export function validateRunRecord(record) {
  const errors = [];
  if (record?.schema !== GUARD_OUTCOME_SCHEMA) errors.push("schema");
  if (typeof record?.runId !== "string" || !/^[0-9a-f-]{36}$/.test(record.runId)) errors.push("runId");
  if (!GUARD_OUTCOME_RUNNERS.includes(record?.runner)) errors.push("runner");
  if (typeof record?.startedAt !== "string" || Number.isNaN(Date.parse(record.startedAt))) errors.push("startedAt");
  if (!Number.isFinite(record?.durationMs) || record.durationMs < 0) errors.push("durationMs");
  const diff = record?.diff;
  if (!CLONE_KEY_RE.test(diff?.cloneKey ?? "")) errors.push("diff.cloneKey");
  if (!nonEmpty(diff?.branch)) errors.push("diff.branch");
  if (!SHA_RE.test(diff?.headSha ?? "")) errors.push("diff.headSha");
  if (diff?.baseSha !== null && !SHA_RE.test(diff?.baseSha ?? "")) errors.push("diff.baseSha");
  if (diff?.patchId !== null && !SHA_RE.test(diff?.patchId ?? "")) errors.push("diff.patchId");
  if (typeof diff?.dirty !== "boolean") errors.push("diff.dirty");
  if (record?.override !== null && !GUARD_OVERRIDE_KINDS.includes(record?.override?.kind)) errors.push("override");
  if (record?.declarationsDigest !== null && !DIGEST_RE.test(record?.declarationsDigest ?? "")) errors.push("declarationsDigest");
  if (!Array.isArray(record?.guards)) {
    errors.push("guards");
  } else {
    record.guards.forEach((guard, index) => {
      if (!GUARD_ID_RE.test(guard?.guardId ?? "")) errors.push(`guards[${index}].guardId`);
      if (!GUARD_KINDS.includes(guard?.kind)) errors.push(`guards[${index}].kind`);
      if (!DIGEST_RE.test(guard?.guardDigest ?? "")) errors.push(`guards[${index}].guardDigest`);
      if (guard?.baselineDigest !== null && !DIGEST_RE.test(guard?.baselineDigest ?? "")) errors.push(`guards[${index}].baselineDigest`);
      if (!GUARD_VERDICTS.includes(guard?.verdict)) errors.push(`guards[${index}].verdict`);
      if (!Number.isFinite(guard?.durationMs) || guard.durationMs < 0) errors.push(`guards[${index}].durationMs`);
    });
  }
  return errors;
}

export function buildRunRecord({
  runner,
  diff,
  guards,
  override = null,
  declarationsDigest = null,
  startedAt,
  durationMs,
  runId = randomUUID(),
}) {
  return {
    schema: GUARD_OUTCOME_SCHEMA,
    runId,
    runner,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
    diff: {
      cloneKey: diff?.cloneKey ?? "",
      branch: diff?.branch ?? "",
      baseSha: diff?.baseSha ?? null,
      headSha: diff?.headSha ?? "",
      patchId: diff?.patchId ?? null,
      dirty: diff?.dirty ?? false,
    },
    override,
    declarationsDigest,
    guards,
  };
}

function git(args, { cwd, exec, input }) {
  return String(exec("git", args, {
    cwd, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "ignore"],
  })).trim();
}

/** A stable key for this clone and worktree. Carries no path: a hash of host and location. */
export function cloneKeyFor(worktreePath, host = hostname()) {
  return sha256Hex(`${host}\0${resolve(worktreePath)}`).slice(0, 16);
}

/**
 * Branch, HEAD, merge base with origin/main, the change's patch id, whether the
 * tree was dirty, and the clone key. Unknown parts read as null; never throws.
 */
export function resolveDiffIdentity({ cwd = process.cwd(), exec = execFileSync, host } = {}) {
  const attempt = (args, input) => {
    try { return git(args, { cwd, exec, input }) || null; } catch { return null; }
  };
  const headSha = attempt(["rev-parse", "HEAD"]);
  const branch = attempt(["rev-parse", "--abbrev-ref", "HEAD"]);
  const baseSha = attempt(["merge-base", "HEAD", "origin/main"]);
  let patchId = null;
  if (baseSha && headSha && baseSha !== headSha) {
    const diff = attempt(["diff", "--no-color", "--no-ext-diff", baseSha, headSha]);
    const line = diff ? attempt(["patch-id", "--stable"], `${diff}\n`) : null;
    const id = line?.split(/\s+/)[0] ?? null;
    patchId = id && SHA_RE.test(id) ? id : null;
  }
  const status = attempt(["status", "--porcelain", "--untracked-files=no"]);
  return {
    cloneKey: cloneKeyFor(cwd, host),
    branch: branch && branch !== "HEAD" ? branch : null,
    headSha: headSha && SHA_RE.test(headSha) ? headSha : null,
    baseSha: baseSha && SHA_RE.test(baseSha) ? baseSha : null,
    patchId,
    dirty: Boolean(status),
  };
}

export function spoolDirectory({ cwd = process.cwd(), exec = execFileSync } = {}) {
  try {
    const common = git(["rev-parse", "--git-common-dir"], { cwd, exec });
    return common ? join(resolve(cwd, common), SPOOL_DIRECTORY_NAME) : null;
  } catch {
    return null;
  }
}

/**
 * Write the record to the spool. Never throws: a record that cannot be
 * written is reported, and the runner's verdict stands.
 */
export function spoolRecord(record, { directory, writeFile = writeFileSync, mkdir = mkdirSync } = {}) {
  const errors = validateRunRecord(record);
  if (errors.length > 0) return { ok: false, reason: `invalid record: ${errors.join(", ")}` };
  if (!directory) return { ok: false, reason: "no spool directory (not a git checkout)" };
  try {
    mkdir(directory, { recursive: true });
    const path = join(directory, `${record.runId}.json`);
    writeFile(path, `${JSON.stringify(record)}\n`);
    return { ok: true, path };
  } catch (error) {
    return { ok: false, reason: `spool write failed: ${error?.code ?? "error"}` };
  }
}

/** Read every spooled record, oldest name first; unreadable files are skipped and named. */
export function readSpool({ directory, readdir = readdirSync, readFile = readFileSync } = {}) {
  const records = [];
  const unreadable = [];
  let names = [];
  try {
    names = readdir(directory).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return { records, unreadable };
  }
  for (const name of names) {
    try {
      records.push({ name, record: JSON.parse(readFile(join(directory, name), "utf8")) });
    } catch {
      unreadable.push(name);
    }
  }
  return { records, unreadable };
}

export const QUARANTINE_DIRECTORY_NAME = "quarantine";
export const QUARANTINE_LIMIT = 200;
const COVERAGE_LOSS_FILE = "coverage-loss.json";

/**
 * The bounded quarantine of permanently refused records, with the running
 * count of every record ever quarantined. Entries are evidence of missing
 * telemetry: the oldest are dropped past the limit, the count never shrinks.
 */
export function readQuarantine({ directory, readdir = readdirSync, readFile = readFileSync } = {}) {
  const dir = join(directory, QUARANTINE_DIRECTORY_NAME);
  const entries = [];
  let coverageLoss = 0;
  try {
    coverageLoss = Number(JSON.parse(readFile(join(dir, COVERAGE_LOSS_FILE), "utf8"))?.count) || 0;
  } catch { /* none yet */ }
  let names = [];
  try {
    names = readdir(dir).filter((n) => n.endsWith(".json") && n !== COVERAGE_LOSS_FILE).sort();
  } catch {
    return { entries, coverageLoss };
  }
  for (const name of names) {
    try {
      const entry = JSON.parse(readFile(join(dir, name), "utf8"));
      entries.push({ name, runId: entry.runId, reason: entry.reason, quarantinedAt: entry.quarantinedAt });
    } catch { /* unreadable entries still count in coverageLoss */ }
  }
  return { entries, coverageLoss };
}

function quarantineRecord({ directory, name, record, reason, limit, now, readdir, readFile, writeFile, mkdir, unlink }) {
  const dir = join(directory, QUARANTINE_DIRECTORY_NAME);
  mkdir(dir, { recursive: true });
  const quarantinedAt = now();
  writeFile(join(dir, `${quarantinedAt.replace(/[:.]/g, "-")}-${name}`), `${JSON.stringify({ runId: record?.runId ?? null, reason, quarantinedAt, record })}
`);
  const { coverageLoss } = readQuarantine({ directory, readdir, readFile });
  writeFile(join(dir, COVERAGE_LOSS_FILE), `${JSON.stringify({ count: coverageLoss + 1 })}
`);
  const names = readdir(dir).filter((n) => n.endsWith(".json") && n !== COVERAGE_LOSS_FILE).sort();
  for (const old of names.slice(0, Math.max(0, names.length - limit))) {
    try { unlink(join(dir, old)); } catch { /* bounded best-effort */ }
  }
  unlink(join(directory, name));
}

/**
 * Submit the spool. A file leaves the spool only on a matching outcome:
 * acknowledged → deleted; refused as permanent (malformed, integrity conflict)
 * → moved to the bounded quarantine with its reason, never resubmitted, and
 * counted as coverage loss. Anything else (authorization, transport, a refusal
 * not marked permanent, no reply for the runId) stays pending for repair.
 * Never throws.
 */
export async function flushSpool({
  directory,
  call,
  declarations = null,
  readdir = readdirSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  mkdir = mkdirSync,
  unlink = unlinkSync,
  batchSize = FLUSH_BATCH_SIZE,
  quarantineLimit = QUARANTINE_LIMIT,
  now = () => new Date().toISOString(),
} = {}) {
  const summary = { submitted: 0, quarantined: [], pending: 0, error: null };
  if (!directory || typeof call !== "function") return { ...summary, error: "no-transport" };
  const { records } = readSpool({ directory, readdir, readFile });
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    let reply;
    try {
      reply = await call({
        records: batch.map(({ record }) => record),
        ...(declarations ? { declarations } : {}),
      });
    } catch (error) {
      summary.error = String(error?.message ?? error).slice(0, 200);
      summary.pending = records.length - start;
      return summary;
    }
    const acknowledged = new Set(Array.isArray(reply?.acknowledged) ? reply.acknowledged : []);
    const permanent = new Map(
      (Array.isArray(reply?.refused) ? reply.refused : [])
        .filter((r) => r?.permanent === true && typeof r?.runId === "string")
        .map((r) => [r.runId, String(r.reason ?? "refused").slice(0, 200)]),
    );
    for (const { name, record } of batch) {
      try {
        if (acknowledged.has(record?.runId)) {
          unlink(join(directory, name));
          summary.submitted += 1;
        } else if (permanent.has(record?.runId)) {
          const reason = permanent.get(record.runId);
          quarantineRecord({ directory, name, record, reason, limit: quarantineLimit, now, readdir, readFile, writeFile, mkdir, unlink });
          summary.quarantined.push({ runId: record.runId, reason });
        } else {
          summary.pending += 1;
        }
      } catch {
        summary.pending += 1; // a file that could not be moved resubmits; replay is content-checked
      }
    }
  }
  return summary;
}

/**
 * Spool a run and, when a credential resolves, flush. The one call a runner
 * makes. Never throws and never prints more than one line.
 */
export async function recordGuardRun({
  runner,
  guards,
  startedAt,
  durationMs,
  cwd = process.cwd(),
  env = process.env,
  exec = execFileSync,
  submit = async () => null,
  log = (line) => process.stderr.write(`${line}\n`),
}) {
  try {
    const declarations = loadGuardDeclarations({ repoRoot: cwd });
    const record = buildRunRecord({
      runner,
      guards,
      startedAt,
      durationMs,
      diff: resolveDiffIdentity({ cwd, exec }),
      override: overrideFromEnv(env, { runner }),
      declarationsDigest: declarations.digest,
    });
    const directory = spoolDirectory({ cwd, exec });
    const spooled = spoolRecord(record, { directory });
    if (!spooled.ok) {
      log(`[guard-outcome] not recorded: ${spooled.reason}`);
      return { spooled, flushed: null };
    }
    const flushed = await submit({ directory, env, declarations: declarations.raw });
    return { spooled, flushed };
  } catch (error) {
    log(`[guard-outcome] not recorded: ${String(error?.message ?? error).slice(0, 200)}`);
    return { spooled: { ok: false, reason: "exception" }, flushed: null };
  }
}

