import fs from "node:fs";
import path from "node:path";

export function getUserGuideDocsDir() {
  const repoRootPath = path.resolve(process.cwd(), "docs", "user-guide");
  const appPath = path.resolve(process.cwd(), "..", "..", "docs", "user-guide");
  return fs.existsSync(repoRootPath) ? repoRootPath : appPath;
}

export function docsPathExists(docsPath: string): boolean {
  if (docsPath === "/docs") return true;

  const slug = docsPath.replace(/^\/docs\//, "");
  return fs.existsSync(path.join(getUserGuideDocsDir(), `${slug}.md`));
}
