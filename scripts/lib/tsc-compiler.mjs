// Which TypeScript compiler scripts/run-tsc.mjs runs (BI-2B8D67A9).
//
// TypeScript 7 (the Go-native compiler, root devDependency `typescript7`) is the
// checker. TypeScript 6 stays the workspace's `typescript` dependency because
// TS7 ships no classic compiler API and Next.js, ESLint and the code-graph
// extractors import it as a library; `DPF_TSC=6` selects it as the reference
// compiler for parity runs and the advisory CI job.
//
// TS7 is launched as its native executable, not through its `bin/tsc` shim. On
// Windows that shim runs the binary with execFileSync and turns a signal-killed
// child into a thrown error and exit 1, which reads as a type error. Spawning
// the executable directly keeps `status: null` + signal visible to run-tsc,
// which maps it to the no-verdict exit 88 (BI-27D3DCCD).
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

export const TSC_SELECTOR_ENV = "DPF_TSC";
export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The V8 heap TS6 needs for apps/web (BI-CD7706B5). TS7 is native; it has no V8 heap. */
const TS6_HEAP_ARGS = ["--max-old-space-size=8192"];

function packageDirFrom(fromDir, packageName) {
  const require = createRequire(pathToFileURL(join(fromDir, "/")));
  return dirname(require.resolve(`${packageName}/package.json`));
}

/**
 * Pure selection. `resolveTs6Entry(cwd)` and `resolveTs7Exe()` are injected so
 * the choice is testable without either compiler on disk.
 * @returns {{ version: 6 | 7, command: string, args: string[] }}
 */
export async function selectTscCompiler({ env, cwd, execPath, forwardedArgs, resolveTs6Entry, resolveTs7Exe }) {
  const choice = String(env[TSC_SELECTOR_ENV] ?? "").trim();
  if (choice === "6") {
    return { version: 6, command: execPath, args: [...TS6_HEAP_ARGS, await resolveTs6Entry(cwd), ...forwardedArgs] };
  }
  if (choice !== "" && choice !== "7") {
    throw new Error(`${TSC_SELECTOR_ENV} must be 6 or 7 (got "${choice}")`);
  }
  return { version: 7, command: await resolveTs7Exe(), args: [...forwardedArgs] };
}

/** TS6 resolves from the caller's package, so each workspace keeps its own pin. */
export function resolveTs6Entry(cwd) {
  return join(packageDirFrom(cwd, "typescript"), "bin", "tsc");
}

/** TS7's native executable, located by the package's own resolver. */
export async function resolveTs7Exe(repoRoot = REPO_ROOT) {
  const pkgDir = packageDirFrom(repoRoot, "typescript7");
  const { default: getExePath } = await import(pathToFileURL(join(pkgDir, "lib", "getExePath.js")).href);
  return getExePath();
}
