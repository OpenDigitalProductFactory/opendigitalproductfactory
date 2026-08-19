/**
 * Git Backup — Commit and push promotion diffs to a configured backup repository.
 * Used by fork_only mode to protect customizations against container rebuilds.
 */

import { prisma } from "@dpf/db";
import { lazyChildProcess, lazyUtil, lazyFsPromises, lazyPath, lazyOs, getCwd } from "@/lib/shared/lazy-node";

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
    const fsp = lazyFsPromises();
    const p = lazyPath();
    const o = lazyOs();
    const { writeFile } = fsp;
    const { resolve } = p;

    const gitRoot = process.env.PROJECT_ROOT
      ? resolve(process.env.PROJECT_ROOT)
      : resolve(getCwd(), "..", "..");

    const timeout = 30_000;

    // CodeQL #109 (js/insecure-temporary-file): the previous form
    // `/tmp/dpf-backup-${Date.now()}.patch` was predictable. Inline
    // randomUUID() in `${tmpdir()}/...${randomUUID()}...` was not
    // enough either — the CodeQL query still flags any write directly
    // inside tmpdir() because the file inherits the world-writable
    // /tmp parent. The recognised safe pattern is fs.mkdtemp() which
    // atomically creates a 0700-perm subdirectory only the current
    // user can write to; everything we drop inside that dir is safe
    // by virtue of its parent's perms + the unguessable random suffix.
    const workDir = await fsp.mkdtemp(p.join(o.tmpdir(), "dpf-backup-"));
    try {
      const tmpFile = p.join(workDir, "patch.diff");
      await writeFile(tmpFile, input.diffPatch, "utf-8");

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
      // messages. The script CONTAINS the GitHub token, so the 0700-perm
      // mkdtemp subdir is doubly important — it prevents both symlink
      // pre-creation attacks and other-user read of the token file.
      const askpassScript = p.join(workDir, "askpass.sh");
      await writeFile(askpassScript, `#!/bin/sh\necho "${token}"`, { mode: 0o700 });
      await exec(`git push ${JSON.stringify(config.gitRemoteUrl)} HEAD:main`, {
        cwd: gitRoot, timeout,
        env: { ...process.env, GIT_ASKPASS: askpassScript, GIT_TERMINAL_PROMPT: "0" },
      });

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
        void import("@/lib/build/code-graph-refresh").then(({ queueCodeGraphReconcile }) =>
          queueCodeGraphReconcile({
            reason: "git-backup",
            headSha: hash,
            branch: "main",
          })
        ).catch(() => {});
      }

      return { pushed: true };
    } finally {
      // Remove the entire mkdtemp directory — covers both the patch
      // file and the askpass script in one cleanup, even if the work
      // above threw partway through.
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch (err) {
    return { pushed: false, error: err instanceof Error ? err.message : "Git backup push failed" };
  }
}
