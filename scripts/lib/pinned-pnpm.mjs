export function parseRepositoryPnpmVersion(packageManager) {
  return /^pnpm@([^\s+]+)(?:\+.*)?$/.exec(String(packageManager ?? ""))?.[1] ?? null;
}

export function resolvePinnedPnpmInvocation(command, currentVersion, pinnedVersion, args = []) {
  const current = String(currentVersion ?? "").trim();
  const pinned = String(pinnedVersion ?? "").trim();
  if (!pinned || current === pinned) {
    return { command, args: [...args], version: pinned || current, mode: "host-match" };
  }

  const currentMajor = Number.parseInt(current.split(".")[0] ?? "", 10);
  const prefix = currentMajor >= 11
    ? ["with", pinned]
    : ["dlx", `pnpm@${pinned}`];
  return { command, args: [...prefix, ...args], version: pinned, mode: "pinned-shim" };
}
