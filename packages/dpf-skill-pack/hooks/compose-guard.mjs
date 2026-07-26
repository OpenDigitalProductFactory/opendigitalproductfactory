#!/usr/bin/env node
// packages/dpf-skill-pack/hooks/compose-guard.mjs
//
// PreToolUse guard (BI-39543181 / BI-B61779DB): refuse a RAW `docker compose`
// command that would (re)create a stateful data service (postgres/neo4j/qdrant)
// on the ROOT `dpf` project, or destroy its volumes. A root-project `up` is
// exactly what silently swapped the live database onto a stale 8-day-old
// `dpf_pgdata` volume on 2026-06-23: the volume holding the real data was a
// divergent (non-canonical) one, so a plain `docker compose up` attached the
// dormant canonical volume and reverted the DB 8 days, with no alarm.
//
// The governed portal-update path is /ops/self-upgrade. `scripts/redeploy-portal.*`
// and `scripts/promote.sh` recreate ONLY portal/portal-init with `--no-deps` and
// never touch the data services, so those stay allowed.
//
// Shipped INSIDE the dpf-platform plugin (hooks/hooks.json, matcher "Bash") so the
// guard travels with the plugin to every surface (Claude/Codex/Grok) — NOT through
// run-hook.mjs, which forces exit 0 and so could never deny. Mirrors the
// root-clone-guard.mjs / lease-guard.mjs pattern (plugin hook plane).
//
// Decision protocol: to DENY, emit the PreToolUse permissionDecision JSON on
// stdout and exit 0; to ALLOW, exit 0 with no output. The hook fails OPEN — any
// parse/IO error allows the command (a guard must never wedge the session).
//
// What stays ALLOWED:
//   - `--no-deps` ups of only stateless services (the redeploy/promoter path)
//   - any command on an isolated project (COMPOSE_PROJECT_NAME=dpf-<topic> or -p)
//   - `build`, image pulls, `ps`, `logs`, and plain `down` (reversible) on root
// Emergency bypass: prefix the command with DPF_ALLOW_ROOT_COMPOSE_UP=1 (an
// intentional install/recovery `up`) or DPF_ALLOW_DESTRUCTIVE_COMPOSE=1 (either).

import {
  readHookPayload,
  isShellTool,
  emitDeny,
  inDpfWorkspace,
  shellCommandFromInput,
} from "./lib/hook-io.mjs";

const DEFAULT_PROJECT = "dpf";
const CONTAINER_CREATING = new Set(["up", "create", "start", "restart", "run"]);
const DATA_SERVICES = new Set(["postgres", "neo4j", "qdrant"]);

// Compose options that take a separate value token (so the next token is NOT a
// service operand). Mirrors scripts/lib/compose-safety.mjs (kept inline so the
// hook stays self-contained across the plugin boundary).
const OPTS_WITH_VALUES = new Set([
  "-f", "--file", "-p", "--project-name", "--profile", "--env-file",
  "--project-directory", "--parallel", "--progress", "--ansi", "--log-level",
  "--scale", "--exit-code-from", "--attach", "--no-attach", "--timeout", "-t",
  "--wait-timeout", "--pull", "--scenario",
]);

const GUIDANCE_UP =
  "Raw 'docker compose up/create/restart' of a data service on the ROOT dpf project blocked " +
  "(BI-B61779DB). This recreates postgres/neo4j/qdrant and can silently attach the live database " +
  "to a stale or wrong volume — exactly the 2026-06-23 8-day data revert. Use the governed path " +
  "(/ops/self-upgrade) to update the portal, or scripts/redeploy-portal.* / promote.sh (which use " +
  "--no-deps portal and never touch the data services). For an intentional install/recovery, prefix " +
  "the command with DPF_ALLOW_ROOT_COMPOSE_UP=1. For a worktree/CI run, set a unique " +
  "COMPOSE_PROJECT_NAME=dpf-<topic> (or use node scripts/dpf-compose.mjs).";

const GUIDANCE_DOWN =
  "Raw 'docker compose down --volumes' on the ROOT dpf project blocked — it would delete the live " +
  "data volumes. For an intentional recovery/reinstall, prefix with DPF_ALLOW_DESTRUCTIVE_COMPOSE=1; " +
  "for a worktree/CI run, set a unique COMPOSE_PROJECT_NAME=dpf-<topic>.";

// ── command parsing (mirrors root-clone-guard.mjs) ───────────────────────────

/** Split a compound command into segments on && || ; | and newlines. */
function segments(command) {
  return command.split(/&&|\|\||[;|\n]/g).map((s) => s.trim()).filter(Boolean);
}

/** Tokenize a segment, honoring simple single/double quotes; strips the quotes. */
function tokenize(seg) {
  const raw = seg.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  return raw.map((t) => t.replace(/^['"]|['"]$/g, "").replace(/['"]/g, ""));
}

