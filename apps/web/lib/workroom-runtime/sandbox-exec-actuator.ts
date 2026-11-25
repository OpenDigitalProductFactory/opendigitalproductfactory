// Commands in the canonical sandbox, executed by the private actuator
// (BI-224F56F1, design row "Sandbox and build work").
//
// Build Studio and the routing CLI adapters run commands inside the sandbox.
// In the qualified portal they cannot reach Docker, so the actuator runs the
// exec over the workroom stream transport. The request names a command,
// environment, working directory and user, never a container: the actuator
// execs only into the sandbox it observed itself, bound to the signed
// retirement's sandbox ID, and never with --privileged. The sandbox already
// runs agent code; this hands the portal no host, Docker or writer authority.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isRecord } from "@/lib/shared/coerce";
import type { RuntimeProcess } from "./sandbox-launcher";

export type SandboxExecOwner = {
  kind: "sandbox-exec";
  command: string[];
  env: Record<string, string>;
  workdir: string | null;
  user: string | null;
  interactive: boolean;
  /** `docker exec -d`: the command outlives the request (a dev server). */
  detach: boolean;
};
type SandboxIdentity = { containerId: string; running: boolean };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
/** Names that steer loaders, shells, Node or the Docker client; never forwarded. */
const RESERVED_ENV = /^(?:LD_|DYLD_|DOCKER_|NODE_|NPM_CONFIG_|BASH_FUNC_)|^(?:PATH|HOME|SHELL|ENV|BASH_ENV|IFS|PS4|PROMPT_COMMAND|TMPDIR|USER)$/i;
const WORKDIR = /^\/[A-Za-z0-9_.@/-]{0,1023}$/;
const USER = /^(?:root|node|[0-9]{1,6}(?::[0-9]{1,6})?)$/;
const ARG_LIMIT = 64 * 1024;
const refuse = () => new Error("sandbox_exec_admission_refused");
const plain = (value: string) => !value.includes("\0");
/** Docker's env-file reader scans lines of at most 64 KiB in bytes: the whole
 * `NAME=value` line, newline included, measured as UTF-8. */
const envLine = (name: string, text: string) => `${name}=${text}\n`;
const envLineFits = (name: string, text: string) => Buffer.byteLength(envLine(name, text), "utf8") <= ARG_LIMIT;

/** A request the actuator will run, or a refusal. Exact keys only. */
export function readSandboxExecOwner(value: unknown): SandboxExecOwner {
  if (!isRecord(value) || Object.keys(value).length !== 7 || value.kind !== "sandbox-exec"
    || !Array.isArray(value.command) || value.command.length < 1 || value.command.length > 256
    || !value.command.every(arg => typeof arg === "string" && arg.length <= ARG_LIMIT && plain(arg))
    || (value.command[0] as string).length === 0
    || !isRecord(value.env) || Object.keys(value.env).length > 32
    || !Object.entries(value.env).every(([name, text]) => ENV_NAME.test(name) && !RESERVED_ENV.test(name)
      && typeof text === "string" && envLineFits(name, text) && plain(text) && !/[\r\n]/.test(text))
    || !(value.workdir === null || (typeof value.workdir === "string" && WORKDIR.test(value.workdir)
      && !value.workdir.split("/").some(part => part === "..")))
    || !(value.user === null || (typeof value.user === "string" && USER.test(value.user)))
    || typeof value.interactive !== "boolean" || typeof value.detach !== "boolean"
    || (value.detach && value.interactive)) throw refuse();
  return { kind: "sandbox-exec", command: [...value.command] as string[], env: { ...value.env } as Record<string, string>,
    workdir: value.workdir as string | null, user: value.user as string | null, interactive: value.interactive,
    detach: value.detach };
}

/** The fixed Docker argv. Caller values reach only the container, through a
 * private env file; never argv and never the Docker client's own environment. */
export function buildSandboxExecArgs(owner: SandboxExecOwner, containerId: string, envFile?: string): string[] {
  return ["--host", "unix:///var/run/docker.sock", "exec", ...(owner.interactive ? ["-i"] : []), ...(owner.detach ? ["-d"] : []),
    ...(owner.workdir ? ["-w", owner.workdir] : []), ...(owner.user ? ["-u", owner.user] : []),
    ...(envFile ? ["--env-file", envFile] : []), containerId,
    // A detached command is not tied to this stream; the sandbox owns its lifetime.
    ...(owner.detach ? [] : ["timeout", "-k", "3", "24h"]), ...owner.command];
}

type EnvFile = { path: string; remove: () => Promise<void> };

/** A 0600 env file in a fresh 0700 directory, removed when the exec ends.
 * A failed write removes the directory and any partial file before it throws. */
export async function writePrivateEnvFile(env: Record<string, string>,
  fs: { writeFile: typeof writeFile } = { writeFile }): Promise<EnvFile> {
  const dir = await mkdtemp(join(tmpdir(), "dpf-sandbox-exec-"));
  const path = join(dir, "env");
  const remove = () => rm(dir, { recursive: true, force: true });
  try {
    await fs.writeFile(path, Object.entries(env).map(([name, text]) => envLine(name, text)).join(""), { mode: 0o600, flag: "wx" });
  } catch (error) {
    await remove().catch(() => undefined);
    throw error;
  }
  return { path, remove };
}

/** The Docker client's own environment: fixed, never the caller's. */
export const SANDBOX_EXEC_CLIENT_ENV = Object.freeze({ PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" });

/** Actuator side. A refused request never reaches Docker. */
export function createSandboxExecActuator(deps: { spawn?: typeof spawn; writeEnvFile?: (env: Record<string, string>) => Promise<EnvFile> } = {}) {
  const run = deps.spawn ?? spawn;
  return async (value: unknown, observeSandbox: () => Promise<SandboxIdentity>): Promise<RuntimeProcess> => {
    const owner = readSandboxExecOwner(value);
    const sandbox = await observeSandbox();
    if (!sandbox.running || !/^[a-f0-9]{64}$/.test(sandbox.containerId)) throw refuse();
    const envFile = Object.keys(owner.env).length > 0 ? await (deps.writeEnvFile ?? (env => writePrivateEnvFile(env)))(owner.env) : null;
    const cleanup = () => { void envFile?.remove().catch(() => undefined); };
    let child: ReturnType<typeof spawn>;
    try {
      child = run("/usr/bin/docker", buildSandboxExecArgs(owner, sandbox.containerId, envFile?.path),
        { stdio: ["pipe", "pipe", "pipe"], env: { ...SANDBOX_EXEC_CLIENT_ENV } });
    } catch (error) {
      cleanup();
      throw error;
    }
    child.once("close", cleanup);
    child.once("error", cleanup);
    child.stdin?.on("error", () => child.kill("SIGTERM"));
    return {
      write: (line: string | Buffer) => {
        if (!child.stdin || child.stdin.writableLength + Buffer.byteLength(line) > 1024 * 1024) child.kill("SIGTERM");
        else child.stdin.write(line);
      },
      onData: listener => { child.stdout?.on("data", listener); },
      onStderr: listener => { child.stderr?.on("data", listener); },
      onClose: listener => { child.once("close", listener); child.once("error", () => listener(null)); },
      end: () => { child.stdin?.end(); },
      kill: () => { child.stdin?.end(); child.kill("SIGTERM"); },
    };
  };
}
