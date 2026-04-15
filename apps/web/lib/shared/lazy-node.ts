// Bundler-opaque lazy require for Node.js built-in modules.
// Uses `new Function` to hide require() from Turbopack/NFT static analysis,
// preventing whole-project tracing when server code uses fs, path, or child_process.
//
// Usage:
//   const { readFile, mkdir } = lazyFs();
//   const { join, resolve } = lazyPath();

// Build a require() function that is invisible to Turbopack/NFT static analysis.
// In CJS (Next.js server runtime), `new Function` hides the require call.
// In ESM (vitest), fall back to module.createRequire.
import { createRequire as _createRequire } from "module";

const _require: (mod: string) => unknown = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const fn = new Function("mod", "return require(mod)");
    fn("path"); // probe — throws ReferenceError in pure ESM
    return fn as (mod: string) => unknown;
  } catch {
    // For Node built-ins, the base URL doesn't matter
    return _createRequire(typeof __filename !== "undefined" ? __filename : "/");
  }
})();

export function lazyFs(): typeof import("fs") {
  return _require("fs") as typeof import("fs");
}

export function lazyFsPromises(): typeof import("fs/promises") {
  return _require("fs/promises") as typeof import("fs/promises");
}

export function lazyPath(): typeof import("path") {
  return _require("path") as typeof import("path");
}

export function lazyCrypto(): typeof import("crypto") {
  return _require("crypto") as typeof import("crypto");
}

export function lazyChildProcess(): typeof import("child_process") {
  return _require("child_process") as typeof import("child_process");
}

export function lazyUtil(): typeof import("util") {
  return _require("util") as typeof import("util");
}

/** Pre-built promisified exec that always returns strings (encoding: utf-8). */
export function lazyExec(): (cmd: string, opts?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }> {
  const { exec } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(exec);
  return (cmd, opts) => execAsync(cmd, { encoding: "utf-8", ...opts }) as Promise<{ stdout: string; stderr: string }>;
}
