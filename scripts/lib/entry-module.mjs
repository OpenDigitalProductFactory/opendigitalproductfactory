// entry-module.mjs — symlink-robust "am I the executed entry script?" check.
//
// The naive guard `process.argv[1] === fileURLToPath(import.meta.url)` breaks
// whenever the caller's spelling of the path and the ESM loader's disagree
// about symlinks: without --preserve-symlinks-main Node realpath-resolves the
// entry module, so a script invoked through a symlinked path (macOS
// `/var/folders` tmpdir resolving to `/private/var`, symlinked checkouts) sees
// import.meta.url name the real path while argv[1] keeps the caller's
// spelling. The guard is then false, main() never runs, and the process exits
// 0 with no output — a silent false "pass" from any gate script invoked that
// way. Compare realpaths so both spellings agree before deciding.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function isEntryModule(importMetaUrl, argvPath = process.argv[1]) {
  if (!argvPath) return false;
  const thisFile = fileURLToPath(importMetaUrl);
  if (argvPath === thisFile) return true;
  try {
    return realpathSync(argvPath) === realpathSync(thisFile);
  } catch {
    // argv[1] (or this file) no longer resolves — not a matching entry path.
    return false;
  }
}
