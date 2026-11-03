"use strict";
const { posix, win32 } = require("node:path");

// Desktop aliases require exact namespace and path identity. The POSIX alias
// additionally requires a fresh fact from the same daemon used for inspect;
// native Linux can have distinct /host_mnt and host-root directories.
function previewMountMatches(source, worktree, dockerOperatingSystem) {
  const valid = value => typeof value === "string" && value.length > 0
    && !/[\0\r\n]/.test(value) && !value.split(/[\\/]/).some(part => part === "." || part === "..");
  if (!valid(source) || !valid(worktree)) return false;
  if (/^[a-z]:[\\/]/i.test(worktree)) {
    const desktop = /^\/run\/desktop\/mnt\/host\/([a-z])\/(.*)$/i.exec(source);
    if (desktop) source = `${desktop[1]}:/${desktop[2]}`;
    if (!/^[a-z]:[\\/]/i.test(source)) return false;
    const canonical = value => {
      const normalized = win32.normalize(value).replace(/[\\/]$/, "");
      return normalized[0].toUpperCase() + normalized.slice(1);
    };
    return canonical(source) === canonical(worktree);
  }
  if (!posix.isAbsolute(source) || !posix.isAbsolute(worktree)) return false;
  const canonical = value => posix.normalize(value).replace(/\/$/, "");
  if (canonical(source) === canonical(worktree)) return true;
  return dockerOperatingSystem === "Docker Desktop" && source.startsWith("/host_mnt/")
    && canonical(source.slice("/host_mnt".length)) === canonical(worktree);
}

module.exports = { previewMountMatches };
