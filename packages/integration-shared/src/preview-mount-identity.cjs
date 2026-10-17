"use strict";
const { posix, win32 } = require("node:path");

// Docker Desktop's Linux daemon reports a Windows bind source in its VM
// namespace. Translate only this known form, and only for a Windows admission.
// Relative paths and traversal never establish a preview's source identity.
function previewMountMatches(source, worktree) {
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
  return posix.isAbsolute(source) && posix.isAbsolute(worktree)
    && posix.normalize(source).replace(/\/$/, "") === posix.normalize(worktree).replace(/\/$/, "");
}

module.exports = { previewMountMatches };
