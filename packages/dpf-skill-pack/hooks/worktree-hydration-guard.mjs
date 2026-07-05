#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/worktree-hydration-guard.mjs
//
// PreToolUse guard: refuse high-cost dependency hydration and runtime-bound
// gates inside topic worktrees. DPF worktrees are source-control isolation, not
// runtimes; runtime-bound verification goes through the shared local-CI lease.
//
// Decision protocol: to DENY, emit the PreToolUse permissionDecision JSON and
// exit 0; to WARN, emit additionalContext and exit 0; to ALLOW, exit 0 with no
// output. Fails OPEN on parse/IO errors so a hook bug never wedges the client.

import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const GUARD_MESSAGE =
  "This worktree is source-control isolation, not a runtime. Claim `local-integration-ci` and run the gate on the shared sandbox/canonical runner. Do not hydrate this worktree.";

const OVERRIDE_MESSAGE =
  "Emergency worktree hydration override: DPF_ALLOW_WORKTREE_HYDRATION=1 allowed a command that normally blocks in a topic worktree. Record an audit note in the Work Capsule/PR and remove generated artifacts when done.";

const GOVERNED_COMMAND_MARKERS = [
  /gate-worktree\.sh/,
  /claim_nonprod_environment_lease/,
];

const HYDRATION_SCRIPT_PATTERNS = [
  /(?:^|\s)(?:bash|sh)\s+scripts\/dpf-bootstrap-agent-toolchain\.sh\b/,
  /(?:^|\s)(?:bash|sh)\s+scripts\/ensure-dpf-skill-pack\.sh\b/,
  /(?:^|\s)(?:bash|sh)\s+packages\/dpf-skill-pack\/scripts\/update-agent-toolchain\.sh\b/,
  /(?:^|\s)node\s+scripts\/lib\/bootstrap-worktree-deps\.mjs\b/,
  /\bDPF_WORKTREE_BOOTSTRAP=1\b[^\n;|&]*seed-worktree-mcp\.sh\b/,
];

const RUNTIME_GATE_PATTERNS = [
  /\bnext\s+build\b/,
  /\bprisma\s+migrate\s+(dev|deploy|reset)\b/,
  /\bprisma\s+db\s+push\b/,
];

function normPath(value) {
  return String(value ?? "").replace(/\\/g, "/").replace(/\/+$/g, "") || "/";
}

function pathExists(path) {
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function parent(path) {
  const next = dirname(path);
  return next === path ? "" : next;
}

/** Find the repo/worktree root by walking upward to .git or the readiness marker. */
export function findWorkRoot(cwd, fs = {}) {
  const exists = fs.exists ?? pathExists;
  const dir = resolve(cwd || process.cwd());
  let current = dir;
  while (current) {
    if (exists(join(current, ".dpf-worktree-readiness.json")) || exists(join(current, ".git"))) {
      return current;
    }
    current = parent(current);
  }
  return dir;
}

function readReadinessState(root, fs = {}) {
  const exists = fs.exists ?? pathExists;
  const read = fs.readText ?? readText;
  const marker = join(root, ".dpf-worktree-readiness.json");
  if (!exists(marker)) return "";
  try {
    const parsed = JSON.parse(read(marker));
    return String(parsed?.state ?? "").trim();
  } catch {
    return "source-only";
  }
}

function isUnderTopicBase(root, env = {}) {
  const r = normPath(root);
  const home = normPath(env.HOME || env.USERPROFILE || "");
  if (home && r.startsWith(`${home}/dpf-worktrees/`)) return true;
  return (
    /\/dpf-worktrees\//.test(r) ||
    /\/DPF-worktrees\//.test(r) ||
    /\/\.claude\/worktrees\//.test(r)
  );
}

function isLocalCiRunner(root, env = {}) {
  const r = normPath(root);
  return (
    env.DPF_LOCAL_CI_RUNNER === "1" ||
    env.DPF_GOVERNED_LOCAL_CI === "1" ||
    env.COMPOSE_PROJECT_NAME === "dpf-local-ci" ||
    /\/\.dpf\/local-ci-sandbox(?:\/|$)/.test(r)
  );
}

function isCanonicalRunner(root, env = {}, fs = {}) {
  const dir = fs.isDir ?? isDir;
  return env.DPF_CANONICAL_RUNNER === "1" || dir(join(root, ".git"));
}

export function classifyWorktree(cwd, env = {}, fs = {}) {
  const root = findWorkRoot(cwd, fs);
  if (isLocalCiRunner(root, env)) return { kind: "local-ci", root, readiness: "runtime" };
  if (isCanonicalRunner(root, env, fs)) return { kind: "canonical", root, readiness: "runtime" };

  const readiness = readReadinessState(root, fs);
  if (readiness === "compile-ready" || readiness === "source-only") {
    return { kind: "topic-worktree", root, readiness };
  }

  const file = fs.isFile ?? isFile;
  if (isUnderTopicBase(root, env) || file(join(root, ".git"))) {
    return { kind: "topic-worktree", root, readiness: "source-only" };
  }

  return { kind: "unknown", root, readiness: "" };
}

function segments(command) {
  return String(command ?? "").split(/&&|\|\||[;|\n]/g).map((s) => s.trim()).filter(Boolean);
}

function tokenize(segment) {
  const raw = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, ""));
}

