// scripts/sbom/lockfile-roots.mjs
//
// The one list of independently resolved pnpm lockfiles whose packages DPF
// ships or builds from. Every supply-chain gate iterates this list, so moving a
// workspace into its own lockfile can never silently drop it out of the OSV
// scan, the release-age floor or the New Dependency Gate.
//
// `dir` is repo-relative and holds pnpm-lock.yaml + pnpm-workspace.yaml.
// `workspacePrefix` maps that lockfile's importer keys back to repo paths
// ("." in apps/mobile's lockfile is the repo's "apps/mobile").
//
// Plan 2026-09-08 M6 split apps/mobile out of the platform workspace
// (founder-approved 2026-09-25).

export const LOCKFILE_ROOTS = Object.freeze([
  Object.freeze({ id: "platform", dir: ".", workspacePrefix: "" }),
  Object.freeze({ id: "mobile", dir: "apps/mobile", workspacePrefix: "apps/mobile" }),
]);

/** Map an importer key from a root's lockfile to a repo-relative workspace path. */
export function repoWorkspacePath(root, importer) {
  if (!root.workspacePrefix) return importer;
  if (importer === ".") return root.workspacePrefix;
  return `${root.workspacePrefix}/${importer}`.replace(/\/\.\//g, "/");
}

/** Repo-relative path of a root's file. */
export function rootFile(root, file) {
  return root.dir === "." ? file : `${root.dir}/${file}`;
}
