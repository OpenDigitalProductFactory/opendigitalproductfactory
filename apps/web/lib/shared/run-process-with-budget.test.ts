import { describe, expect, it, vi } from "vitest";
import { PROCESS_TIMEOUT_EXIT_CODE, runProcessWithBudget } from "./run-process-with-budget";

const node = process.execPath;

describe("runProcessWithBudget", () => {
  it("kills a hung process at the budget, removes its container by name, and reports the label", async () => {
    const removeContainer = vi.fn(async () => {});
    const started = Date.now();
    const result = await runProcessWithBudget(node, ["-e", "setTimeout(() => {}, 30_000)"], {
      timeoutMs: 150,
      containerName: "dpf-doctools-abc123",
      timeoutLabel: "converter-timeout",
      removeContainer,
    });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.exitCode).toBe(PROCESS_TIMEOUT_EXIT_CODE);
    expect(result.stderr).toContain("[converter-timeout]");
    expect(removeContainer).toHaveBeenCalledWith("dpf-doctools-abc123");
  });

  it("keeps the promoter's timeout marker when no label is given", async () => {
    const result = await runProcessWithBudget(node, ["-e", "setTimeout(() => {}, 30_000)"], {
      timeoutMs: 100,
      removeContainer: async () => {},
    });
    expect(result.stderr).toContain("[promoter-timeout]");
  });

  it("feeds stdin and returns stdout as exact bytes, so binary output survives", async () => {
    // Echo stdin back, then append bytes that are not valid UTF-8.
    const script =
      "const c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>{" +
      "process.stdout.write(Buffer.concat([Buffer.concat(c),Buffer.from([0xff,0xfe,0x00,0x80])]))})";
    const input = Buffer.from("%PDF-1.7 fixture");
    const result = await runProcessWithBudget(node, ["-e", script], { timeoutMs: 10_000, stdin: input });
    expect(result.exitCode).toBe(0);
    expect(result.stdoutBytes.equals(Buffer.concat([input, Buffer.from([0xff, 0xfe, 0x00, 0x80])]))).toBe(true);
  });

  it("stops a process whose output passes maxStdoutBytes and removes its container", async () => {
    const removeContainer = vi.fn(async () => {});
    const result = await runProcessWithBudget(
      node,
      ["-e", "const b=Buffer.alloc(65536,97);const w=()=>process.stdout.write(b,w);w()"],
      { timeoutMs: 10_000, maxStdoutBytes: 100_000, containerName: "dpf-doctools-big", removeContainer },
    );
    expect(result.outputLimitExceeded).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdoutBytes.length).toBeLessThanOrEqual(100_000);
    expect(removeContainer).toHaveBeenCalledWith("dpf-doctools-big");
  });

  it("propagates a nonzero exit unchanged", async () => {
    const result = await runProcessWithBudget(node, ["-e", "process.exit(3)"], { timeoutMs: 10_000 });
    expect(result.exitCode).toBe(3);
    expect(result.outputLimitExceeded).toBe(false);
    expect(result.stderr).not.toContain("-timeout]");
  });

  it("rejects when the command cannot be spawned", async () => {
    await expect(
      runProcessWithBudget("dpf-no-such-binary-for-test", [], { timeoutMs: 1000 }),
    ).rejects.toThrow();
  });
});
