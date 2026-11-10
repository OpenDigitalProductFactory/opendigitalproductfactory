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

export type DocsRecoveryKind = "exact" | "alias" | "area-index" | "global-index";

export type PackagedDocsDestination = {
  href: string;
  requestedKey: string;
  resolvedKey: string;
  recoveryKind: DocsRecoveryKind;
};

const DOC_KEY_ALIASES: Record<string, string> = {
  "getting-started": "getting-started/index",
  "workspace/getting-started": "workspace/index",
};

function docsHrefForKey(key: string) {
  return key === "index" ? "/docs" : `/docs/${key}`;
}

export function resolvePackagedDocsDestination(
  requestedPath: string,
  exists: (path: string) => boolean = docsPathExists,
): PackagedDocsDestination {
  const pathname = requestedPath.split("?", 1)[0] ?? "/docs";
  const requestedKey = pathname.replace(/^\/docs\/?/, "").replace(/\/+$/, "") || "index";
  const exactHref = docsHrefForKey(requestedKey);
  if (exists(exactHref)) {
    return { href: exactHref, requestedKey, resolvedKey: requestedKey, recoveryKind: "exact" };
  }

  const aliasKey = DOC_KEY_ALIASES[requestedKey];
  if (aliasKey) {
    const aliasHref = docsHrefForKey(aliasKey);
    if (exists(aliasHref)) {
      return { href: aliasHref, requestedKey, resolvedKey: aliasKey, recoveryKind: "alias" };
    }
  }

  const area = requestedKey.split("/", 1)[0];
  if (area && area !== "index") {
    const areaKey = `${area}/index`;
    const areaHref = docsHrefForKey(areaKey);
    if (exists(areaHref)) {
      return { href: areaHref, requestedKey, resolvedKey: areaKey, recoveryKind: "area-index" };
    }
  }

  return { href: "/docs", requestedKey, resolvedKey: "index", recoveryKind: "global-index" };
}
