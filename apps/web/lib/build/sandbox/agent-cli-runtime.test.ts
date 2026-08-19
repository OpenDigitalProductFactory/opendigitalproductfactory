// apps/web/lib/build/sandbox/agent-cli-runtime.test.ts
//
// Security coverage for BI-AFEF038A: writeSandboxFile must stream file content
// (potentially a secret — OAuth token, mcp-config JWT, codex auth.json) through
// the child's stdin, NEVER embedded in the `docker exec` command. If the content
// were in argv it would show up in `ps` / /proc, container exec logs, and any
// rejected-exec error string — which is exactly the leak this BI closes.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";

// ── Spawn mock infrastructure (mirrors codex-cli-adapter.test.ts) ─────────────

interface MockProcess extends EventEmitter {
  stdin: {
    write: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
  };
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  /** All bytes handed to stdin.write, concatenated. */
  stdinData: string;
}

function makeMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdinData = "";
  proc.stdin = {
    write: vi.fn((data: unknown, cb?: (err?: Error | null) => void) => {
      proc.stdinData += String(data);
      cb?.();
      return true;
    }),
    end: vi.fn(),
    on: vi.fn(),
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

const mockSpawn = vi.fn();

vi.mock("@/lib/shared/lazy-node", () => ({
  lazyChildProcess: () => ({
    spawn: (...args: unknown[]) => mockSpawn(...args),
  }),
  lazyUtil: () => ({ promisify: (fn: Function) => fn }),
}));

import { writeSandboxFile, dockerExecWriteStdin } from "./agent-cli-runtime";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("writeSandboxFile (BI-AFEF038A — content via stdin, not argv)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SECRET = "sk-ant-oat01-SUPER-SECRET-TOKEN-abc123";

  it("uses `docker exec -i` and never puts the content (raw or base64) in argv", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/claude-oauth-token.txt",
      content: SECRET,
      mode: "644",
    });
    proc.emit("close", 0);
    await p;

    const [cmd, args] = mockSpawn.mock.calls[0] as [string, string[]];
    expect(cmd).toBe("docker");
    // -i is required so the host stdin is wired to the container stdin.
    expect(args).toContain("-i");

    const argvJoined = args.join(" ");
    // The raw secret must not be in argv.
    expect(argvJoined).not.toContain(SECRET);
    // Neither may its base64 encoding — that decodes straight back to the secret,
    // which is the precise leak vector BI-AFEF038A closes.
    const b64 = Buffer.from(SECRET).toString("base64");
    expect(argvJoined).not.toContain(b64);
    // No `echo '<payload>'` staging anywhere in the command.
    expect(argvJoined).not.toMatch(/echo '/);
  });

  it("streams the base64 payload through stdin (the ONLY channel the secret uses)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/claude-oauth-token.txt",
      content: SECRET,
      mode: "644",
    });
    proc.emit("close", 0);
    await p;

    expect(proc.stdin.write).toHaveBeenCalledTimes(1);
    expect(proc.stdin.end).toHaveBeenCalled();
    // What went to stdin decodes back to exactly the original content bytes.
    expect(Buffer.from(proc.stdinData, "base64").toString("utf-8")).toBe(SECRET);
    // The container reconstructs the file by decoding stdin, not an argv payload.
    const innerCmd = (mockSpawn.mock.calls[0] as [string, string[]])[1].join(" ");
    expect(innerCmd).toContain("base64 -d");
  });

  it("single-quotes the target path and applies chmod (no path/shell breakout)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/cli-run.sh",
      content: "#!/bin/sh\necho hi",
      mode: "755",
    });
    proc.emit("close", 0);
    await p;

    const inner = (mockSpawn.mock.calls[0] as [string, string[]])[1].at(-1) as string;
    expect(inner).toBe("base64 -d > '/tmp/cli-run.sh' && chmod 755 '/tmp/cli-run.sh'");
  });

  it("adds --user node and chown when requested (node-user + root-written config)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/cli-mcp.json",
      content: "{}",
      chownNodeUser: true,
      mode: "644",
    });
    proc.emit("close", 0);
    await p;

    const args = (mockSpawn.mock.calls[0] as [string, string[]])[1];
    const inner = args.at(-1) as string;
    expect(inner).toContain("chown node:node '/tmp/cli-mcp.json'");
    expect(inner).toContain("chmod 644 '/tmp/cli-mcp.json'");
  });

  it("prefixes mkdir -p when mkdirParents is given, and omits chmod when mode omitted", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/root/.codex/auth.json",
      content: "{}",
      mkdirParents: "/root/.codex",
    });
    proc.emit("close", 0);
    await p;

    const inner = (mockSpawn.mock.calls[0] as [string, string[]])[1].at(-1) as string;
    expect(inner).toBe("mkdir -p '/root/.codex' && base64 -d > '/root/.codex/auth.json'");
    expect(inner).not.toContain("chmod");
  });

  it("rejects secret-free when docker exits non-zero (no payload in the error)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/x.txt",
      content: SECRET,
      mode: "644",
    });
    proc.stderr.emit("data", Buffer.from("sh: cannot create /tmp/x.txt: permission denied"));
    proc.emit("close", 1);

    await expect(p).rejects.toThrow(/Sandbox file write failed/);
    await p.catch((err: Error) => {
      expect(err.message).not.toContain(SECRET);
      expect(err.message).not.toContain(Buffer.from(SECRET).toString("base64"));
    });
  });

  it("kills the process and rejects after the write timeout", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = writeSandboxFile({
      containerId: "dpf-sandbox-1",
      path: "/tmp/slow.txt",
      content: SECRET,
      mode: "644",
      timeoutMs: 5_000,
    });

    vi.advanceTimersByTime(6_000);

    await expect(p).rejects.toThrow(/timed out/);
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("dockerExecWriteStdin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects on spawn-level error (docker not found)", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = dockerExecWriteStdin({
      containerId: "dpf-sandbox-1",
      innerCommand: "base64 -d > '/tmp/x'",
      input: "aGk=",
    });
    proc.emit("error", new Error("spawn ENOENT"));

    await expect(p).rejects.toThrow("spawn ENOENT");
  });

  it("does not double-settle when both timeout and close fire", async () => {
    const proc = makeMockProcess();
    mockSpawn.mockReturnValue(proc);

    const p = dockerExecWriteStdin({
      containerId: "dpf-sandbox-1",
      innerCommand: "base64 -d > '/tmp/x'",
      input: "aGk=",
      timeoutMs: 5_000,
    });

    vi.advanceTimersByTime(6_000);
    // A late close must be swallowed by the settled flag.
    proc.emit("close", 0);

    await expect(p).rejects.toThrow(/timed out/);
  });
});
