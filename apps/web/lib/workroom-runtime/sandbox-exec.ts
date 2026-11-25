// Portal side of commands in the canonical sandbox (BI-224F56F1).
//
// Callers keep building their `docker exec` argv. Without the private actuator
// it is spawned as before. In the qualified portal the argv is read as one
// sandbox-exec request (command, environment, working directory, user) and
// sent over the actuator stream; the container named in the argv must be the
// canonical sandbox, and the actuator execs only into the sandbox it observed.
// Any other Docker call fails like a failed exec and never runs locally.

import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import type { ChildProcess, ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";

import { lazyChildProcess } from "@/lib/shared/lazy-node";
import type { RuntimeProcess } from "./sandbox-launcher";
import { readSandboxExecOwner, type SandboxExecOwner } from "./sandbox-exec-actuator";

export const canonicalSandboxContainer = () => process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
export const QUALIFIED_PORTAL_DOCKER_REFUSAL = "This Docker operation is not available in the qualified portal.";

/** The `docker exec` argv as a sandbox-exec request, or null. */
export function sandboxExecOwnerFor(args: readonly string[], env: NodeJS.ProcessEnv = process.env): SandboxExecOwner | null {
  if (args[0] !== "exec") return null;
  const owner: SandboxExecOwner = { kind: "sandbox-exec", command: [], env: {}, workdir: null, user: null, interactive: false };
  let index = 1;
  for (; index < args.length && args[index].startsWith("-"); index++) {
    const flag = args[index];
    if (flag === "-i" || flag === "--interactive") { owner.interactive = true; continue; }
    const value = args[++index];
    if (value === undefined) return null;
    if (flag === "-w" || flag === "--workdir") owner.workdir = value;
    else if (flag === "-u" || flag === "--user") owner.user = value;
    else if (flag === "-e" || flag === "--env") {
      const split = value.indexOf("=");
      const name = split < 0 ? value : value.slice(0, split);
      const text = split < 0 ? env[name] : value.slice(split + 1);
      if (text !== undefined) owner.env[name] = text;
      else if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
    } else return null;
  }
  if (args[index] !== canonicalSandboxContainer()) return null;
  owner.command = args.slice(index + 1);
  try { return readSandboxExecOwner(owner); } catch { return null; }
}

/** The actuator stream for one exec; stdin carries bytes as given. */
export type SandboxExecSession = Omit<RuntimeProcess, "write"> & { write(bytes: string | Buffer): void };

type Deps = {
  available?: () => Promise<boolean>;
  open?: (owner: SandboxExecOwner) => SandboxExecSession;
  spawn?: (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;
};

async function defaultAvailable() {
  return (await import("../../../../scripts/lib/scope-writer-observation.mjs")).usesPrivateActuator();
}
async function defaultOpen(owner: SandboxExecOwner): Promise<SandboxExecSession> {
  return (await import("../../../../scripts/lib/scope-writer-observation.mjs")).openActuatorRuntimeSession(owner) as SandboxExecSession;
}

/** Drop-in for `spawn("docker", ["exec", ...])`, routed in the qualified portal. */
export function spawnSandboxExec(args: readonly string[], options: SpawnOptions = {}, deps: Deps = {}): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean; killed: boolean; exitCode: number | null; pid?: number };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.exitCode = null;
  const queued: Array<[Buffer, () => void] | null> = [];
  let target: { write: (bytes: Buffer, done: () => void) => void; end: () => void; kill: (signal?: NodeJS.Signals) => void } | null = null;
  let closed = false;
  const finish = (code: number | null, signal: NodeJS.Signals | null = null) => {
    if (closed) return;
    closed = true;
    child.exitCode = code;
    child.stdout.end();
    child.stderr.end();
    child.emit("exit", code, signal);
    setImmediate(() => child.emit("close", code, signal));
  };
  const drain = () => {
    for (const item of queued.splice(0)) {
      if (item === null) target?.end();
      else target?.write(item[0], item[1]);
    }
  };
  child.stdin = new Writable({
    write(chunk: Buffer | string, encoding, done) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      if (closed) { done(); return; }
      if (target) target.write(bytes, done); else queued.push([bytes, done]);
    },
    final(done) { if (target) target.end(); else queued.push(null); done(); },
  });
  child.kill = (signal?: NodeJS.Signals) => {
    child.killed = true;
    if (target) target.kill(signal);
    else finish(null, signal ?? "SIGTERM");
    return true;
  };
  void (async () => {
    if (!await (deps.available ?? defaultAvailable)().catch(() => true)) {
      const real = (deps.spawn ?? ((command, argv, opts) => lazyChildProcess().spawn(command, argv as string[], opts)))("docker", args, options);
      child.pid = real.pid;
      real.stdout?.pipe(child.stdout, { end: false });
      real.stderr?.pipe(child.stderr, { end: false });
      real.on("error", error => { if (!closed) child.emit("error", error); });
      real.on("close", (code: number | null, signal: NodeJS.Signals | null) => finish(code, signal));
      target = { write: (bytes, done) => { if (real.stdin) real.stdin.write(bytes, () => done()); else done(); },
        end: () => { real.stdin?.end(); }, kill: signal => { real.kill(signal); } };
      real.stdin?.on("error", () => {});
      drain();
      return;
    }
    const owner = sandboxExecOwnerFor(args, { ...process.env, ...(options.env ?? {}) });
    if (!owner || closed) {
      if (!owner) child.stderr.write(`${QUALIFIED_PORTAL_DOCKER_REFUSAL}\n`);
      finish(closed ? child.exitCode : 1);
      return;
    }
    const session = deps.open ? deps.open(owner) : await defaultOpen(owner);
    session.onData(bytes => { if (!closed) child.stdout.write(bytes); });
    session.onStderr(bytes => { if (!closed) child.stderr.write(bytes); });
    session.onClose(code => finish(code, code === null ? "SIGTERM" : null));
    target = { write: (bytes, done) => { session.write(bytes); done(); }, end: () => session.end(), kill: () => session.kill() };
    if (child.killed) { session.kill(); return; }
    drain();
  })().catch(error => {
    child.stderr.write(`${QUALIFIED_PORTAL_DOCKER_REFUSAL}\n`);
    if (!closed) child.emit("error", error instanceof Error ? error : new Error(String(error)));
    finish(1);
  });
  return child as unknown as ChildProcessWithoutNullStreams;
}

