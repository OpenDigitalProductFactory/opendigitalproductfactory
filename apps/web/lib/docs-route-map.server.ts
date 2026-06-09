import { getCwd, lazyFs, lazyPath } from "@/lib/shared/lazy-node";

export function getUserGuideDocsDir() {
  const p = lazyPath();
  const fs = lazyFs();
  const cwd = getCwd();
  const repoRootPath = p.resolve(cwd, "docs", "user-guide");
  const appPath = p.resolve(cwd, "..", "..", "docs", "user-guide");
  return fs.existsSync(repoRootPath) ? repoRootPath : appPath;
}

export function docsPathExists(docsPath: string): boolean {
  if (docsPath === "/docs") return true;

  const p = lazyPath();
  const fs = lazyFs();
  const slug = docsPath.replace(/^\/docs\//, "");
  return fs.existsSync(p.join(getUserGuideDocsDir(), `${slug}.md`));
}
