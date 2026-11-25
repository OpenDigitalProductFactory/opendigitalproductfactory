import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { buildSandboxExecArgs, createSandboxExecActuator, readSandboxExecOwner, writePrivateEnvFile, type SandboxExecOwner } from "./sandbox-exec-actuator";
import { execSandbox, sandboxExecOwnerFor, spawnSandboxExec, type SandboxExecSession } from "./sandbox-exec";

const owner = (overrides: Partial<SandboxExecOwner> = {}): SandboxExecOwner => ({
  kind: "sandbox-exec", command: ["sh", "-c", "echo ok"], env: {}, workdir: null, user: null, interactive: false, detach: false, ...overrides });
const sandboxId = "c".repeat(64);

function fakeSession(script: (input: Buffer[], session: { out: (text: string) => void; close: (code: number | null) => void }) => void) {
  const opened: SandboxExecOwner[] = [];
  const open = (request: SandboxExecOwner): SandboxExecSession => {
    opened.push(request);
    const events = new EventEmitter();
    const input: Buffer[] = [];
    const api = { out: (text: string) => events.emit("stdout", Buffer.from(text)), close: (code: number | null) => events.emit("close", code) };
    return {
      write: (bytes) => { input.push(Buffer.from(bytes)); },
      onData: listener => { events.on("stdout", listener); },
      onStderr: listener => { events.on("stderr", listener); },
      onClose: listener => { events.on("close", listener); },
      end: () => { setImmediate(() => script(input, api)); },
      kill: () => api.close(null),
    };
  };
  return { open, opened };
}

describe("readSandboxExecOwner", () => {
  it("admits a bounded command with exact keys and refuses anything that could reach the host", () => {
    expect(readSandboxExecOwner(owner({ env: { OPENAI_API_KEY: "" }, workdir: "/workspace", user: "node", interactive: true })))
      .toMatchObject({ workdir: "/workspace", user: "node" });
    for (const bad of [
      { ...owner(), container: "dpf-portal-1" },
      owner({ command: [] }),
      owner({ command: ["sh", "a\0b"] }),
      owner({ env: { "BAD-NAME": "x" } }),
      ...["LD_PRELOAD", "ld_library_path", "DYLD_INSERT_LIBRARIES", "DOCKER_CONFIG", "DOCKER_HOST", "PATH", "NODE_OPTIONS", "HOME", "BASH_ENV"]
        .map(name => owner({ env: { [name]: "/tmp/evil" } })),
      owner({ env: { TOKEN: "a\nPATH=/tmp" } }),
      owner({ workdir: "/workspace/../../host" }),
      owner({ workdir: "relative" }),
      owner({ user: "root --privileged" }),
      { ...owner(), interactive: "yes" },
      owner({ detach: true, interactive: true }),
    ]) expect(() => readSandboxExecOwner(bad)).toThrow("sandbox_exec_admission_refused");
  });

  it("limits each env-file line to 64 KiB in UTF-8 bytes, name, delimiter and newline included", () => {
    const limit = 64 * 1024;
    const fits = "x".repeat(limit - "TOKEN=\n".length);
    expect(readSandboxExecOwner(owner({ env: { TOKEN: fits } })).env.TOKEN).toBe(fits);
    expect(() => readSandboxExecOwner(owner({ env: { TOKEN: `${fits}x` } }))).toThrow("sandbox_exec_admission_refused");
    // 30,000 code units but 90,000 bytes: within a code-unit cap, over Docker's byte limit.
    expect(() => readSandboxExecOwner(owner({ env: { TOKEN: "\u20ac".repeat(30_000) } }))).toThrow("sandbox_exec_admission_refused");
  });

  it("builds a fixed argv: observed container, values only in a private env file, never privileged", () => {
    const args = buildSandboxExecArgs(owner({ env: { TOKEN: "secret" }, workdir: "/workspace", user: "node", interactive: true }), sandboxId, "/tmp/x/env");
    expect(args).toEqual(["--host", "unix:///var/run/docker.sock", "exec", "-i", "-w", "/workspace", "-u", "node", "--env-file", "/tmp/x/env",
      sandboxId, "timeout", "-k", "3", "24h", "sh", "-c", "echo ok"]);
    expect(args.join(" ")).not.toMatch(/secret|--privileged/);
    expect(buildSandboxExecArgs(owner({ detach: true }), sandboxId)).toEqual(["--host", "unix:///var/run/docker.sock", "exec", "-d",
      sandboxId, "sh", "-c", "echo ok"]);
  });
});

