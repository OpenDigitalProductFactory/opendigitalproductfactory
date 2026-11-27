/**
 * BI-9F7192F9: the COPY child-process failure contract, with real child
 * processes. Node scripts stand in for psql; the spawn-failure case spawns a
 * binary that does not exist, so the ENOENT 'error' event is real.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { describe, expect, it, vi } from "vitest";

import { runAdmittedPsqlCopy, type SpawnPsql } from "./sanitized-clone-copy-process";

const DESTINATION_OK = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));";
const SOURCE_OK = "process.stdout.write('row\\n'); process.exit(0);";
const node = (script: string, options: SpawnOptions) => spawn(process.execPath, ["-e", script], options);

/** Tracks every spawned child so a test can prove none is left running. */
function tracked(make: (role: "destination" | "source", call: number, options: SpawnOptions) => ChildProcess) {
  const children: ChildProcess[] = [];
  const roles: Array<"destination" | "source"> = [];
  let calls = 0;
  const spawnPsql: SpawnPsql = (args, options) => {
    const role = args[0] === "dest" ? "destination" : "source";
    if (role === "destination") calls += 1;
    const child = make(role, calls, options);
    children.push(child);
    roles.push(role);
    return child;
  };
  const allExited = () => children.every((c) => c.pid === undefined || c.exitCode !== null || c.signalCode !== null);
  const sources = () => roles.filter((role) => role === "source").length;
  return { spawnPsql, children, allExited, sources };
}

const copy = (spawnPsql: SpawnPsql, admitWriter: (name: string) => Promise<void>, n: number) =>
  runAdmittedPsqlCopy({ destinationArgs: ["dest"], sourceArgs: ["src"], writerName: `dpfsc:test:copy:${n}`, admitWriter, destinationEnv: {}, spawnPsql });

describe("admitted psql COPY child processes", () => {
  it("fails a later COPY with the original ENOENT when its destination cannot spawn, before admission, with nothing unhandled", async () => {
    const t = tracked((role, call, options) =>
      role === "source" ? node(SOURCE_OK, options)
        : call === 3 ? spawn("/nonexistent/dpf-psql-for-test", ["dest"], options)
          : node(DESTINATION_OK, options));
    const admitted: string[] = [];
    const admit = vi.fn(async (name: string) => {
      admitted.push(name);
      if (name.endsWith(":3")) await new Promise(() => {}); // admission would wait; the spawn failure must win
    });
    await copy(t.spawnPsql, admit, 1);
    await copy(t.spawnPsql, admit, 2);
    const error = await copy(t.spawnPsql, admit, 3).catch((e: unknown) => e);
    expect((error as NodeJS.ErrnoException).code).toBe("ENOENT");
    expect(t.sources()).toBe(2); // no source was spawned for the failed copy
    expect(admitted).toEqual(["dpfsc:test:copy:1", "dpfsc:test:copy:2", "dpfsc:test:copy:3"]);
    expect(t.allExited()).toBe(true);
  });

  it("fails at once when the destination exits before admission, keeping its exit as the cause", async () => {
    const t = tracked((role, _call, options) => node(role === "source" ? SOURCE_OK : "process.exit(3);", options));
    const error = await copy(t.spawnPsql, async () => { await new Promise(() => {}); }, 1).catch((e: unknown) => e);
    expect(String((error as Error).message)).toMatch(/destination psql failed \(exit 3\)|exited before it was admitted/);
    expect(t.children).toHaveLength(1);
    expect(t.allExited()).toBe(true);
  });

  it("drains the destination and keeps the admission error when the fence refuses the writer", async () => {
    const t = tracked((role, _call, options) => node(role === "source" ? SOURCE_OK : DESTINATION_OK, options));
    const refusal = new Error("fence_lost: refused");
    await expect(copy(t.spawnPsql, async () => { throw refusal; }, 1)).rejects.toBe(refusal);
    expect(t.children).toHaveLength(1);
    expect(t.allExited()).toBe(true);
  });

  it("drains both children and keeps the source failure as the cause", async () => {
    const t = tracked((role, _call, options) => node(role === "source" ? "process.exit(7);" : DESTINATION_OK, options));
    await expect(copy(t.spawnPsql, async () => {}, 1)).rejects.toThrow(/source psql failed \(exit 7\)/);
    expect(t.children).toHaveLength(2);
    expect(t.allExited()).toBe(true);
  });
});
