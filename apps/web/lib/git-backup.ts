/**
 * Git Backup — Commit and push promotion diffs to a configured backup repository.
 * Used by fork_only mode to protect customizations against container rebuilds.
 */

import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { prisma } from "@dpf/db";
import { lazyChildProcess, lazyUtil, lazyFsPromises, lazyPath } from "@/lib/shared/lazy-node";

/**
 * Commit a promotion diff to the configured backup repository.
 * This function handles its own git operations without the isDevInstance() guard,
 * because consumer-mode installs need backup capability.
 */
export async function backupPromotionToGit(input: {
  buildId: string;
  title: string;
  diffPatch: string;
  productId: string | null;
  version: string | null;
}): Promise<{ pushed: boolean; error?: string }> {
  const config = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { gitRemoteUrl: true, contributionMode: true },
  });

  if (!config?.gitRemoteUrl) {
    return { pushed: false, error: "No git remote URL configured" };
  }

  // Look up and decrypt the git credential (same pattern as ai-provider-internals.ts)
  const credential = await prisma.credentialEntry.findUnique({
    where: { providerId: "git-backup" },
    select: { secretRef: true, status: true },
  });

  let token: string | null = null;
  if (credential?.secretRef) {
    const { decryptSecret } = await import("@/lib/credential-crypto");
    token = decryptSecret(credential.secretRef);
  }
  token = token ?? process.env.GITHUB_TOKEN ?? null;
  if (!token) {
    return { pushed: false, error: "No git credential configured for backup" };
  }

  try {
    const exec = lazyUtil().promisify(lazyChildProcess().exec);
    const { writeFile, unlink } = lazyFsPromises();
    const { resolve } = lazyPath();

    const gitRoot = process.env.PROJECT_ROOT
      ? resolve(process.env.PROJECT_ROOT)
      : resolve(process.cwd(), "..", "..");

    const timeout = 30_000;

    // Write diff to temp file and apply.
    // CodeQL #109 (js/insecure-temporary-file): the previous form was
    // `/tmp/dpf-backup-${Date.now()}.patch` — Date.now() is predictable,
    // so on a shared-tmp host an attacker could pre-create the path as
    // a symlink and trick writeFile into clobbering a different file.
    // CodeQL recognises `randomUUID()` inline in the path expression as
    // the safe-constructor pattern (122 bits of entropy, unguessable);
    // it does NOT follow wrapper functions, so the call must be inline.
    const tmpFile = `${tmpdir()}/dpf-backup-${randomUUID()}.patch`;
    await writeFile(tmpFile, input.diffPatch, "utf-8");

    try {
      // Apply the patch
      await exec(`git apply ${JSON.stringify(tmpFile)}`, { cwd: gitRoot, timeout });

      // Stage and commit
      const commitMsg = [
        `feat: ${input.title}`,
        "",
        `Build: ${input.buildId}`,
        input.productId ? `Product: ${input.productId}` : null,
        input.version ? `Version: ${input.version}` : null,
        "Change-Type: ai-proposed",
      ].filter(Boolean).join("\n");

      await exec("git add -A", { cwd: gitRoot, timeout });
      await exec(`git commit -m ${JSON.stringify(commitMsg)}`, { cwd: gitRoot, timeout });

      // Push with token auth via GIT_ASKPASS to avoid token in URLs/error
      // messages. The script CONTAINS the GitHub token, so a predictable
      // path is doubly dangerous: an attacker who pre-creates the path as
      // a symlink could not only force the write to a different file but
      // also intercept the token if the symlink points at an attacker-
      // readable location. randomUUID() inline gives 122 bits of entropy.
      const askpassScript = `${tmpdir()}/dpf-askpass-${randomUUID()}.sh`;
      await writeFile(askpassScript, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
      try {
        await exec(`git push ${JSON.stringify(config.gitRemoteUrl)} HEAD:main`, {
          cwd: gitRoot, timeout,
          env: { ...process.env, GIT_ASKPASS: askpassScript, GIT_TERMINAL_PROMPT: "0" },
        });
      } finally {
        try { await unlink(askpassScript); } catch { /* cleanup */ }
      }

      // Record the commit hash on the build
      const { stdout } = await exec("git rev-parse HEAD", { cwd: gitRoot, timeout: 5000 });
      const hash = stdout.trim();
      if (hash) {
        const build = await prisma.featureBuild.findUnique({
          where: { buildId: input.buildId },
          select: { id: true, gitCommitHashes: true },
        });
        if (build) {
          await prisma.featureBuild.update({
            where: { id: build.id },
            data: { gitCommitHashes: [...build.gitCommitHashes, hash] },
          });
        }
        void import("@/lib/integrate/code-graph-refresh").then(({ queueCodeGraphReconcile }) =>
          queueCodeGraphReconcile({
            reason: "git-backup",
            headSha: hash,
            branch: "main",
          })
        ).catch(() => {});
      }

      return { pushed: true };
    } finally {
      try { await unlink(tmpFile); } catch { /* cleanup best-effort */ }
    }
  } catch (err) {
    return { pushed: false, error: err instanceof Error ? err.message : "Git backup push failed" };
  }
}
