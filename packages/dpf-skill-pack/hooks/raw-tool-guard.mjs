#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/raw-tool-guard.mjs
//
// PreToolUse guard (BI-F87BD9BF): refuse the RAW form of a command whose
// correct invocation in this repository carries a non-obvious wrapper, and
// print only the command to run instead.
//
// Why a hook and not prose: the knowledge already existed as prose — the
// header of scripts/run-tsc.mjs (BI-CD7706B5), a preflight warning
// (BI-99CAE42F), AGENTS.md §2 — and an agent that had read none of it ran
// `pnpm exec tsc --noEmit`, watched Node abort at its default 4 GB heap after
// 33 s, diagnosed an infrastructure error as if it were a code error, and
// retried. Every retry is paid for. A refusal that names the right command
// costs one line.
//
// Refused → redirected:
//   - bare `tsc` (also `pnpm exec tsc`, `pnpm tsc`, `npx tsc`)
//       → `pnpm --filter <pkg> typecheck` (scripts/run-tsc.mjs: the TypeScript 7
//         checker, or TS6 with its 8 GB heap under DPF_TSC=6 — BI-2B8D67A9)
//   - `vitest` from the WORKSPACE ROOT with no `--filter <pkg>`
//       → `pnpm --filter <pkg> exec vitest run <files>` (a root-level run
//         prunes sibling links — BI-99CAE42F)
//   - `npx <anything>`
//       → the `pnpm --filter <pkg> exec <tool>` form (AGENTS.md §2: npx
//         ignores pinned versions)
//
// Allowed: `node scripts/run-tsc.mjs …`, `pnpm --filter <pkg> typecheck`,
// `pnpm --filter <pkg> exec vitest …`, `pnpm exec vitest` run from inside a
// package directory, and anything under DPF_ALLOW_RAW_TOOL=1 (bypass, when the
// raw form is the point — e.g. reproducing the OOM).
//
// Shipped inside the dpf-platform plugin (hooks/hooks.json, matcher "Bash") so
// it travels to every surface; mirrors compose-guard.mjs. Decision protocol:
// REWRITE (Claude only, BI-F17F2188) = when planRewrite resolves the package,
// emit permissionDecision allow|ask with updatedInput carrying the rewritten
// command and additionalContext naming it; every other surface, and any command
// it cannot resolve, gets the DENY below.
// DENY = emit the PreToolUse permissionDecision JSON and exit 0; ALLOW = exit 0
// with no output. Fails OPEN on any parse/IO error.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
  surfaceCanRewrite,
} from "./lib/hook-io.mjs";

export const BYPASS_ENV = "DPF_ALLOW_RAW_TOOL";

const PACKAGE_DIR_RE = /(^|[\\/])(apps|packages|services)[\\/][^\\/]+[\\/]?$/;