/** The compose args within a tokenized segment, or null if it isn't a compose call. */
export function findComposeArgs(tokens) {
  let i = 0;
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i += 1; // leading VAR=val
  if (tokens[i] === "sudo") i += 1;
  if (tokens[i] === "docker" && tokens[i + 1] === "compose") return tokens.slice(i + 2);
  if (tokens[i] === "docker-compose") return tokens.slice(i + 1);
  return null;
}

/** Parse compose args into { projectName, command, commandArgs }. */
export function parseComposeArgs(args) {
  let projectName;
  let command = "";
  let commandArgs = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--") continue;
    if (a === "-p" || a === "--project-name") { projectName = args[i + 1] ?? ""; i += 1; continue; }
    if (a.startsWith("--project-name=")) { projectName = a.slice("--project-name=".length); continue; }
    if (a.startsWith("-p") && a.length > 2) { projectName = a.slice(2); continue; }
    if (a.startsWith("-")) {
      if (a.includes("=")) continue;
      if (OPTS_WITH_VALUES.has(a)) i += 1;
      continue;
    }
    command = a;
    commandArgs = args.slice(i + 1);
    break;
  }
  return { projectName, command, commandArgs };
}

function serviceOperands(commandArgs) {
  const out = [];
  for (let i = 0; i < commandArgs.length; i += 1) {
    const a = commandArgs[i];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (a.includes("=")) continue;
      if (OPTS_WITH_VALUES.has(a)) i += 1;
      continue;
    }
    out.push(a);
  }
  return out;
}

function isRootDataRecreate(intent) {
  if (!CONTAINER_CREATING.has(intent.command)) return false;
  const svc = serviceOperands(intent.commandArgs);
  if (svc.length === 0) return true; // full up brings up postgres et al.
  if (svc.some((s) => DATA_SERVICES.has(s))) return true; // names a data service
  return !intent.commandArgs.includes("--no-deps"); // `up portal` pulls postgres unless --no-deps
}

function isVolumeDown(intent) {
  return (
    intent.command === "down" &&
    intent.commandArgs.some((a) => a === "-v" || a === "--volumes" || a.startsWith("--volumes="))
  );
}

// ── decision ─────────────────────────────────────────────────────────────────

/**
 * Pure decision: should this Bash command be blocked? Exported for unit tests.
 * @param {object} args
 * @param {string} args.command  the Bash command string
 * @param {Record<string,string|undefined>} [args.env]
 * @returns {{ block: boolean, reason?: string }}
 */
export function decide({ command, env = {} }) {
  if (typeof command !== "string" || command.trim() === "") return { block: false };

  const bypassUp =
    env.DPF_ALLOW_ROOT_COMPOSE_UP === "1" || /\bDPF_ALLOW_ROOT_COMPOSE_UP=1\b/.test(command);
  const bypassDestroy =
    env.DPF_ALLOW_DESTRUCTIVE_COMPOSE === "1" || /\bDPF_ALLOW_DESTRUCTIVE_COMPOSE=1\b/.test(command);

  for (const seg of segments(command)) {
    const tokens = tokenize(seg);
    const composeArgs = findComposeArgs(tokens);
    if (!composeArgs) continue;

    const intent = parseComposeArgs(composeArgs);

    // Resolve the project: inline -p/--project-name wins; else an inline
    // COMPOSE_PROJECT_NAME=… assignment in this segment; else the ambient env;
    // else the compose-file default "dpf".
    let project = intent.projectName;
    if (!project) {
      const m = seg.match(/\bCOMPOSE_PROJECT_NAME=([A-Za-z0-9._-]+)/);
      project = m ? m[1] : env.COMPOSE_PROJECT_NAME || DEFAULT_PROJECT;
    }
    if (String(project).trim().toLowerCase() !== DEFAULT_PROJECT) continue; // isolated project — fine

    if (isRootDataRecreate(intent) && !bypassUp && !bypassDestroy) {
      return { block: true, reason: GUIDANCE_UP };
    }
    if (isVolumeDown(intent) && !bypassDestroy) {
      return { block: true, reason: GUIDANCE_DOWN };
    }
  }

  return { block: false };
}

// ── runtime entry ────────────────────────────────────────────────────────────

function main() {
  const payload = readHookPayload();
  if (payload === null) process.exit(0); // fail open on read/parse error
  if (!inDpfWorkspace(payload.cwd)) process.exit(0); // DPF-scoped global hook: enforce only inside a DPF checkout

  if (!isShellTool(payload.toolName)) process.exit(0);
  const command = shellCommandFromInput(payload.toolInput);
  const verdict = decide({ command, env: process.env });
  if (!verdict.block) process.exit(0);

  emitDeny(verdict.reason); // dual-envelope deny — blocks on every surface
}

// Run only when invoked directly (not when imported by the test).
const invokedPath = process.argv[1] ? process.argv[1].replace(/\\/g, "/") : "";
if (invokedPath.endsWith("compose-guard.mjs")) {
  main();
}
