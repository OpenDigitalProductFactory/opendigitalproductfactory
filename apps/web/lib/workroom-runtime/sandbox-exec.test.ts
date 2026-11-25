import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";

import { buildSandboxExecArgs, createSandboxExecActuator, readSandboxExecOwner, type SandboxExecOwner } from "./sandbox-exec-actuator";
import { execSandbox, sandboxExecOwnerFor, spawnSandboxExec, type SandboxExecSession } from "./sandbox-exec";

const owner = (overrides: Partial<SandboxExecOwner> = {}): SandboxExecOwner => ({
  kind: "sandbox-exec", command: ["sh", "-c", "echo ok"], env: {}, workdir: null, user: null, interactive: false, ...overrides });
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
      owner({ workdir: "/workspace/../../host" }),
      owner({ workdir: "relative" }),
      owner({ user: "root --privileged" }),
      { ...owner(), interactive: "yes" },
    ]) expect(() => readSandboxExecOwner(bad)).toThrow("sandbox_exec_admission_refused");
  });

  it("builds a fixed argv: observed container, values only in the environment, never privileged", () => {
    const args = buildSandboxExecArgs(owner({ env: { TOKEN: "secret" }, workdir: "/workspace", user: "node", interactive: true }), sandboxId);
    expect(args).toEqual(["--host", "unix:///var/run/docker.sock", "exec", "-i", "-w", "/workspace", "-u", "node", "-e", "TOKEN",
      sandboxId, "timeout", "-k", "3", "24h", "sh", "-c", "echo ok"]);
    expect(args.join(" ")).not.toMatch(/secret|--privileged/);
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
      .toEqual({ kind: "sandbox-exec", command: ["node", "-e", "1"], env: { OPENAI_API_KEY: "", TOKEN: "t" }, workdir: "/workspace", user: "node", interactive: true });
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