describe("createSandboxExecActuator environment", () => {
  it("runs the Docker client with a fixed environment and gives caller values only to the container, then removes them", async () => {
    const { mkdtemp, readFile, stat, access } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const spawned: Array<{ args: string[]; env: unknown }> = [];
    let child: EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean } | undefined;
    let fileText = "", fileMode = 0;
    const spawn = ((_command: string, args: string[], options: { env: unknown }) => {
      spawned.push({ args, env: options.env });
      child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
      return child;
    }) as never;
    const base = await mkdtemp(join(tmpdir(), "sandbox-exec-test-"));
    const writeEnvFile = async (env: Record<string, string>) => {
      const { writeFile, rm } = await import("node:fs/promises");
      const path = join(base, "env");
      await writeFile(path, Object.entries(env).map(([n, v]) => `${n}=${v}\n`).join(""), { mode: 0o600 });
      fileText = await readFile(path, "utf8"); fileMode = (await stat(path)).mode & 0o777;
      return { path, remove: () => rm(path, { force: true }) };
    };
    const actuate = createSandboxExecActuator({ spawn, writeEnvFile });
    await actuate(owner({ env: { OPENAI_API_KEY: "", TOKEN: "secret" } }), async () => ({ containerId: sandboxId, running: true }));
    expect(spawned[0].env).toEqual({ PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production" });
    expect(spawned[0].args).toContain("--env-file");
    expect(spawned[0].args.join(" ")).not.toContain("secret");
    expect(fileText).toBe("OPENAI_API_KEY=\nTOKEN=secret\n");
    expect(fileMode).toBe(0o600);
    child!.emit("close", 0);
    await new Promise(resolve => setTimeout(resolve, 50));
    await expect(access(join(base, "env"))).rejects.toThrow();
  });

  it("writes no env file and passes no --env-file without caller values", async () => {
    const spawned: string[][] = [];
    const spawn = ((_command: string, args: string[]) => {
      spawned.push(args);
      return Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    }) as never;
    await createSandboxExecActuator({ spawn, writeEnvFile: async () => { throw new Error("unexpected"); } })(owner(), async () => ({ containerId: sandboxId, running: true }));
    expect(spawned[0]).not.toContain("--env-file");
  });

  it("removes the directory and a partial file when the production writer fails mid-write", async () => {
    let partial = "";
    const failing = (async (path: string, _data: string, options: { mode: number; flag: string }) => {
      const { writeFile } = await import("node:fs/promises");
      partial = path;
      await writeFile(path, "TOKEN=sec", options);
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    }) as never;
    await expect(writePrivateEnvFile({ TOKEN: "secret" }, { writeFile: failing })).rejects.toThrow("ENOSPC");
    expect(partial).toMatch(/dpf-sandbox-exec-[^/]+\/env$/);
    expect(existsSync(dirname(partial))).toBe(false);
  });
});

describe("createSandboxExecActuator", () => {
  it("execs only into the sandbox it observed and refuses before Docker otherwise", async () => {
    const spawned: string[][] = [];
    const spawn = ((_command: string, args: string[]) => {
      spawned.push(args);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      return child;
    }) as never;
    const actuate = createSandboxExecActuator({ spawn });
    await actuate(owner(), async () => ({ containerId: sandboxId, running: true }));
    expect(spawned[0]).toContain(sandboxId);
    await expect(actuate(owner(), async () => ({ containerId: sandboxId, running: false }))).rejects.toThrow();
    await expect(actuate(owner(), async () => ({ containerId: "dpf-sandbox-1", running: true }))).rejects.toThrow();
    await expect(actuate({ ...owner(), container: "x" }, async () => ({ containerId: sandboxId, running: true }))).rejects.toThrow();
    expect(spawned).toHaveLength(1);
  });
});

describe("sandboxExecOwnerFor", () => {
  it("reads the canonical sandbox's exec argv and nothing else", () => {
    expect(sandboxExecOwnerFor(["exec", "-i", "-e", "OPENAI_API_KEY=", "-e", "TOKEN", "--user", "node", "-w", "/workspace",
      "dpf-sandbox-1", "node", "-e", "1"], { TOKEN: "t" } as unknown as NodeJS.ProcessEnv))
      .toEqual({ kind: "sandbox-exec", command: ["node", "-e", "1"], env: { OPENAI_API_KEY: "", TOKEN: "t" }, workdir: "/workspace", user: "node", interactive: true, detach: false });
    expect(sandboxExecOwnerFor(["exec", "-d", "dpf-sandbox-1", "sh", "-c", "node server.js"])).toMatchObject({ detach: true, interactive: false });
    expect(sandboxExecOwnerFor(["exec", "dpf-portal-1", "sh"])).toBeNull();
    expect(sandboxExecOwnerFor(["exec", "--privileged", "dpf-sandbox-1", "sh"])).toBeNull();
    expect(sandboxExecOwnerFor(["exec", "-t", "dpf-sandbox-1", "sh"])).toBeNull();
    expect(sandboxExecOwnerFor(["run", "--rm", "alpine"])).toBeNull();
    expect(sandboxExecOwnerFor(["exec", "dpf-sandbox-1"])).toBeNull();
  });
});

describe("spawnSandboxExec in the qualified portal", () => {
  it("streams stdin and stdout over the actuator session and reports the exit code", async () => {
    const session = fakeSession((input, api) => { api.out(`got:${Buffer.concat(input).toString()}`); api.close(0); });
    await expect(execSandbox(["exec", "-i", "dpf-sandbox-1", "cat"], { input: "hello" }, { available: async () => true, open: session.open }))
      .resolves.toEqual({ stdout: "got:hello", stderr: "" });
    expect(session.opened).toEqual([owner({ command: ["cat"], interactive: true })]);
  });

  it("refuses another container like a failed exec, without opening anything or spawning locally", async () => {
    const session = fakeSession(() => {});
    let spawned = 0;
    const error = await execSandbox(["exec", "dpf-portal-1", "sh"], {}, { available: async () => true, open: session.open,
      spawn: (() => { spawned++; throw new Error("no"); }) as never }).catch((caught: { code?: number; stderr?: string }) => caught);
    expect(error).toMatchObject({ code: 1 });
    expect((error as { stderr: string }).stderr).toContain("not available in the qualified portal");
    expect(session.opened).toHaveLength(0);
    expect(spawned).toBe(0);
  });

  it("rejects a non-zero exit with its code", async () => {
    const session = fakeSession((_input, api) => api.close(3));
    await expect(execSandbox(["exec", "dpf-sandbox-1", "false"], {}, { available: async () => true, open: session.open }))
      .rejects.toMatchObject({ code: 3 });
  });

  it("spawns docker locally without the actuator", async () => {
    const calls: unknown[][] = [];
    const spawn = ((command: string, args: string[]) => {
      calls.push([command, args]);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough; kill: () => boolean };
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
      setImmediate(() => { child.stdout.write("local"); child.emit("close", 0, null); });
      return child;
    }) as never;
    await expect(execSandbox(["exec", "any-container", "true"], {}, { available: async () => false, spawn })).resolves.toEqual({ stdout: "local", stderr: "" });
    expect(calls).toEqual([["docker", ["exec", "any-container", "true"]]]);
  });

  it("kills the session on timeout", async () => {
    const session = fakeSession(() => {});
    await expect(execSandbox(["exec", "dpf-sandbox-1", "sleep", "9"], { timeout: 20 }, { available: async () => true, open: session.open }))
      .rejects.toMatchObject({ killed: true });
  });

  it("returns a ChildProcess-shaped handle", () => {
    const child = spawnSandboxExec(["exec", "dpf-sandbox-1", "true"], {}, { available: async () => false, spawn: (() => {
      const real = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough; stderr: PassThrough };
      real.stdin = new PassThrough(); real.stdout = new PassThrough(); real.stderr = new PassThrough();
      return real;
    }) as never });
    expect(typeof child.stdin?.write).toBe("function");
    expect(typeof child.stdout?.on).toBe("function");
    expect(typeof child.kill).toBe("function");
  });
});

