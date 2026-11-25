// No unit test may reach the host's Docker daemon (BI-224F56F1).
//
// Unit tests run on contributor machines and on the production install's own
// host, where `docker` controls live containers. A test that forgets to fake
// its runner would act on that daemon: during #7226 a sweep test reached the
// real CLI once, listing and able to remove promoter containers. Checking each
// suite by review only fixes the one found, so this setup refuses every
// unmocked launch of the Docker executable at the process boundary instead.
//
// It wraps the real child_process launchers before any test imports them. A
// suite that mocks node:child_process gets its own mock, untouched. Only the
// "unit" vitest project loads this file; the suites that exist to exercise a
// real daemon run in the "docker-integration" project, chosen by file name in
// vitest.config.ts. There is no runtime opt-out.

import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process") as typeof import("node:child_process");

/** The Docker executable as a program path. */
const DOCKER_EXECUTABLE = /(?:^|[\\/])docker(?:\.exe)?$/i;
/** `docker` as a word anywhere in a shell string: `cd x && docker ps`, `sh -c "… docker …"`. */
const DOCKER_IN_SHELL = /(?:^|[\s;&|()'"`=])(?:[^\s;&|()'"`=]*[\\/])?docker(?:\.exe)?(?=$|[\s;&|()'"`])/i;
const SHELL = /(?:^|[\\/])(?:sh|bash|zsh|dash|ash|ksh|cmd|cmd\.exe|powershell|pwsh)(?:\.exe)?$/i;

export class HostDockerInTestError extends Error {
  constructor(what: string) {
    super(`A unit test tried to run the host's Docker (${what}). Inject a fake runner or mock node:child_process; `
      + "a suite that must reach a daemon belongs in the docker-integration project (*.docker.test.*).");
    this.name = "HostDockerInTestError";
  }
}

export const reachesHostDocker = (file: unknown, commandLine = false): boolean =>
  typeof file === "string" && (commandLine ? DOCKER_IN_SHELL : DOCKER_EXECUTABLE).test(file);

/** Whether a launch would run Docker: the program itself, a shell string, or a
 * shell invoked with a command (`sh -c "…"`) or with `shell: true`. */
export function launchReachesHostDocker(name: string, args: unknown[]): boolean {
  const [file, second, third] = args;
  if (name === "exec" || name === "execSync") return reachesHostDocker(file, true);
  if (reachesHostDocker(file)) return true;
  const argv = Array.isArray(second) ? second.filter((arg): arg is string => typeof arg === "string") : [];
  const options = (Array.isArray(second) ? third : second) as { shell?: unknown } | undefined;
  // A string shell option names the program that runs the command.
  if (options && typeof options === "object" && typeof options.shell === "string" && reachesHostDocker(options.shell)) return true;
  if (options && typeof options === "object" && options.shell) return reachesHostDocker([file, ...argv].join(" "), true);
  return typeof file === "string" && SHELL.test(file) && argv.some(arg => reachesHostDocker(arg, true));
}

type Launcher = (...args: unknown[]) => unknown;
const guard = (name: "spawn" | "spawnSync" | "execFile" | "execFileSync" | "exec" | "execSync") => {
  const original = childProcess[name] as unknown as Launcher;
  const refuse = (args: unknown[]) => new HostDockerInTestError(`${name} ${String(args[0]).slice(0, 80)}`);
  const wrapped = function (this: unknown, ...args: unknown[]) {
    if (launchReachesHostDocker(name, args)) throw refuse(args);
    return original.apply(this, args);
  };
  // Keep util.promisify(exec/execFile) resolving to { stdout, stderr }.
  const custom = (original as unknown as { [key: symbol]: unknown })[Symbol.for("nodejs.util.promisify.custom")];
  if (typeof custom === "function") {
    Object.defineProperty(wrapped, Symbol.for("nodejs.util.promisify.custom"), {
      value: (...args: unknown[]) => launchReachesHostDocker(name, args)
        ? Promise.reject(refuse(args)) : (custom as Launcher)(...args),
    });
  }
  (childProcess as unknown as Record<string, unknown>)[name] = wrapped;
};
for (const name of ["spawn", "spawnSync", "execFile", "execFileSync", "exec", "execSync"] as const) guard(name);
syncBuiltinESMExports();