function stripLeadingEnv(tokens) {
  let index = 0;
  while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index])) index += 1;
  return tokens.slice(index);
}

function pnpmArgs(tokens) {
  const t = stripLeadingEnv(tokens);
  if (t[0] === "corepack" && t[1] === "pnpm") return t.slice(2);
  const index = t.findIndex((part) => part === "pnpm" || part.endsWith("/pnpm"));
  return index >= 0 ? t.slice(index + 1) : null;
}

function firstPnpmCommand(args) {
  if (!args) return "";
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") continue;
    if (arg === "-C" || arg === "--dir" || arg === "--filter" || arg === "-F") {
      i += 1;
      continue;
    }
    if (arg.startsWith("-C") || arg.startsWith("--dir=") || arg.startsWith("--filter=")) continue;
    if (arg.startsWith("-")) continue;
    return arg;
  }
  return "";
}

function isPnpmHydration(args) {
  const cmd = firstPnpmCommand(args);
  if (["install", "i", "add", "update", "up", "bootstrap"].includes(cmd)) return true;
  if (cmd === "run") {
    const script = firstPnpmCommand(args.slice(args.indexOf("run") + 1));
    return script === "bootstrap" || script === "postinstall";
  }
  return false;
}

function isPnpmRuntimeGate(args) {
  const joined = args ? args.join(" ") : "";
  const cmd = firstPnpmCommand(args);
  return (
    /^build$/.test(cmd) ||
    /\b--filter\s+web\b.*\bbuild\b/.test(joined) ||
    /\b--filter=web\b.*\bbuild\b/.test(joined) ||
    /\b--filter\s+web\b.*\bexec\s+next\s+build\b/.test(joined) ||
    /\b--filter=web\b.*\bexec\s+next\s+build\b/.test(joined) ||
    /^test$/.test(cmd)
  );
}

function isCheapSourceLocal(args) {
  const joined = args ? args.join(" ") : "";
  return (
    /\b--filter(?:=|\s+)[^\s]+\b.*\btypecheck\b/.test(joined) ||
    /\b--filter(?:=|\s+)[^\s]+\b.*\bexec\s+vitest\s+run\b/.test(joined) ||
    /\b--filter(?:=|\s+)[^\s]+\b.*\btest\b/.test(joined)
  );
}

function commandNeedsRuntime(command) {
  for (const segment of segments(command)) {
    if (HYDRATION_SCRIPT_PATTERNS.some((re) => re.test(segment))) return true;
    if (RUNTIME_GATE_PATTERNS.some((re) => re.test(segment))) return true;

    const args = pnpmArgs(tokenize(segment));
    if (!args) continue;
    if (isPnpmHydration(args) || isPnpmRuntimeGate(args)) return true;
  }
  return false;
}

function hasOverride(command, env = {}) {
  return env.DPF_ALLOW_WORKTREE_HYDRATION === "1" || /\bDPF_ALLOW_WORKTREE_HYDRATION=1\b/.test(command);
}

/**
 * Pure decision: should this Bash command be blocked in its current cwd?
 * @param {object} args
 * @param {string} args.command
 * @param {string} [args.cwd]
 * @param {Record<string,string|undefined>} [args.env]
 * @param {object} [args.fs]
 * @returns {{ action: "allow"|"block"|"warn", reason?: string }}
 */
export function decide({ command, cwd = "", env = {}, fs = {} }) {
  if (typeof command !== "string" || command.trim() === "") return { action: "allow" };
  if (GOVERNED_COMMAND_MARKERS.some((re) => re.test(command))) return { action: "allow" };

  const context = classifyWorktree(cwd || process.cwd(), env, fs);
  if (context.kind !== "topic-worktree") return { action: "allow" };

  const blocked = commandNeedsRuntime(command);
  if (!blocked) return { action: "allow" };

  if (hasOverride(command, env)) return { action: "warn", reason: OVERRIDE_MESSAGE };

  // Compile-ready means cheap source-local checks can run here; hydration and
  // runtime-bound gates still route through the canonical runner/sandbox.
  const onlyCheapSourceLocal = segments(command).every((segment) => {
    const args = pnpmArgs(tokenize(segment));
    return args ? isCheapSourceLocal(args) : false;
  });
  if (context.readiness === "compile-ready" && onlyCheapSourceLocal) return { action: "allow" };

  return { action: "block", reason: GUARD_MESSAGE };
}

function main() {
  let payload;
  try {
    const raw = readFileSync(0, "utf8");
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    process.exit(0);
  }

  if (payload?.tool_name !== "Bash") process.exit(0);
  const command = payload?.tool_input?.command ?? "";
  const cwd = payload?.tool_input?.workdir || payload?.cwd || process.cwd();
  const verdict = decide({ command, cwd, env: process.env });
  if (verdict.action === "allow") process.exit(0);

  const hookSpecificOutput =
    verdict.action === "block"
      ? { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: verdict.reason }
      : { hookEventName: "PreToolUse", additionalContext: verdict.reason };

  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
  process.exit(0);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("worktree-hydration-guard.mjs")) {
  main();
}
