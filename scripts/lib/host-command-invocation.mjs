import { realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, join } from "node:path";

function isFile(path) {
  try { return statSync(path).isFile(); } catch { return false; }
}

function environmentValue(env, name) {
  const key = Object.keys(env).sort().find(key => key.toLowerCase() === name);
  return key === undefined ? undefined : env[key];
}

/** Resolve Windows pnpm without interpreting argv as cmd.exe source.
 * Support npm global installs, Corepack shims, the local-CI JS shim and native
 * standalone pnpm. Never execute or parse a batch file to discover its target.
 */
export function resolveHostCommandInvocation(
  command,
  args,
  { platform = process.platform, env = process.env } = {},
) {
  if (platform !== "win32" || !/^pnpm(?:\.(?:cmd|bat|exe|com|cjs|js))?$/i.test(basename(command))) {
    return { command, args };
  }
  let executable = command;
  if (!/[\\/]/.test(command)) {
    // Match Node's Windows lookup: absent PATH inherits the parent's search
    // path; an explicitly empty PATH remains empty. Duplicate keys use the
    // first lexicographic spelling, as child_process does.
    const explicitPath = environmentValue(env, "path");
    const pathValue = explicitPath ?? environmentValue(process.env, "path") ?? "";
    const pathExt = environmentValue(env, "pathext");
    const extensions = /\./.test(command) ? [""] : [...(pathExt || ".exe;.com;.cmd;.bat").split(";"), ""];
    executable = pathValue.split(explicitPath === undefined ? delimiter : ";").filter(Boolean)
      .map(entry => entry.replace(/^"(.*)"$/, "$1"))
      .flatMap(entry => extensions.map(extension => join(entry, `${command}${extension}`)))
      .find(isFile);
    if (!executable) throw new Error("Cannot resolve pnpm on PATH; install pnpm or enable Corepack.");
  }
  if (/\.(?:exe|com)$/i.test(executable)) return { command: executable, args };
  const target = realpathSync(executable);
  const directory = dirname(target);
  const entrypoint = /\.(?:cjs|js)$/i.test(target) ? target : [
    join(directory, "pnpm.cjs"),
    join(directory, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    join(directory, "node_modules", "corepack", "dist", "pnpm.js"),
    join(directory, "..", "node_modules", "pnpm", "bin", "pnpm.cjs"),
    join(directory, "..", "node_modules", "corepack", "dist", "pnpm.js"),
    join(directory, "..", "pnpm", "bin", "pnpm.cjs"),
    join(directory, "..", "corepack", "dist", "pnpm.js"),
    join(directory, "..", "dist", "pnpm.js"),
  ].find(isFile);
  if (!entrypoint) throw new Error(`Cannot resolve pnpm JavaScript entrypoint beside ${executable}; reinstall pnpm or enable Corepack.`);
  return { command: process.execPath, args: [entrypoint, ...args] };
}
