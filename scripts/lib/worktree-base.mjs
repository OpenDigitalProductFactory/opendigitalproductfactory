// The platform's own answer to "where do my development surfaces do their work?"
//
// This is the SINGLE place that resolves the canonical worktree base. Before it
// existed the question had two answers and neither belonged to the platform:
//
//   * packages/dpf-bootstrap/src/agent-toolchain/codex-config.ts held
//     `CANONICAL_WORKTREE_BASE = "D:\\DPF-worktrees"` — a constant in CLIENT
//     configuration, so the location of DPF's work was defined by whichever
//     client happened to be installed.
//   * scripts/lib/local-ci-slot-manifest.mjs derived the same path
//     independently.
//
// The portal had no notion of it at all, which is why its server-side worktree
// janitor is structurally blind: the base is a sibling of the install root and
// outside every container mount, so the job scans nothing and reports success.
// 528 GB accumulated behind that (BI-99395B29).
//
// Direction of ownership, per `platform-function-never-depends-on-a-client`:
// the platform declares where work happens and TELLS its clients. A client
// planner consumes this; it never defines it. The prior art is deliberate —
// devcontainer, EditorConfig and git's own `core.worktree` all keep the
// authoritative location with the project rather than in each editor.
//
// Spec: docs/superpowers/specs/2026-09-02-platform-owned-client-configuration-design.md §1

import { basename, dirname, isAbsolute, join, resolve } from "node:path";

/** Explicit operator/install override, highest precedence after config. */
export const WORKTREE_BASE_ENV = "DPF_WORKTREE_BASE";

/**
 * How a base was decided. Callers surface this so an unexpected location is
 * legible rather than mysterious — a wrong base points the reaper at the wrong
 * directory, so the provenance is part of the answer.
 *
 * @typedef {"install-config" | "env" | "derived"} WorktreeBaseSource
 */

/**
 * Resolve the canonical worktree base.
 *
 * Order, most specific first:
 *   1. `installConfig` — what this install declares for itself.
 *   2. `env[DPF_WORKTREE_BASE]` — operator override.
 *   3. derived `dirname(rootClone)/<basename(rootClone)>-worktrees` — the
 *      historical behaviour, kept so every existing install keeps working with
 *      no operator action.
 *
 * @param {{ rootClone: string, env?: Record<string, string | undefined>, installConfig?: string | null }} input
 * @returns {{ base: string, source: WorktreeBaseSource }}
 */
export function resolveWorktreeBase(input) {
  const { rootClone, env = {}, installConfig = null } = input ?? {};

  if (typeof rootClone !== "string" || rootClone.length === 0) {
    throw new Error("resolveWorktreeBase: rootClone is required");
  }

  const declared = firstNonEmpty(installConfig);
  if (declared) {
    return { base: requireAbsolute(declared, "installConfig"), source: "install-config" };
  }

  const overridden = firstNonEmpty(env[WORKTREE_BASE_ENV]);
  if (overridden) {
    return { base: requireAbsolute(overridden, WORKTREE_BASE_ENV), source: "env" };
  }

  const root = resolve(rootClone);
  return { base: join(dirname(root), `${basename(root)}-worktrees`), source: "derived" };
}

/** Trim to a usable value, treating blank strings as absent. */
function firstNonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * A relative base would resolve differently per caller — the portal, a script
 * and a client planner all run from different working directories — so a
 * declared base must be absolute rather than silently reinterpreted.
 */
function requireAbsolute(value, label) {
  if (!isAbsolute(value)) {
    throw new Error(
      `resolveWorktreeBase: ${label} must be an absolute path (received "${value}"). ` +
        "A relative base resolves differently for the portal, a script and a client planner.",
    );
  }
  return resolve(value);
}