/** Split a shell command on the operators that separate simple commands. */
function segments(command) {
  return String(command)
    .split(/\n|&&|\|\||;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Whitespace tokens with leading VAR=value assignments removed. */
function tokenize(segment) {
  const tokens = segment.split(/\s+/).filter(Boolean);
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
  return tokens;
}

/** True when this segment is a raw TypeScript compiler invocation. */
function isRawTsc(tokens) {
  if (tokens.length === 0) return false;
  const exe = tokens[0].replace(/^.*[\\/]/, "");
  if (exe === "tsc") return true;
  if (exe === "npx" && tokens[1] === "tsc") return true;
  if (exe === "pnpm" || exe === "yarn" || exe === "npm") {
    // pnpm [--filter x] [exec|run|dlx] tsc …  — any position after the manager
    return tokens.slice(1).some((t, i, rest) => t === "tsc" && (i === 0 || ["exec", "run", "dlx", "--"].includes(rest[i - 1]) || !rest[i - 1].startsWith("-")));
  }
  return false;
}

function hasFilter(tokens) {
  return tokens.some((t) => t === "--filter" || t === "-F" || t.startsWith("--filter="));
}

/** True when this segment runs vitest without a package scope. */
function isRootVitest(tokens, cwd) {
  if (tokens.length === 0) return false;
  const exe = tokens[0].replace(/^.*[\\/]/, "");
  const runsVitest = exe === "vitest" || (["pnpm", "npx", "yarn", "npm"].includes(exe) && tokens.slice(1).includes("vitest"));
  if (!runsVitest) return false;
  if (hasFilter(tokens)) return false;
  if (PACKAGE_DIR_RE.test(String(cwd ?? "").replace(/[\\/]+$/, ""))) return false; // inside a package dir
  if (tokens.some((t) => t === "-C" || t === "--dir" || t.startsWith("--dir="))) return false; // pnpm -C <pkg>
  return true;
}

function isNpx(tokens) {
  return tokens.length > 0 && tokens[0].replace(/^.*[\\/]/, "") === "npx";
}

const TSC_GUIDANCE =
  "Refused: a bare `tsc` runs the workspace's TypeScript 6 at Node's default heap, which aborts out of memory on this codebase (BI-CD7706B5), and is not the checker CI uses.\n" +
  "Run instead:  pnpm --filter <pkg> typecheck     (scripts/run-tsc.mjs runs the TypeScript 7 checker, BI-2B8D67A9; add :tests for the test program)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

const VITEST_GUIDANCE =
  "Refused: vitest from the workspace root without --filter prunes sibling links and runs the wrong config (BI-99CAE42F).\n" +
  "Run instead:  pnpm --filter <pkg> exec vitest run <files>     (e.g. --filter web)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

const NPX_GUIDANCE =
  "Refused: npx ignores the pinned versions in this workspace (AGENTS.md §2).\n" +
  "Run instead:  pnpm --filter <pkg> exec <tool> …     (or pnpm exec <tool> inside the package directory)\n" +
  `Raw form on purpose?  prefix with ${BYPASS_ENV}=1`;

/**
 * Pure decision. Exported for unit tests.
 * @param {{ command: string, cwd?: string, env?: Record<string, string|undefined> }} args
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ command, cwd = "", env = {} }) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };
  if (env[BYPASS_ENV] === "1" || new RegExp(`\\b${BYPASS_ENV}=1\\b`).test(command)) return { block: false };
  for (const seg of segments(command)) {
    const tokens = tokenize(seg);
    if (isRawTsc(tokens)) return { block: true, reason: TSC_GUIDANCE };
    if (isRootVitest(tokens, cwd)) return { block: true, reason: VITEST_GUIDANCE };
    if (isNpx(tokens)) return { block: true, reason: NPX_GUIDANCE };
  }
  return { block: false };
}

// ── rewrite instead of refuse (BI-F17F2188) ─────────────────────────────────
// 34 refusals in 26 Claude sessions over 21 days were deterministic: the agent
// retyped the command the refusal named. When the package resolves from the
// folder each segment runs in, the guard returns the rewritten command instead.
// It refuses whenever any step is uncertain: shell substitution, npx flags, a
// tool not pinned, a tsc flag typecheck cannot carry, files in two packages.

/** Split on shell operators outside quotes, keeping the operators. Null when the command is not plain enough to rewrite. */
function splitQuoted(command) {
  if (/`|\$\(|<<|\\/.test(command)) return null;
  const parts = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      cur += c;
      continue;
    }
    const two = command.slice(i, i + 2);
    const op = two === "&&" || two === "||" ? two : c === ";" || c === "|" || c === "\n" ? c : null;
    if (op) {
      parts.push(cur, op);
      cur = "";
      i += op.length - 1;
      continue;
    }
    cur += c;
  }
  if (quote) return null;
  parts.push(cur);
  return parts;
}

const posix = (p) => String(p ?? "").replace(/\\/g, "/").replace(/^\/([a-zA-Z])(\/|$)/, (_, d, s) => `${d.toUpperCase()}:${s || "/"}`);
const isAbs = (p) => /^[a-zA-Z]:\//.test(p) || p.startsWith("/");
const normalize = (p) => {
  const out = [];
  for (const part of p.split("/")) {
    if ((part === "" && out.length) || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/") || "/";
};
const resolvePath = (base, p) => {
  const t = posix(p);
  return normalize(isAbs(t) ? t : `${base}/${t}`);
};
const parentOf = (d) => d.replace(/\/[^/]+$/, "");

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function workspaceRootOf(dir) {
  for (let d = dir, i = 0; i < 64 && d; i++, d = parentOf(d)) {
    if (existsSync(`${d}/pnpm-workspace.yaml`)) return d;
    if (parentOf(d) === d) break;
  }
  return null;
}

/** The workspace package holding `dir` (never the root), as { dir, name, scripts }. */
function packageOf(dir, root) {
  for (let d = dir; d.startsWith(`${root}/`); d = parentOf(d)) {
    const pkg = readJson(`${d}/package.json`);
    if (pkg?.name) return { dir: d, name: pkg.name, scripts: pkg.scripts ?? {} };
  }
  return null;
}

function packageByName(root, name) {
  for (const group of ["apps", "packages", "services"]) {
    let entries = [];
    try {
      entries = readdirSync(`${root}/${group}`);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const pkg = readJson(`${root}/${group}/${entry}/package.json`);
      if (pkg?.name === name) return { dir: `${root}/${group}/${entry}`, name, scripts: pkg.scripts ?? {} };
    }
  }
  return null;
}

/** pnpm's scope flags out of the words before the tool: { filter, dir, rest }. */
function scopeOf(words) {
  const out = { filter: undefined, dir: undefined, rest: [] };
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === "--filter" || w === "-F") out.filter = words[++i];
    else if (w.startsWith("--filter=")) out.filter = w.slice("--filter=".length);
    else if (w === "-C" || w === "--dir") out.dir = words[++i];
    else if (w.startsWith("--dir=")) out.dir = w.slice("--dir=".length);
    else out.rest.push(w);
  }
  return out;
}

const hasPinnedBin = (dir, tool) => ["", ".cmd", ".ps1"].some((ext) => existsSync(`${dir}/node_modules/.bin/${tool}${ext}`));

// The tsc arguments `typecheck` carries: --noEmit is required (a typecheck never
// emits) and -p picks typecheck or typecheck:tests. Any other flag refuses.
const TSC_PROJECT_SCRIPT = { "tsconfig.json": "typecheck", "tsconfig.test.json": "typecheck:tests" };

function rewriteTsc(words, cwd, root) {
  const at = words.indexOf("tsc");
  const manager = words.slice(0, at);
  if (manager.length && !["npx", "pnpm"].includes(manager[0])) return null;
  const scope = scopeOf(manager.slice(1));
  if (manager[0] === "npx" ? manager.length !== 1 : scope.rest.length > 1 || (scope.rest[0] && scope.rest[0] !== "exec")) return null;
  let noEmit = false;
  let project;
  const args = words.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--noEmit") noEmit = true;
    else if ((args[i] === "-p" || args[i] === "--project") && args[i + 1]) project = args[++i];
    else return null;
  }
  if (!noEmit) return null;
  const pkg = scope.filter ? packageByName(root, scope.filter) : packageOf(scope.dir ? resolvePath(cwd, scope.dir) : cwd, root);
  if (!pkg) return null;
  // pnpm --filter runs in the package; otherwise tsc resolves from the folder it runs in.
  const base = scope.filter ? pkg.dir : scope.dir ? resolvePath(cwd, scope.dir) : cwd;
  let config;
  if (project) {
    config = resolvePath(base, project === "." ? "tsconfig.json" : project);
  } else {
    for (let d = base; d.startsWith(pkg.dir) && !config; d = parentOf(d)) if (existsSync(`${d}/tsconfig.json`)) config = `${d}/tsconfig.json`;
  }
  const script = config && parentOf(config) === pkg.dir ? TSC_PROJECT_SCRIPT[config.slice(pkg.dir.length + 1)] : undefined;
  if (!script || !pkg.scripts[script]) return null;
  return { text: `pnpm --filter ${pkg.name} ${script}`, why: "a bare tsc runs out of heap on this codebase and is not the checker CI uses, BI-CD7706B5" };
}

const looksLikePath = (t) => !t.startsWith("-") && (t.includes("/") || /\.(c|m)?[jt]sx?$/.test(t));

function rewriteVitest(words, cwd, root) {
  const args = words.slice(words.indexOf("vitest") + 1);
  const paths = args.filter(looksLikePath);
  if (paths.length === 0) return null;
  const owners = paths.map((p) => packageOf(resolvePath(cwd, p), root));
  if (owners.some((o) => !o) || new Set(owners.map((o) => o.dir)).size !== 1) return null;
  const pkg = owners[0];
  const rel = args.map((t) => (looksLikePath(t) ? resolvePath(cwd, t).slice(pkg.dir.length + 1) : t));
  return {
    text: ["pnpm", "--filter", pkg.name, "exec", "vitest", ...rel].join(" "),
    why: "vitest from the workspace root prunes sibling links and runs the wrong config, BI-99CAE42F",
  };
}

function rewriteNpx(words, cwd, root) {
  const tool = words[1];
  if (!tool || !/^[\w.-]+$/.test(tool)) return null; // flags, scoped or versioned specs change resolution
  const home = packageOf(cwd, root)?.dir ?? (cwd === root ? root : null);
  if (!home || !hasPinnedBin(home, tool)) return null;
  return { text: ["pnpm", "exec", ...words.slice(1)].join(" "), why: "npx ignores the pinned versions in this workspace, AGENTS.md §2" };
}

const REDIRECT_RE = /^(\d*>>?|&>>?|<)/;

/**
 * The rewritten command, or {} when any offending segment cannot be rewritten
 * deterministically. Exported for unit tests.
 * @param {{ command: string, cwd?: string }} args
 * @returns {{ command?: string, context?: string }}
 */
export function planRewrite({ command, cwd = "" }) {
  if (typeof command !== "string" || !command.trim()) return {};
  const parts = splitQuoted(command);
  const start = posix(cwd).replace(/\/+$/, "");
  const root = start && workspaceRootOf(start);
  if (!parts || !root) return {};
  let dir = start;
  const notes = [];
  for (let i = 0; i < parts.length; i += 2) {
    const seg = parts[i];
    const body = seg.trim();
    if (!body) continue;
    const words = body.split(/\s+/);
    if (words[0] === "cd" || words[0] === "pushd") {
      const target = body.slice(words[0].length).trim().replace(/^(["'])(.*)\1$/, "$2");
      if (!target || /^[~$-]/.test(target)) return {};
      dir = resolvePath(dir, target);
      continue;
    }
    const tokens = tokenize(body);
    const tsc = isRawTsc(tokens);
    const vitest = !tsc && isRootVitest(tokens, dir);
    if (!tsc && !vitest && !isNpx(tokens)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) return {}; // env-prefixed: keep the refusal
    // Words up to the first quote or redirect are rewritten; the rest is carried verbatim.
    const cut = words.findIndex((w) => /["']/.test(w) || REDIRECT_RE.test(w));
    const head = cut === -1 ? words : words.slice(0, cut);
    const tail = cut === -1 ? "" : body.slice(body.indexOf(words[cut], head.join(" ").length));
    if (tail && (tsc ? !/^\s*\d*>/.test(tail) || /["']/.test(tail) : vitest && tail.replace(/(["'])[^"']*\1/g, "").split(/\s+/).some((t) => looksLikePath(t) && !REDIRECT_RE.test(t)))) return {};
    const bare = [head[0].replace(/^.*[\\/]/, ""), ...head.slice(1)];
    const plan = tsc ? rewriteTsc(bare, dir, root) : vitest ? rewriteVitest(bare, dir, root) : rewriteNpx(bare, dir, root);
    if (!plan) return {};
    const to = tail ? `${plan.text} ${tail}` : plan.text;
    parts[i] = seg.replace(body, to);
    notes.push({ from: body, to, why: plan.why });
  }
  if (!notes.length) return {};
  const rewritten = parts.join("");
  if (decide({ command: rewritten, cwd: start }).block) return {};
  const context = [
    "DPF raw-tool-guard rewrote this command before it ran (BI-F17F2188):",
    ...notes.map((n) => `  ${n.from}  ->  ${n.to}   (${n.why})`),
    `Use the rewritten form directly next time. Raw form on purpose? prefix with ${BYPASS_ENV}=1`,
  ].join("\n");
  return { command: rewritten, context };
}

/**
 * Claude PreToolUse output that runs the rewritten command. updatedInput
 * replaces the whole input, so every other field is carried. "allow" skips the
 * permission prompt, so it is used only where nothing would prompt anyway
 * (bypassPermissions); in any other mode the operator sees the rewritten command.
 */
export function rewriteEnvelope({ toolInput, command, context, permissionMode }) {
  const input = toolInput && typeof toolInput === "object" ? toolInput : {};
  const key = ["command", "cmd", "script"].find((k) => typeof input[k] === "string") ?? "command";
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: permissionMode === "bypassPermissions" ? "allow" : "ask",
      permissionDecisionReason: context,
      updatedInput: { ...input, [key]: command },
      additionalContext: context,
    },
  };
}

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0);
  if (!inDpfWorkspace(payload.cwd)) process.exit(0);
  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const verdict = decide({ command, cwd: payload.cwd, env: process.env });
  if (!verdict.block) process.exit(0);
  if (surfaceCanRewrite(payload.surface)) {
    const plan = planRewrite({ command, cwd: payload.sessionCwd ?? payload.cwd });
    if (plan.command) {
      const envelope = rewriteEnvelope({ toolInput: payload.toolInput, command: plan.command, context: plan.context, permissionMode: payload.permissionMode });
      process.stdout.write(JSON.stringify(envelope));
      process.exit(0);
    }
  }
  emitDeny(verdict.reason);
}

const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("raw-tool-guard.mjs")) {
  main();
}
