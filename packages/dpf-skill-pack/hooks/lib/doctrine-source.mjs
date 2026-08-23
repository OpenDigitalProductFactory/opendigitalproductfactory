// packages/dpf-skill-pack/hooks/lib/doctrine-source.mjs
//
// Resolve the canonical rulebook independently of the checked-out branch
// (BI-E659ED37, kernel decision DI-48014BCBA44F).
//
// THE DEFECT
// Doctrine reached a thread through CLAUDE.md, a PER-BRANCH file. #4477 changed
// it from an inert prose link to an `@AGENTS.md` import, but that only reaches
// branches created or rebased after it merged. Measured 2026-08-22: 70 of 80
// live worktrees still carried the prose version and loaded NO doctrine, and
// nothing detected it. Pointing worked when worktrees were few and short-lived;
// at 80 concurrent long-lived worktrees a per-branch pointer is a race the
// pointer loses.
//
// THE FIX
// Resolve from the ROOT CLONE, which root-clone-freshness.mjs keeps
// fast-forwarded to origin/main, reachable from any worktree however old via
// `git rev-parse --git-common-dir`. The worktree's own copy is the fallback.
// This is a pointer, not a copy: the rulebook still lives in exactly one file
// (single source of truth), it is simply read from the tree that is current
// rather than the one the thread happens to be standing in.
//
// Rejected: serving doctrine from the MCP plane. It scored well on
// single-source but makes doctrine unavailable exactly when MCP auth is broken,
// which is the failure being fixed. Doctrine must not depend on the thing
// doctrine governs.

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

export const RULEBOOK = "AGENTS.md";

function defaultGit(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The shared clone behind every linked worktree, or null outside a repo. */
export function resolveRootClone(cwd, git = defaultGit) {
  const common = git(["rev-parse", "--git-common-dir"], cwd);
  if (!common) return null;
  const abs = common.startsWith("/") || /^[A-Za-z]:/.test(common) ? common : join(cwd, common);
  const parent = dirname(abs);
  return existsSync(join(parent, RULEBOOK)) ? parent : null;
}

function read(path) {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/**
 * Resolve the rulebook to inject.
 *
 * Returns { ok, source, path, text, bytes, worktreeDiffers, note }.
 * `source` is "root-clone" (branch-independent, preferred) or "worktree"
 * (fallback). ok=false means no rulebook is reachable at all.
 */
export function resolveDoctrine({ cwd = process.cwd(), git = defaultGit } = {}) {
  const top = git(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const rootClone = resolveRootClone(cwd, git);

  const candidates = [];
  if (rootClone) candidates.push({ source: "root-clone", path: join(rootClone, RULEBOOK) });
  candidates.push({ source: "worktree", path: join(top, RULEBOOK) });

  for (const c of candidates) {
    const text = read(c.path);
    if (text && text.trim()) {
      const own = c.source === "root-clone" ? read(join(top, RULEBOOK)) : text;
      return {
        ok: true,
        source: c.source,
        path: c.path,
        text,
        bytes: Buffer.byteLength(text, "utf8"),
        // True when this worktree's own copy is behind: the thread would have
        // read something different, or nothing, without the injection.
        worktreeDiffers: c.source === "root-clone" && own !== text,
        note:
          c.source === "root-clone"
            ? "resolved from the root clone, so an old branch cannot serve stale doctrine"
            : "resolved from this worktree (root clone unreachable)",
      };
    }
  }
  return { ok: false, source: null, path: null, text: null, bytes: 0, worktreeDiffers: false, note: `no ${RULEBOOK} reachable` };
}

/**
 * Does this tree's CLAUDE.md actually IMPORT the rulebook?
 *
 * `@AGENTS.md` on its own line is an import the client resolves. A prose link
 * ("Read [/AGENTS.md](AGENTS.md) ...") is not — it loads nothing, which is the
 * shape 70 of 80 worktrees carried. When this is false the thread has no
 * doctrine unless something injects it.
 */
export function pointerImportsRulebook({ cwd = process.cwd(), git = defaultGit } = {}) {
  const top = git(["rev-parse", "--show-toplevel"], cwd) || cwd;
  const body = read(join(top, "CLAUDE.md"));
  if (body === null) return { present: false, imports: false };
  return { present: true, imports: /^@AGENTS\.md\s*$/m.test(body) };
}

/**
 * Doctrine is only injected when the pointer would NOT load it, so a conformant
 * worktree does not pay ~24KB twice. Front-loading the full rulebook is the
 * ratified stance (DI-F844365B0DCC Option B); duplicating it is not.
 */
export function doctrineDelivery({ cwd = process.cwd(), git = defaultGit } = {}) {
  const pointer = pointerImportsRulebook({ cwd, git });
  const resolved = resolveDoctrine({ cwd, git });
  if (pointer.imports) {
    return { mode: "pointer", needsInjection: false, resolved, pointer, loaded: true };
  }
  return {
    mode: resolved.ok ? "injected" : "none",
    needsInjection: resolved.ok,
    resolved,
    pointer,
    loaded: resolved.ok,
  };
}
