import { lazyExec, lazyPath } from "@/lib/shared/lazy-node";

import {
  buildListTrackedFilesCommand,
  shouldIndexCodeGraphPath,
} from "./path-filter";

const exec = lazyExec();

export function getGitRoot(): string {
  const { resolve } = lazyPath();
  return process.env.PROJECT_ROOT
    ? resolve(process.env.PROJECT_ROOT)
    : resolve(process.cwd(), "..", "..");
}

export function normalizeGitOutput(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function getCurrentHeadSha(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function getCurrentBranch(gitRoot: string): Promise<string | null> {
  const { stdout } = await exec("git rev-parse --abbrev-ref HEAD", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim() || null;
}

export async function isWorkspaceDirty(gitRoot: string): Promise<boolean> {
  const { stdout } = await exec("git status --porcelain", { cwd: gitRoot, timeout: 10_000 });
  return stdout.trim().length > 0;
}

export async function listTrackedFiles(gitRoot: string): Promise<string[]> {
  const { stdout } = await exec(buildListTrackedFilesCommand(), {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}

export async function getChangedFiles(
  gitRoot: string,
  fromSha: string,
  toSha: string,
): Promise<string[]> {
  const { stdout } = await exec(`git diff --name-only ${fromSha}..${toSha}`, {
    cwd: gitRoot,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  return normalizeGitOutput(stdout).filter(shouldIndexCodeGraphPath);
}
