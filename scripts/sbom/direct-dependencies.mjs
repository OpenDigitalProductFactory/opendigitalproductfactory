// Direct dependencies across every independently resolved lockfile root.
// Kept separate so acquisition and disposition gates share one observation
// without importing each other's command-line entry points.

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { listDirectDependencies } from "./generate-platform-sbom.mjs";
import { LOCKFILE_ROOTS, repoWorkspacePath } from "./lockfile-roots.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function listAllDirectDependencies(repoRoot = ROOT) {
  const merged = new Map();
  for (const root of LOCKFILE_ROOTS) {
    for (const [name, info] of listDirectDependencies(join(repoRoot, root.dir))) {
      if (!merged.has(name)) merged.set(name, { workspaces: new Set(), kinds: new Set(), versions: new Set() });
      const into = merged.get(name);
      for (const workspace of info.workspaces) into.workspaces.add(repoWorkspacePath(root, workspace));
      for (const kind of info.kinds) into.kinds.add(kind);
      for (const version of info.versions) into.versions.add(version);
    }
  }
  return merged;
}
