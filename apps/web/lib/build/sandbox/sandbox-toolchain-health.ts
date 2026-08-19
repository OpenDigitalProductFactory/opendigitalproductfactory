import { getErrorMessage } from "@/lib/shared/get-error-message";
// apps/web/lib/build/sandbox/sandbox-toolchain-health.ts
//
// Toolchain preflight for the build sandbox.
//
// The shared pool sandbox (dpf-sandbox-1) reuses node_modules across builds. A
// stale or partially-corrupted install makes `pnpm exec vitest` fail to LOAD —
// "vitest: not found", an ERR_MODULE_NOT_FOUND, or a rolldown native-binding /
// transform error that surfaces as a confusing parse error ("Unexpected JSX
// expression") on a perfectly valid .tsx. CI (a fresh install) passes, so it is
// sandbox state, not a code bug. A build that hits this either records a false
// red verdict or stalls with an opaque message.
//
// This module gives the pipeline a fast, deterministic preflight: probe that
// the test toolchain LOADS, and on a recognized failure signature either
// auto-restore the install (rm -rf node_modules && pnpm install) or surface the
// diagnosis loudly with a structured signature — never a confusing parse error.
//
// The detection/classification functions are pure and unit-tested; the exec
// wrappers are thin so the same logic runs in the durable pipeline and in any
// caller that runs tests in the sandbox.

export type ToolchainFailureSignature =
  | "vitest-missing"
  | "module-load"
  | "native-binding"
  | "out-of-memory";

export type ToolchainProbe = {
  healthy: boolean;
  signature: ToolchainFailureSignature | null;
  /** Operator-facing one-line diagnosis. */
  diagnosis: string | null;
};

export type ToolchainHealthResult = ToolchainProbe & {
  /** True when a clean reinstall was performed during this call. */
  restored: boolean;
};

// Ordered most-specific-first. Each entry maps a recognizable substring in the
// toolchain's stderr/stdout to a structured signature + plain-English cause.
const FAILURE_PATTERNS: Array<{
  signature: ToolchainFailureSignature;
  test: RegExp;
  diagnosis: string;
}> = [
  {
    signature: "native-binding",
    test: /rolldown|failed to load native binding|code signature|napi|\.node['"]?\s*(?:not found|invalid)|invalid ELF header/i,
    diagnosis:
      "Sandbox node_modules has a broken native binding (rolldown/napi) — vitest cannot load. Stale/partial install.",
  },
  {
    signature: "vitest-missing",
    test: /vitest:?\s*(?:command\s+)?not found|command not found:\s*vitest|no such file or directory.*vitest/i,
    diagnosis: "vitest is not installed in the sandbox — node_modules is missing or incomplete.",
  },
  {
    signature: "module-load",
    test: /ERR_MODULE_NOT_FOUND|Cannot find (?:module|package)|ERR_REQUIRE_ESM|Failed to resolve (?:entry|import)/i,
    diagnosis: "A module failed to resolve in the sandbox — node_modules is stale relative to the lockfile.",
  },
  {
    signature: "out-of-memory",
    test: /JavaScript heap out of memory|ENOMEM|Killed/i,
    diagnosis: "The toolchain ran out of memory in the sandbox — not a node_modules corruption.",
  },
];

/**
 * Classify raw toolchain output for a load/availability failure. Returns the
 * first matching signature, or null when the output shows no recognized
 * toolchain-load failure (a normal test PASS or an ordinary test FAILURE both
 * return null — those are not toolchain problems).
 */
export function classifyToolchainFailure(output: string): {
  signature: ToolchainFailureSignature | null;
  diagnosis: string | null;
} {
  const text = output ?? "";
  for (const { signature, test, diagnosis } of FAILURE_PATTERNS) {
    if (test.test(text)) {
      return { signature, diagnosis };
    }
  }
  return { signature: null, diagnosis: null };
}

/**
 * A node_modules-corruption signature is auto-restorable (a clean reinstall
 * fixes it). Out-of-memory is NOT — restoring would waste minutes and fail
 * again, so it is surfaced rather than retried.
 */
export function isRestorableSignature(signature: ToolchainFailureSignature | null): boolean {
  return signature === "native-binding" || signature === "vitest-missing" || signature === "module-load";
}

/**
 * Interpret the result of a `vitest --version` probe. Healthy iff the command
 * printed a version string and showed no failure signature.
 */
export function interpretVersionProbe(output: string): ToolchainProbe {
  const { signature, diagnosis } = classifyToolchainFailure(output);
  if (signature) {
    return { healthy: false, signature, diagnosis };
  }
  // A working `vitest --version` prints a semver line (e.g. "vitest/4.0.1" or
  // "4.0.1"). Absence of any version token alongside no recognized signature is
  // still suspicious — treat as a module-load failure so it gets restored.
  if (/\d+\.\d+\.\d+/.test(output)) {
    return { healthy: true, signature: null, diagnosis: null };
  }
  return {
    healthy: false,
    signature: "module-load",
    diagnosis: "vitest --version produced no version string in the sandbox — toolchain is not loadable.",
  };
}

// ─── Sandbox-bound operations (thin wrappers over execInSandbox) ──────────────

const VERSION_PROBE_CMD = "cd /workspace/apps/web && npx vitest --version 2>&1 || true";
const RESTORE_CMD =
  "cd /workspace && rm -rf node_modules apps/web/node_modules packages/*/node_modules " +
  "&& (pnpm install --frozen-lockfile 2>&1 || pnpm install 2>&1) " +
  "&& (pnpm --filter @dpf/db exec prisma generate 2>&1 || true)";

/**
 * Probe that the sandbox test toolchain loads. Best-effort: an exec failure is
 * itself classified (it usually carries the failure text on stderr).
 */
export async function probeSandboxToolchain(containerId: string): Promise<ToolchainProbe> {
  const { execInSandbox } = await import("./sandbox");
  let output: string;
  try {
    output = await execInSandbox(containerId, VERSION_PROBE_CMD);
  } catch (err) {
    output = getErrorMessage(err);
  }
  return interpretVersionProbe(output);
}

/**
 * Clean-reinstall the sandbox node_modules. Returns the install output for
 * evidence/diagnosis.
 */
export async function restoreSandboxToolchain(containerId: string): Promise<string> {
  const { execInSandbox } = await import("./sandbox");
  return execInSandbox(containerId, RESTORE_CMD);
}

/**
 * Ensure the sandbox test toolchain is loadable BEFORE verification runs.
 *
 * Probe → if broken with a restorable signature and autoRestore !== false,
 * clean-reinstall once and re-probe. The final result names the outcome so a
 * caller can fail LOUD with a structured diagnosis (failureAxis) instead of
 * letting a confusing parse error masquerade as a code defect.
 */
export async function ensureSandboxToolchainHealthy(
  containerId: string,
  opts?: { autoRestore?: boolean },
): Promise<ToolchainHealthResult> {
  const autoRestore = opts?.autoRestore !== false;
  const first = await probeSandboxToolchain(containerId);
  if (first.healthy) {
    return { ...first, restored: false };
  }
  if (!autoRestore || !isRestorableSignature(first.signature)) {
    return { ...first, restored: false };
  }

  console.warn(
    `[sandbox-toolchain] ${containerId}: ${first.signature} — ${first.diagnosis} Restoring node_modules…`,
  );
  await restoreSandboxToolchain(containerId);
  const second = await probeSandboxToolchain(containerId);
  return { ...second, restored: true };
}
