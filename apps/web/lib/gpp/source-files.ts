import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { SourceFile } from "./unmediated-execute-sites";

/** apps/web, resolved from this module's own location (cwd-independent). */
export const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const SCANNED_DIRS = ["app", "lib", "components"] as const;
const SKIP = new Set(["node_modules", ".next", "generated"]);

/** Every .ts/.tsx source file under the scanned web directories, path relative to apps/web. */
export function readWebSourceFiles(root: string = WEB_ROOT): SourceFile[] {
  const files: SourceFile[] = [];
  // Entry types come from the directory listing itself (withFileTypes), so
  // there is no separate stat-then-read window for a file to change in.
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        files.push({ path: relative(root, full).split("\\").join("/"), content: readFileSync(full, "utf8") });
      }
    }
  };
  for (const dir of SCANNED_DIRS) walk(join(root, dir));
  return files;
}
