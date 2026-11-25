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
// suite that mocks node:child_process gets its own mock, untouched. The
// deliberate Docker integration suites keep their self-gated probes: they are
// named for it (*.docker.test.*, *.network.test.*) or listed below, and each
// skips itself on a host without the daemon or image. Anything else needs
// DPF_TEST_ALLOW_HOST_DOCKER=1, which no unit suite sets.

import { createRequire, syncBuiltinESMExports } from "node:module";
import { expect } from "vitest";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process") as typeof import("node:child_process");

const DOCKER_EXECUTABLE = /(?:^|[\\/])docker(?:\.exe)?$/i;
const DOCKER_COMMAND_LINE = /^\s*(?:\S*[\\/])?docker(?:\.exe)?(?:\s|$)/i;

export class HostDockerInTestError extends Error {
  constructor(what: string) {
    super(`A unit test tried to run the host's Docker (${what}). Inject a fake runner or mock node:child_process; `
      + "set DPF_TEST_ALLOW_HOST_DOCKER=1 only in an integration suite that needs a daemon.");
    this.name = "HostDockerInTestError";
  }
}

/** Suites that exist to exercise a real daemon, each self-gated on its availability. */
const INTEGRATION_SUITE = /\.(?:docker|network)\.test\.[cm]?[jt]sx?$|[\\/]lib[\\/]inference[\\/]local-provider-compose\.test\.ts$/;
export const isDockerIntegrationSuite = (testPath: unknown): boolean =>
  typeof testPath === "string" && INTEGRATION_SUITE.test(testPath);
const currentSuiteMayUseDocker = () => {
  try { return isDockerIntegrationSuite(expect.getState().testPath); } catch { return false; }
};

export const reachesHostDocker = (file: unknown, commandLine = false): boolean =>
  typeof file === "string" && (commandLine ? DOCKER_COMMAND_LINE : DOCKER_EXECUTABLE).test(file);

if (process.env.DPF_TEST_ALLOW_HOST_DOCKER !== "1") {
  type Launcher = (...args: unknown[]) => unknown;
  const guard = (name: "spawn" | "spawnSync" | "execFile" | "execFileSync" | "exec" | "execSync", commandLine: boolean) => {
    const original = childProcess[name] as unknown as Launcher;
    const wrapped = function (this: unknown, ...args: unknown[]) {
      if (reachesHostDocker(args[0], commandLine) && !currentSuiteMayUseDocker()) {
        throw new HostDockerInTestError(`${name} ${String(args[0]).slice(0, 80)}`);
      }
      return original.apply(this, args);
    };
    // Keep util.promisify(exec/execFile) resolving to { stdout, stderr }.
    const custom = (original as unknown as { [key: symbol]: unknown })[Symbol.for("nodejs.util.promisify.custom")];
    if (typeof custom === "function") {
      Object.defineProperty(wrapped, Symbol.for("nodejs.util.promisify.custom"), {
        value: (...args: unknown[]) => {
          if (reachesHostDocker(args[0], commandLine) && !currentSuiteMayUseDocker()) {
            return Promise.reject(new HostDockerInTestError(`${name} ${String(args[0]).slice(0, 80)}`));
          }
          return (custom as Launcher)(...args);
        },
      });
    }
    (childProcess as unknown as Record<string, unknown>)[name] = wrapped;
  };
  guard("spawn", false);
  guard("spawnSync", false);
  guard("execFile", false);
  guard("execFileSync", false);
  guard("exec", true);
  guard("execSync", true);
  syncBuiltinESMExports();
}
