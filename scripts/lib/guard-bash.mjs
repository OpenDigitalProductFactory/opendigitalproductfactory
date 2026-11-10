import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { GuardRuntimeEnvironmentError } from "./load-pinned-guard-typescript.mjs";

// BI-BA5F777A: WSL's bash.exe cannot consume the native paths used by host
// fixtures. Probe that contract rather than trusting an executable's name.
export function resolveGuardBash({ platform = process.platform, env = process.env,
  exists = existsSync, spawn = spawnSync } = {}) {
  if (platform !== "win32") return "bash";
  const get = (name) => Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  const directories = (get("PATH") ?? "").split(";").filter(Boolean);
  const candidates = [];
  for (const directory of directories) {
    candidates.push(win32.join(directory, "bash.exe"));
    if (exists(win32.join(directory, "git.exe"))) {
      candidates.push(win32.resolve(directory, "..", "bin", "bash.exe"));
    }
  }
  for (const root of [get("ProgramFiles") ?? "C:\\Program Files", get("ProgramFiles(x86)")]) {
    if (root) candidates.push(win32.join(root, "Git", "bin", "bash.exe"));
  }
  if (get("LOCALAPPDATA")) candidates.push(win32.join(get("LOCALAPPDATA"), "Programs", "Git", "bin", "bash.exe"));
  for (const command of new Set(candidates)) {
    const probe = spawn(command, ["--noprofile", "--norc", "-c",
      'case "$OSTYPE" in msys*|cygwin*) test -r "$1" && printf dpf-native-bash;; *) exit 1;; esac',
      "dpf-guard-probe", fileURLToPath(import.meta.url)],
    { env, encoding: "utf8", shell: false, timeout: 5000, windowsHide: true });
    if (!probe.error && probe.status === 0 && probe.stdout === "dpf-native-bash") return command;
  }
  throw new GuardRuntimeEnvironmentError("Host shell tests require Git for Windows Bash with native path support. Install Git for Windows or make its bin directory available to this process; WSL Bash is not a compatible interpreter.");
}

// Return a child-only environment so nested fixtures share the same interpreter.
export function guardShellEnv(env = process.env, { platform = process.platform,
  resolveBash = resolveGuardBash } = {}) {
  if (platform !== "win32") return { ...env };
  const bash = resolveBash({ platform, env });
  const directory = win32.dirname(bash);
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const path = [directory, win32.resolve(directory, "..", "usr", "bin"), env[pathKey]].filter(Boolean).join(";");
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "path")), [pathKey]: path };
}
