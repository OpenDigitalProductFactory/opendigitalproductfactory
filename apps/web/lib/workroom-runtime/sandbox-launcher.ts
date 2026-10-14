// Start a long-lived agent CLI process inside the sandbox container with its
// stdio piped back to the portal (BI-05715F4C). One-shot dispatch uses
// runSandboxAgentCli; a supervised session needs the process to stay up across
// turns, so this spawns `docker exec -i` and hands the streams to an adapter.
//
// Secrets never enter the command line: each variable is named with `-e NAME`
// (no value), so docker copies it from this process's own environment, which is
// built per launch and never inherits the portal's provider keys.

import type { ChildProcess } from "node:child_process";

import { lazyChildProcess } from "@/lib/shared/lazy-node";

import type { JsonRpcStreams } from "./json-rpc-peer";

const SANDBOX_CONTAINER = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";

export type RuntimeProcess = JsonRpcStreams & {
  onStderr(listener: (chunk: Buffer | string) => void): void;
  kill(): void;
};

export type RuntimeLaunch = {
  /** A shell script run with `sh -c` inside the container. */
  script: string;
  /** Variables the script reads; their values never appear in argv. */
  env: Record<string, string>;
  cwd: string;
};

export type RuntimeLauncher = (launch: RuntimeLaunch) => RuntimeProcess;

/** Names a launch may pass; anything else is refused rather than silently dropped. */
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;

export const sandboxRuntimeLauncher: RuntimeLauncher = (launch) => {
  const names = Object.keys(launch.env);
  for (const name of names) if (!ENV_NAME.test(name)) throw new Error(`Invalid runtime variable name ${name}`);
  const args = ["exec", "-i", "-w", launch.cwd, ...names.flatMap((name) => ["-e", name]), SANDBOX_CONTAINER, "sh", "-c", launch.script];
  const env: Record<string, string> = { PATH: process.env.PATH ?? "", ...launch.env };
  for (const key of ["DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "SystemRoot", "HOME", "USERPROFILE"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  const child: ChildProcess = lazyChildProcess().spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"], env: env as NodeJS.ProcessEnv });
  return {
    write: (line) => { child.stdin?.write(line); },
    onData: (listener) => { child.stdout?.on("data", listener); },
    onStderr: (listener) => { child.stderr?.on("data", listener); },
    onClose: (listener) => {
      child.on("close", (code: number | null) => listener(code));
      child.on("error", () => listener(null));
    },
    end: () => { child.stdin?.end(); },
    kill: () => { child.kill("SIGTERM"); },
  };
};
