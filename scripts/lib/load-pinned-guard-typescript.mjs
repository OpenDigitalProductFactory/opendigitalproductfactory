import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = resolve(LIB_DIR, "../..");
const INSTALL_COMMAND = "pnpm install --frozen-lockfile --ignore-scripts --filter @dpf/repo-guard-runtime";

export const GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME = "GuardRuntimeEnvironmentError";

export class GuardRuntimeEnvironmentError extends Error {
  constructor(message) {
    super(message);
    this.name = GUARD_RUNTIME_ENVIRONMENT_ERROR_NAME;
  }
}

function normalize(path) { return path.replaceAll("\\", "/"); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function importerBlock(lockText) {
  const marker = "  packages/repo-guard-runtime:";
  const start = lockText.indexOf(marker);
  if (start < 0) return "";
  const remainder = lockText.slice(start + marker.length);
  const nextImporter = /\n  \S/.exec(remainder);
  return lockText.slice(start, nextImporter ? start + marker.length + nextImporter.index : undefined);
}

export function loadPinnedGuardTypeScript(options = {}) {
  const repoRoot = resolve(options.repoRoot ?? DEFAULT_REPO_ROOT);
  const runtimeManifestPath = resolve(repoRoot, "packages/repo-guard-runtime/package.json");
  const runtimeRequire = createRequire(runtimeManifestPath);
  const runtimeManifest = options.runtimeManifest ?? JSON.parse(readFileSync(runtimeManifestPath, "utf8"));
  const pin = runtimeManifest.devDependencies?.typescript;
  if (typeof pin !== "string" || !/^\d+\.\d+\.\d+$/.test(pin)) {
    throw new Error("Repo guard TypeScript must be an exact version in packages/repo-guard-runtime/package.json.");
  }
  const lockText = options.lockText ?? readFileSync(resolve(repoRoot, "pnpm-lock.yaml"), "utf8");
  const block = importerBlock(lockText);
  const exactPin = escapeRegex(pin);
  if (!new RegExp(`typescript:\\s*\\n\\s*specifier: ${exactPin}\\s*\\n\\s*version: ${exactPin}(?:\\s|$)`).test(block)) {
    throw new Error(`Repo guard TypeScript ${pin} is not owned by the exact packages/repo-guard-runtime lock importer; run ${INSTALL_COMMAND}.`);
  }

  const resolvePackage = options.resolvePackage ?? (() => runtimeRequire.resolve("typescript/package.json"));
  let resolvedPackagePath;
  try { resolvedPackagePath = resolvePackage(); }
  catch {
    throw new GuardRuntimeEnvironmentError(
      `Pinned repo guard TypeScript ${pin} is missing; run ${INSTALL_COMMAND}.`,
    );
  }
  const normalizedResolved = normalize(resolve(resolvedPackagePath));
  const normalizedRoot = normalize(repoRoot);
  const localPath = `${normalizedRoot}/packages/repo-guard-runtime/node_modules/typescript/package.json`;
  const hoistedPath = `${normalizedRoot}/node_modules/typescript/package.json`;
  const pnpmPath = new RegExp(`^${escapeRegex(normalizedRoot)}/node_modules/\\.pnpm/typescript@${exactPin}(?:_[^/]+)?/node_modules/typescript/package\\.json$`);
  if (normalizedResolved !== localPath && normalizedResolved !== hoistedPath && !pnpmPath.test(normalizedResolved)) {
    throw new GuardRuntimeEnvironmentError(
      `Repo guard TypeScript resolved outside its isolated pnpm graph: ${resolvedPackagePath}; run ${INSTALL_COMMAND}.`,
    );
  }

  const readResolvedPackage = options.readResolvedPackage ?? ((path) => JSON.parse(readFileSync(path, "utf8")));
  const resolvedVersion = readResolvedPackage(resolvedPackagePath).version;
  if (resolvedVersion !== pin) {
    throw new GuardRuntimeEnvironmentError(
      `Repo guard TypeScript expected ${pin} but resolved ${resolvedVersion}.`,
    );
  }
  const loaded = (options.loadModule ?? (() => runtimeRequire("typescript")))();
  if (loaded?.version !== pin) {
    throw new GuardRuntimeEnvironmentError(
      `Repo guard TypeScript expected ${pin} but loaded ${loaded?.version ?? "unknown"}.`,
    );
  }
  return loaded;
}
