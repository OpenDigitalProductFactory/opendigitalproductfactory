// apps/web/lib/routing/capability-probes/probe-engine-readiness.ts
//
// Build-Engine Provisioning (EP-2D477458) — slice B, the readiness detection
// layer.
//
// A NON-throwing readiness probe shared by all CLI build engines. Unlike the
// capability probes (probe-claude-cli / probe-codex-cli), which THROW when a
// binary is missing because phantom capabilities would corrupt routing, this
// returns a structured result: { present, version, ... } and NEVER throws. It
// is the safe way to answer "is engine X installed in the sandbox?" for UX
// badges, the Coworker MCP surface, and provisioning reconciliation.
//
// Design: the engine descriptor is passed as a PARAMETER (DB-free hot path) so
// probing never depends on DB availability or a per-probe lookup. Persisting
// the result to BuildEngineState is a separate caller responsibility — see
// persist-engine-readiness.ts.
//
// Spec: docs/superpowers/specs/2026-06-06-build-engine-provisioning-design.md (Phase 1a, slice B)

import { lazyChildProcess, lazyUtil } from "@/lib/shared/lazy-node";

import { extractEngineVersion } from "./engine-version-parser";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
const PROBE_TIMEOUT_MS = 10_000;

/**
 * Minimal engine descriptor needed to probe presence. Mirrors the fields the
 * BuildEngine registry (build-engines.json / BuildEngine model) carries, but is
 * passed by value so probing stays DB-free.
 */
export type EngineProbeConfig = {
  /** Short engine id, e.g. "claude" | "codex" | "grok". */
  engineId: string;
  /** Executable name, used only for messaging. */
  binary: string;
  /** Full verify command argument string, e.g. "claude --version". */
  verifyCommand: string;
  /** Regex (string or RegExp) used to extract the version from stdout. */
  versionRegex: string | RegExp;
};

/** Non-throwing readiness result. `present` is the only field callers must trust. */
export type EngineReadiness = {
  engineId: string;
  present: boolean;
  version: string | null;
  /** ISO timestamp of the probe. */
  probedAt: string;
  /** Populated only when present=false, for diagnostics. */
  error?: string;
};

/**
 * Probe whether `engine` is installed and responding in the sandbox. Runs
 * `docker exec <sandbox> <verifyCommand>` and parses the version. Catches every
 * failure (missing binary, docker error, unparseable output) and returns
 * present=false — it never throws.
 */
export async function probeEngineReadiness(engine: EngineProbeConfig): Promise<EngineReadiness> {
  const execAsync = lazyUtil().promisify(lazyChildProcess().exec);
  const probedAt = new Date().toISOString();
  const regex =
    typeof engine.versionRegex === "string" ? new RegExp(engine.versionRegex) : engine.versionRegex;

  let stdout: string;
  try {
    const result = (await execAsync(`docker exec ${SANDBOX_CONTAINER} ${engine.verifyCommand}`, {
      timeout: PROBE_TIMEOUT_MS,
    })) as { stdout: string; stderr: string };
    stdout = result.stdout ?? "";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      engineId: engine.engineId,
      present: false,
      version: null,
      probedAt,
      error: `'${engine.verifyCommand}' failed in sandbox '${SANDBOX_CONTAINER}': ${message}`,
    };
  }

  const version = extractEngineVersion({ ...engine, versionRegex: regex }, stdout);
  if (!version) {
    return {
      engineId: engine.engineId,
      present: false,
      version: null,
      probedAt,
      error: `could not parse ${engine.binary} version from stdout: ${JSON.stringify(stdout)}`,
    };
  }

  return {
    engineId: engine.engineId,
    present: true,
    version,
    probedAt,
  };
}