export type SandboxExecResult = { stdout: string; stderr: string };

/** Drop-in for `promisify(exec)(\`docker exec ...\`)`: resolves on exit 0 and
 * rejects with code, stdout and stderr otherwise, or on timeout. */
export function execSandbox(args: readonly string[], options: { timeout?: number; maxBuffer?: number; input?: string | Buffer } = {},
  deps: Deps = {}): Promise<SandboxExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawnSandboxExec(args, { stdio: ["pipe", "pipe", "pipe"] }, deps);
    const limit = options.maxBuffer ?? 1024 * 1024;
    let stdout = "", stderr = "", overflow = false, timedOut = false;
    const timer = options.timeout ? setTimeout(() => { timedOut = true; proc.kill("SIGTERM"); }, options.timeout) : null;
    proc.stdout?.on("data", (bytes: Buffer) => { stdout += bytes.toString("utf8"); if (stdout.length > limit) { overflow = true; proc.kill("SIGTERM"); } });
    proc.stderr?.on("data", (bytes: Buffer) => { stderr = (stderr + bytes.toString("utf8")).slice(-limit); });
    proc.on("error", () => {});
    proc.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (timer) clearTimeout(timer);
      if (code === 0 && !overflow && !timedOut) { resolve({ stdout, stderr }); return; }
      const reason = timedOut ? "timed out" : overflow ? "maxBuffer exceeded" : `exited with code ${code ?? signal}`;
      reject(Object.assign(new Error(`Command failed: docker ${args.slice(0, 3).join(" ")} … ${reason}\n${stderr.slice(-2048)}`),
        { code: code ?? undefined, signal: signal ?? undefined, killed: timedOut || overflow, stdout, stderr }));
    });
    if (options.input !== undefined) proc.stdin?.end(options.input); else proc.stdin?.end();
  });
}

/**
 * A host command line as the argv a POSIX shell would give it, or null when
 * the shell would do more than split words: any expansion, redirection, pipe,
 * list, glob, or tilde/comment at the host level refuses rather than guesses.
 */
export function splitHostCommand(line: string): string[] | null {
  const words: string[] = [];
  let word = "", started = false;
  for (let index = 0; index < line.length;) {
    const char = line[index];
    if (char === "'") {
      const end = line.indexOf("'", index + 1);
      if (end < 0) return null;
      word += line.slice(index + 1, end); started = true; index = end + 1;
    } else if (char === "\"") {
      started = true; index++;
      for (;;) {
        if (index >= line.length) return null;
        const inner = line[index];
        if (inner === "\"") { index++; break; }
        if (inner === "$" || inner === "`") return null;
        if (inner === "\\" && index + 1 < line.length && "$`\"\\\n".includes(line[index + 1])) { word += line[index + 1]; index += 2; continue; }
        word += inner; index++;
      }
    } else if (char === "\\") {
      if (index + 1 >= line.length) return null;
      word += line[index + 1]; started = true; index += 2;
    } else if (char === " " || char === "\t") {
      if (started) { words.push(word); word = ""; started = false; }
      index++;
    } else if ("|&;<>()$`\n\r*?[".includes(char) || (!started && (char === "#" || char === "~"))) {
      return null;
    } else { word += char; started = true; index++; }
  }
  if (started) words.push(word);
  return words;
}

/** Drop-in for `promisify(exec)("docker exec <sandbox> ...")`. Without the
 * actuator the line runs exactly as before; in the qualified portal it must be
 * a plain `docker exec` line and goes through the actuator, or it is refused. */
export async function execSandboxCommandLine(line: string, options: { timeout?: number; maxBuffer?: number } = {},
  deps: Deps = {}): Promise<SandboxExecResult> {
  if (!await (deps.available ?? defaultAvailable)().catch(() => true)) {
    const { promisify } = await import("node:util");
    const { stdout, stderr } = await promisify(lazyChildProcess().exec)(line, { ...options, encoding: "utf8" });
    return { stdout: String(stdout), stderr: String(stderr) };
  }
  const argv = splitHostCommand(line);
  if (!argv || argv[0] !== "docker") {
    throw Object.assign(new Error(`Command failed: ${QUALIFIED_PORTAL_DOCKER_REFUSAL}`), { code: 1, stdout: "", stderr: QUALIFIED_PORTAL_DOCKER_REFUSAL });
  }
  return execSandbox(argv.slice(1), options, { ...deps, available: async () => true });
}