describe("host command lines", () => {
  it("splits plain words and quotes exactly as sh would", async () => {
    const { splitHostCommand } = await import("./sandbox-exec");
    expect(splitHostCommand(`docker exec dpf-sandbox-1 sh -c 'mkdir -p /tmp/a && chmod 700 /tmp/a'`))
      .toEqual(["docker", "exec", "dpf-sandbox-1", "sh", "-c", "mkdir -p /tmp/a && chmod 700 /tmp/a"]);
    expect(splitHostCommand(`docker exec dpf-sandbox-1 sh -c "cd /workspace && git add -A 2>&1" `))
      .toEqual(["docker", "exec", "dpf-sandbox-1", "sh", "-c", "cd /workspace && git add -A 2>&1"]);
    expect(splitHostCommand(`docker exec c rm -f '/tmp/a b' /tmp/c\\ d`)).toEqual(["docker", "exec", "c", "rm", "-f", "/tmp/a b", "/tmp/c d"]);
    for (const line of [`docker exec c sh -c "$(cat /etc/passwd)"`, "docker exec c ls | sh", "docker exec c ls; rm -rf /",
      "docker exec c ls > /tmp/x", "docker exec c rm /tmp/*", "docker exec c cat ~/x", "docker exec c 'unterminated", "docker exec c `id`"]) {
      expect(splitHostCommand(line)).toBeNull();
    }
  });

  it("routes a plain docker exec line and refuses anything else in the qualified portal", async () => {
    const { execSandboxCommandLine } = await import("./sandbox-exec");
    const session = fakeSession((_input, api) => { api.out("done"); api.close(0); });
    await expect(execSandboxCommandLine(`docker exec dpf-sandbox-1 sh -c 'echo hi'`, {}, { available: async () => true, open: session.open }))
      .resolves.toEqual({ stdout: "done", stderr: "" });
    expect(session.opened).toEqual([owner({ command: ["sh", "-c", "echo hi"] })]);
    await expect(execSandboxCommandLine("docker rm -f dpf-sandbox-1", {}, { available: async () => true, open: session.open })).rejects.toMatchObject({ code: 1 });
    await expect(execSandboxCommandLine("rm -rf /tmp/x", {}, { available: async () => true, open: session.open })).rejects.toMatchObject({ code: 1 });
    expect(session.opened).toHaveLength(1);
  });
});
