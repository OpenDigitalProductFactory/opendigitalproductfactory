import { readdirSync, readFileSync, statSync } from "node:fs";
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
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (SKIP.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.tsx?$/.test(entry)) {
        files.push({ path: relative(root, full).split("\\").join("/"), content: readFileSync(full, "utf8") });
      }
    }
  };
  for (const dir of SCANNED_DIRS) walk(join(root, dir));
  return files;
}
