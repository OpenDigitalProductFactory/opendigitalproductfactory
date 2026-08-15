import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Single source of truth for the MINIMAL Docker build context that
 * `Dockerfile.promoter` needs — exactly its local `COPY <src> <dest>` sources
 * (repo-relative paths). This is a tiny ~21-file set, NOT the whole workspace.
 *
 * Both promoter build paths stage ONLY these files (plus the Dockerfile itself)
 * so `docker build` never enumerates apps/packages/docs:
 *   - the just-in-time rebuild inside the portal (`PROMOTER_JIT_BUILD_SCRIPT` in
 *     ./promoter.ts), staging from the portal's baked-in `/promoter/` layout;
 *   - the candidate build during self-upgrade
 *     (`buildCandidatePromoterArtifactImage` in ./promoter-artifact.ts), staging
 *     from the target-sha source checkout.
 *
 * Walking the whole upgrade workspace to build a 21-file image was the
 * `readdirent … cannot allocate memory` OOM that bricked SUR-BF75ED2A on a lean
 * host (PR #4199). Trimming via `Dockerfile.promoter.dockerignore` is
 * belt-and-suspenders; staging a minimal context is the root-cause fix — docker
 * never sees the big tree at all.
 *
 * `scripts/promoter-build-context.test.mjs` parses `Dockerfile.promoter` and
 * asserts this list equals its COPY sources exactly, so the two can never drift.
 */
export const PROMOTER_BUILD_CONTEXT_SOURCES: readonly string[] = [
  "promoter-contract.json",
  "Dockerfile",
  "scripts/promote.sh",
  "scripts/apply-runtime-capability-transition.mjs",
  "scripts/runtime-transition-authority.mjs",
  "scripts/rotate-runtime-transition-secret.mjs",
  "scripts/lib/transition-signing.mjs",
  "scripts/promoter-migration-envelope.mjs",
  "scripts/installer/validate-install-state.mjs",
  "scripts/installer/migrate-install-state.mjs",
  "scripts/installer/resolve-host-identity.mjs",
  "scripts/installer/install-state-transaction.mjs",
  "scripts/installer/install-state-lock-contract.json",
  "scripts/installer/install-state-schema-registry.mjs",
  "scripts/installer/install-state.schema.json",
  "scripts/installer/install-state.v1.schema.json",
  "scripts/installer/install-state.v2.schema.json",
  "scripts/lib/resolve-capability-compose-profiles.mjs",
  "scripts/lib/govern-capability-compose-args.mjs",
  "scripts/lib/capability-state-hash.mjs",
  "scripts/capability-service-catalog.generated.json",
] as const;

/**
 * The Dockerfile that builds the promoter image. It is passed to
 * `docker buildx build -f <ctx>/Dockerfile.promoter`, so it must also live in
 * the staged context. It is NOT a COPY source (nothing copies it into the
 * image), so it is kept separate from `PROMOTER_BUILD_CONTEXT_SOURCES` above.
 */
export const PROMOTER_DOCKERFILE = "Dockerfile.promoter";

/**
 * The complete file set staged into a minimal promoter build context: every
 * `Dockerfile.promoter` COPY source plus the Dockerfile itself.
 */
export const PROMOTER_BUILD_CONTEXT_FILES: readonly string[] = [
  ...PROMOTER_BUILD_CONTEXT_SOURCES,
  PROMOTER_DOCKERFILE,
];

/**
 * Stage the minimal promoter build context from a source tree into a fresh
 * throwaway directory, preserving each file's repo-relative path. Returns the
 * context directory; the caller owns cleanup (delete it after the build).
 *
 * Only the ~22 files in `PROMOTER_BUILD_CONTEXT_FILES` are copied, so a
 * subsequent `docker build <contextDir>` transfers a tiny context and never
 * walks the source tree's apps/packages/docs. A missing input fails loudly here
 * (and the temp dir is removed) rather than deep inside `docker build`, since a
 * candidate checkout that lacks a promoter COPY source could not build anyway.
 */
export async function stageMinimalPromoterBuildContext(
  sourcePath: string,
): Promise<string> {
  const contextDir = await mkdtemp(join(tmpdir(), "dpf-promoter-ctx-"));
  try {
    for (const file of PROMOTER_BUILD_CONTEXT_FILES) {
      const dest = join(contextDir, file);
      await mkdir(dirname(dest), { recursive: true });
      await cp(join(sourcePath, file), dest);
    }
  } catch (err) {
    await rm(contextDir, { recursive: true, force: true });
    throw err;
  }
  return contextDir;
}
