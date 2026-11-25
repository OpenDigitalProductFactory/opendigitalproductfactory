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

import { isRecord } from "@/lib/shared/coerce";
import type { RuntimeProcess } from "./sandbox-launcher";

export type SandboxExecOwner = {
  kind: "sandbox-exec";
  command: string[];
  env: Record<string, string>;
  workdir: string | null;
  user: string | null;
  interactive: boolean;
};
type SandboxIdentity = { containerId: string; running: boolean };

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
const WORKDIR = /^\/[A-Za-z0-9_.@/-]{0,1023}$/;
const USER = /^(?:root|node|[0-9]{1,6}(?::[0-9]{1,6})?)$/;
const ARG_LIMIT = 64 * 1024;
const refuse = () => new Error("sandbox_exec_admission_refused");
const plain = (value: string) => !value.includes("\0");

/** A request the actuator will run, or a refusal. Exact keys only. */
export function readSandboxExecOwner(value: unknown): SandboxExecOwner {
  if (!isRecord(value) || Object.keys(value).length !== 6 || value.kind !== "sandbox-exec"
    || !Array.isArray(value.command) || value.command.length < 1 || value.command.length > 256
    || !value.command.every(arg => typeof arg === "string" && arg.length <= ARG_LIMIT && plain(arg))
    || (value.command[0] as string).length === 0
    || !isRecord(value.env) || Object.keys(value.env).length > 32
    || !Object.entries(value.env).every(([name, text]) => ENV_NAME.test(name) && typeof text === "string" && text.length <= ARG_LIMIT && plain(text))
    || !(value.workdir === null || (typeof value.workdir === "string" && WORKDIR.test(value.workdir)
      && !value.workdir.split("/").some(part => part === "..")))
    || !(value.user === null || (typeof value.user === "string" && USER.test(value.user)))
    || typeof value.interactive !== "boolean") throw refuse();
  return { kind: "sandbox-exec", command: [...value.command] as string[], env: { ...value.env } as Record<string, string>,
    workdir: value.workdir as string | null, user: value.user as string | null, interactive: value.interactive };
}

/** The fixed Docker argv. Values travel in the child's environment, never argv. */
export function buildSandboxExecArgs(owner: SandboxExecOwner, containerId: string): string[] {
  return ["--host", "unix:///var/run/docker.sock", "exec", ...(owner.interactive ? ["-i"] : []),
    ...(owner.workdir ? ["-w", owner.workdir] : []), ...(owner.user ? ["-u", owner.user] : []),
    ...Object.keys(owner.env).flatMap(name => ["-e", name]), containerId,
    "timeout", "-k", "3", "24h", ...owner.command];
}

/** Actuator side. A refused request never reaches Docker. */
export function createSandboxExecActuator(deps: { spawn?: typeof spawn } = {}) {
  const run = deps.spawn ?? spawn;
  return async (value: unknown, observeSandbox: () => Promise<SandboxIdentity>): Promise<RuntimeProcess> => {
    const owner = readSandboxExecOwner(value);
    const sandbox = await observeSandbox();
    if (!sandbox.running || !/^[a-f0-9]{64}$/.test(sandbox.containerId)) throw refuse();
    const child = run("/usr/bin/docker", buildSandboxExecArgs(owner, sandbox.containerId),
      { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production", ...owner.env } });
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
