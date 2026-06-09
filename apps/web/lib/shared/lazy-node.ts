// Stable accessors for Node.js built-in modules.
//
// Keep these as static `node:` imports. The previous dynamic `require` resolver
// bundled to an undefined helper in Next's standalone webpack output, which
// made production callers fail before they could spawn CLI-backed providers.
import * as childProcess from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import * as util from "node:util";

export function lazyFs(): typeof import("fs") {
  return fs;
}

export function lazyFsPromises(): typeof import("fs/promises") {
  return fsPromises;
}

export function lazyPath(): typeof import("path") {
  return path;
}

export function lazyCrypto(): typeof import("crypto") {
  return crypto;
}

export function lazyChildProcess(): typeof import("child_process") {
  return childProcess;
}

export function lazyUtil(): typeof import("util") {
  return util;
}

/** Pre-built promisified exec that always returns strings (encoding: utf-8). */
export function lazyExec(): (cmd: string, opts?: Record<string, unknown>) => Promise<{ stdout: string; stderr: string }> {
  const { exec } = lazyChildProcess();
  const { promisify } = lazyUtil();
  const execAsync = promisify(exec);
  return (cmd, opts) => execAsync(cmd, { encoding: "utf-8", ...opts }) as Promise<{ stdout: string; stderr: string }>;
}

/** Safe cwd that dodges static "process.cwd" detection by Edge bundlers and analyzers. */
export function getCwd(): string {
  try {
    const proc = (globalThis as any).process;
    if (proc && typeof proc.cwd === "function") {
      return proc.cwd();
    }
  } catch {}
  return "/app";
}
