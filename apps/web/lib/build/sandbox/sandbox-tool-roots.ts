// apps/web/lib/build/sandbox/sandbox-tool-roots.ts
//
// BI-972A386D: where a build's agentic sandbox tools act. With worktree
// isolation on, the build branch, its commit (capture-assembled-change) and its
// review verification all live in the build's own worktree — resolveBuildWorkdir
// — as do the CLI dispatchers. The agentic file and command tools were hard-wired
// to the shared /workspace root, so a specialist changed a tree the build never
// committed or verified (FB-8255C0E5 reached review with no commit).
//
// The sandbox container sees the repo at /workspace; the portal sees the same
// volume at /sandbox-workspace, which is where the fs-based tools read and write.

import { resolveBuildWorkdir } from "./build-branch";

const SANDBOX_WORKSPACE = "/workspace";
const PORTAL_MOUNT = "/sandbox-workspace";

export type SandboxToolRoots = {
  /** The build's working directory inside the sandbox container. */
  workdir: string;
  /** The same directory through the portal's mount of the sandbox volume. */
  mount: string;
};

export function sandboxToolRoots(buildId: string): SandboxToolRoots {
  const workdir = resolveBuildWorkdir(buildId, SANDBOX_WORKSPACE);
  return { workdir, mount: PORTAL_MOUNT + workdir.slice(SANDBOX_WORKSPACE.length) };
}

/**
 * The roots, with the build's worktree materialized first when isolation is on
 * and its .git link is missing — so a tool never writes into a bare directory
 * that a later worktree recreate would clear.
 */
export async function prepareSandboxToolRoots(buildId: string): Promise<SandboxToolRoots> {
  const roots = sandboxToolRoots(buildId);
  if (roots.workdir === SANDBOX_WORKSPACE) return roots;
  const { access } = (await import("@/lib/shared/lazy-node")).lazyFsPromises();
  const linked = await access(`${roots.mount}/.git`).then(() => true, () => false);
  if (!linked) {
    const { ensureBuildWorktree } = await import("./build-branch");
    await ensureBuildWorktree(buildId).catch(() => undefined);
  }
  return roots;
}
