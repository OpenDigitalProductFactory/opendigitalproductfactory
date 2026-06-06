import { existsSync as nodeExistsSync } from "node:fs";
import path from "node:path";

interface EnvLike {
  [key: string]: string | undefined;
  DPF_MANAGED_SCRIPT_DIR?: string;
  PROJECT_ROOT?: string;
}

interface ResolveManagedScriptPathOptions {
  env?: EnvLike;
  existsSync?: (candidate: string) => boolean;
}

function normalizeRoot(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pushUnique(roots: string[], candidate: string | null): void {
  if (!candidate || roots.includes(candidate)) return;
  roots.push(candidate);
}

export function managedScriptRootCandidates(env: EnvLike = process.env): string[] {
  const roots: string[] = [];
  const projectRoot = normalizeRoot(env.PROJECT_ROOT) ?? "/workspace";

  pushUnique(roots, normalizeRoot(env.DPF_MANAGED_SCRIPT_DIR));
  pushUnique(roots, "/app/scripts");
  pushUnique(roots, path.posix.join(projectRoot, "scripts"));
  pushUnique(roots, "/workspace/scripts");
  pushUnique(roots, "/host-dpf/scripts");

  return roots;
}

export function resolveManagedScriptPath(
  scriptName: string,
  options?: ResolveManagedScriptPathOptions,
): string {
  const roots = managedScriptRootCandidates(options?.env ?? process.env);
  const existsSync = options?.existsSync ?? nodeExistsSync;

  for (const root of roots) {
    const candidate = path.posix.join(root, scriptName);
    if (existsSync(candidate)) return candidate;
  }

  return path.posix.join(roots[0] ?? "/app/scripts", scriptName);
}
