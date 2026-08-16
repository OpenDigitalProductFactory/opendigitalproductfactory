import { existsSync } from "node:fs";
import { extname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = "D:\\DPF-worktrees\\inventory-preview-integrity";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const candidate = resolvePath(repoRoot, "apps", "web", specifier.slice(2));
    for (const path of [candidate, `${candidate}.ts`, `${candidate}.tsx`]) {
      if (existsSync(path)) {
        return { url: pathToFileURL(path).href, shortCircuit: true };
      }
    }
  }

  if (specifier.startsWith(".") && context.parentURL && !extname(specifier)) {
    const candidateUrl = new URL(specifier, context.parentURL);
    const candidate = fileURLToPath(candidateUrl);
    for (const path of [`${candidate}.ts`, `${candidate}.tsx`]) {
      if (existsSync(path)) {
        return { url: pathToFileURL(path).href, shortCircuit: true };
      }
    }
  }

  return nextResolve(specifier, context);
}
