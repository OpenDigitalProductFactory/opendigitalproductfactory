# Unify the candidate promoter build onto a minimal staged context

**Date:** 2026-08-11
**Epic:** governed-platform-upgrade-lifecycle (BI-UPGRADE-011/012 family)
**Status:** implemented (this PR)
**Surface:** self-upgrade promoter build (`apps/web/lib/self-upgrade/`)
**Follows:** PR #4199 (SUR-BF75ED2A candidate-build OOM — `Dockerfile.promoter.dockerignore` + MemAvailable defer-guard + `host-out-of-memory` classifier)

> **Backlog note.** This is the tracked follow-up to PR #4199. The DPF MCP
> connector was not reachable from the authoring session (source-only worktree,
> no portal/DB view), so the live `BacklogItem` could not be filed from here.
> **Action for an MCP-connected operator/Build Studio:** file a BI under the
> governed-platform-upgrade-lifecycle epic — *"Unify candidate promoter build
> onto the minimal tar-context (docker never enumerates the workspace)"* — and
> back-link this plan. This file deliberately carries **no** `**Backlog item:**`
> line so it is not mistaken for coverage evidence that does not yet exist.

## Problem

The promoter image is a tiny ~22-file image (docker CLI + compose + git +
`promote.sh` and its helpers). Two code paths build it, and until now they
disagreed on how they assemble the Docker build context:

1. **JIT rebuild** (`PROMOTER_JIT_BUILD_SCRIPT`, `promoter.ts`) — stages ONLY the
   `Dockerfile.promoter` COPY sources into a temp `$BDIR` and pipes
   `tar -C $BDIR -c . | docker buildx build -f Dockerfile.promoter -`. Docker
   never sees the big tree. Correct.

2. **Candidate build** (`buildCandidatePromoterArtifactImage`,
   `promoter-artifact.ts`) — ran `docker buildx build … <sourcePath>` where
   `sourcePath` is the **whole upgrade workspace**. BuildKit's context sender
   walked/transferred the entire repo just to build a 22-file image. On a lean
   host (WSL2 capped at 24 GB, thrashing) the context sender could not allocate a
   buffer to enumerate the tree and died with
   `error from sender: readdirent … cannot allocate memory` — the OOM that failed
   SUR-BF75ED2A at preflight (before any portal swap). This build also runs
   **hot** (portal fully active, before quiescence, by design), so the heaviest
   step competes with all live surfaces.

PR #4199 trimmed the candidate context with `Dockerfile.promoter.dockerignore`
(an allowlist buildkit honours). That helps, but buildkit still *roots the
context at the whole tree* and applies the ignore during the walk. This plan is
the **root-cause fix**: stage a minimal context so docker never roots at, nor
enumerates, `apps/packages/docs` at all — belt-and-suspenders beyond the
dockerignore.

## Design grounding

- **Source of truth:** `Dockerfile.promoter`'s local `COPY <src> <dest>` list is
  the ground truth for what the image needs. The JIT path already mirrors it (a
  drift test in `scripts/promoter-build-context.test.mjs` enforces equality). The
  candidate path previously side-stepped the list by shipping the whole tree.
- **Kernel:** `evidence-before-diagnosis` (the OOM was read from the
  `SelfUpgradeRun.failureLog`, not guessed) and `proper-fix-over-quick-fix`
  (address the whole-tree context, not just its symptom).

## Change

1. **New `apps/web/lib/self-upgrade/promoter-build-context.ts`** — the single
   shared source-of-truth:
   - `PROMOTER_BUILD_CONTEXT_SOURCES` — the 21 `Dockerfile.promoter` COPY sources
     (repo-relative).
   - `PROMOTER_DOCKERFILE` (`"Dockerfile.promoter"`) — not a COPY source, but must
     be staged so `-f <ctx>/Dockerfile.promoter` resolves inside the context.
   - `PROMOTER_BUILD_CONTEXT_FILES` = sources + Dockerfile.
   - `stageMinimalPromoterBuildContext(sourcePath)` — copies only those files into
     a fresh temp dir (preserving repo-relative paths) and returns it; caller
     owns cleanup. Node built-ins only (no docker spawn) so importing it from the
     bundled orchestrator path stays safe (cf. BI-98AF1066).

2. **`promoter-artifact.ts`** — `buildCandidatePromoterArtifactImage` now stages
   the minimal context from the target-sha `sourcePath` and builds from that temp
   dir (`-f <ctx>/Dockerfile.promoter … <ctx>`), removing it in a `finally`.
   Docker transfers ~22 files, never the workspace.

3. **Drift + staging tests** (`scripts/promoter-build-context.test.mjs`) — assert
   the shared `PROMOTER_BUILD_CONTEXT_SOURCES` equals `Dockerfile.promoter`'s COPY
   sources exactly, and that the candidate build stages exactly those (plus the
   Dockerfile) and never passes the raw `sourcePath` as the docker context.
   `promoter.test.ts`'s candidate-build unit test now stages a real fixture tree
   with an `apps/web` decoy and asserts the staged context contains exactly the
   promoter inputs and not the decoy.

## Non-goals / boundary

- Does not change the JIT path (already correct; kept untouched to avoid churn on
  a security-reviewed, image-baked shell string). The shared constant is bound to
  `Dockerfile.promoter` by test, and the JIT path is bound to the same Dockerfile
  by the existing test — so both paths transitively track one list.
- Does not remove `Dockerfile.promoter.dockerignore` (PR #4199); it remains a
  cheap second layer.

## Verification

- `promoter-build-context.test.mjs` (node:test) + `promoter.test.ts` +
  `promoter-artifact` typecheck under `tsc`; full `apps/web` vitest.
- The `docker build` itself cannot be exercised by unit tests; functional proof
  is a real self-upgrade trigger on a live install (candidate preflight must
  build the promoter image without walking the workspace). Tracked as the
  post-merge functional check.
