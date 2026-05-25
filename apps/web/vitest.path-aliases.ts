import { existsSync as nodeExistsSync } from "fs";
import { resolve } from "path";

type AliasEntry = {
  find: string | RegExp;
  replacement: string;
};

type BuildNodeModuleAliasesOptions = {
  webDir: string;
  rootDir: string;
  existsSync?: (path: string) => boolean;
  resolvePath?: (...parts: string[]) => string;
};

function packageFile(
  { webDir, rootDir, existsSync = nodeExistsSync, resolvePath = resolve }: BuildNodeModuleAliasesOptions,
  ...pathParts: string[]
): string {
  const webPath = resolvePath(webDir, "node_modules", ...pathParts);
  if (existsSync(webPath)) return webPath;

  return resolvePath(rootDir, "node_modules", ...pathParts);
}

export function buildNodeModuleAliases(options: BuildNodeModuleAliasesOptions): AliasEntry[] {
  return [
    { find: "next/server", replacement: packageFile(options, "next", "server.js") },
    { find: "react/jsx-dev-runtime", replacement: packageFile(options, "react", "jsx-dev-runtime.js") },
    { find: "react/jsx-runtime", replacement: packageFile(options, "react", "jsx-runtime.js") },
    { find: "react-dom/server", replacement: packageFile(options, "react-dom", "server.node.js") },
    { find: "react-dom", replacement: packageFile(options, "react-dom", "index.js") },
    { find: "react", replacement: packageFile(options, "react", "index.js") },
  ];
}
