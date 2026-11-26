import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

import { createSandboxDbOperator, sandboxDbThroughActuator, stagedRestorePipe } from "./sandbox-db-actuator";

const buildId = "FB-12345678";
const ids = { postgres: "a".repeat(64), "sandbox-postgres": "b".repeat(64) } as const;

function harness(options: { slot?: { containerId: string; status: string } | null; sandbox?: { name: string; running: boolean } } = {}) {
  const runs: string[][] = [];
  const pipes: Array<[string[], string[]]> = [];
  const operate = createSandboxDbOperator({
    readSlot: async () => (options.slot === undefined ? { containerId: "dpf-sandbox-1", status: "in_use" } : options.slot),
    observeSandbox: async () => options.sandbox ?? { name: "dpf-sandbox-1", running: true },
    resolveService: async (service) => ids[service],
    run: async (args) => { runs.push(args); return { exitCode: 0, stdout: "accepting connections", stderr: "" }; },
    pipe: async (from, to) => { pipes.push([from, to]); return { exitCode: 0, stderr: "" }; },
  });
  return { operate, runs, pipes };
}

describe("createSandboxDbOperator", () => {
  it("checks readiness in the project's sandbox Postgres and seeds it from the project's own Postgres", async () => {
    const h = harness();
    await expect(h.operate({ owner: { kind: "build", buildId }, operation: "ready" })).resolves.toEqual({ ok: true, detail: "accepting connections" });
    expect(h.runs).toEqual([["exec", ids["sandbox-postgres"], "pg_isready", "-U", "dpf"]]);
    await expect(h.operate({ owner: { kind: "build", buildId }, operation: "seed" })).resolves.toMatchObject({ ok: true });
    expect(h.pipes).toEqual([[["exec", ids.postgres, "pg_dump", "--data-only", "--no-blobs", "-U", "dpf", "dpf"],
      ["exec", "-i", ids["sandbox-postgres"], "psql", "-v", "ON_ERROR_STOP=1", "-U", "dpf", "dpf"]]]);
  });

  it("reports a seed whose SQL fails as not ok, with the error detail", async () => {
    const operate = createSandboxDbOperator({
      readSlot: async () => ({ containerId: "dpf-sandbox-1", status: "in_use" }),
      observeSandbox: async () => ({ name: "dpf-sandbox-1", running: true }),
      resolveService: async (service) => ids[service],
      run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
      // psql with ON_ERROR_STOP exits 3 on the first failed statement.
      pipe: async () => ({ exitCode: 3, stderr: 'ERROR:  relation "Missing" does not exist' }),
    });
    await expect(operate({ owner: { kind: "build", buildId }, operation: "seed" }))
      .resolves.toEqual({ ok: false, detail: 'ERROR:  relation "Missing" does not exist' });
  });

  it.each([
    ["a build without a slot", { slot: null }, {}],
    ["a released slot", { slot: { containerId: "dpf-sandbox-1", status: "available" } }, {}],
    ["a slot bound to another sandbox", { slot: { containerId: "dpf-sandbox-2-1", status: "in_use" } }, {}],
    ["a stopped sandbox", { sandbox: { name: "dpf-sandbox-1", running: false } }, {}],
    ["a caller-chosen container", {}, { container: "dpf-postgres-1" }],
    ["an unknown operation", {}, { operation: "restore" }],
    ["a malformed build", {}, { owner: { kind: "build", buildId: "FB-1; drop" } }],
  ])("refuses %s before Docker", async (_label, options, overrides) => {
    const h = harness(options as never);
    await expect(h.operate({ owner: { kind: "build", buildId }, operation: "seed", ...overrides })).rejects.toThrow("sandbox_db_admission_refused");
    expect(h.runs).toHaveLength(0);
    expect(h.pipes).toHaveLength(0);
  });
});

describe("sandboxDbThroughActuator", () => {
  it("stays local without the actuator, needs a build with it, and never runs Docker after a lost reply", async () => {
    const bodies: unknown[] = [];
    await expect(sandboxDbThroughActuator(buildId, "ready", async () => false, async () => ({ ok: true, detail: "" }))).resolves.toBeNull();
    await expect(sandboxDbThroughActuator(undefined, "seed", async () => true, async (body) => { bodies.push(body); return {}; }))
      .resolves.toMatchObject({ ok: false });
    await expect(sandboxDbThroughActuator(buildId, "seed", async () => true, async (body) => { bodies.push(body); return { ok: true, detail: "" }; }))
      .resolves.toEqual({ ok: true, detail: "" });
    await expect(sandboxDbThroughActuator(buildId, "ready", async () => true, async () => { throw new Error("lost"); })).resolves.toMatchObject({ ok: false });
    expect(bodies).toEqual([{ owner: { kind: "build", buildId }, operation: "seed" }]);
  });
});

describe("stagedRestorePipe", () => {
  // A dump that writes the given SQL and exits with dumpCode; a psql that
  // records its input and exits 0 at EOF, as psql does with an open transaction.
  async function restore(sql: string, dumpCode: number, failOutput = false) {
    let received = "";
    let unhandledOutputError = false;
    const killSource = vi.fn((): true => true);
    const spawnDocker = (args: string[]) => {
      const child = Object.assign(new EventEmitter(), {
        stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true,
      });
      if (args.includes("pg_dump")) {
        child.kill = killSource;
        setImmediate(() => {
          if (failOutput) {
            child.stdout.write(sql);
            try {
              child.stdout.emit("error", new Error("dump output failed"));
            } catch {
              unhandledOutputError = true;
            }
            child.emit("close", dumpCode);
            return;
          }
          child.stdout.end(sql);
          child.stdout.once("end", () => setImmediate(() => child.emit("close", dumpCode)));
        });
      } else {
        child.stdin.on("data", (chunk: Buffer) => { received += chunk.toString("utf8"); });
        child.stdin.once("finish", () => setImmediate(() => child.emit("close", 0)));
      }
      return child as never;
    };
    const result = await stagedRestorePipe(spawnDocker, ["exec", "pg", "pg_dump"], ["exec", "-i", "sb", "psql"]);
    return { result, received, unhandledOutputError, killSource };
  }

  it("commits only after the dump exits cleanly", async () => {
    const { result, received } = await restore('INSERT INTO "A" VALUES (1);\n', 0);
    expect(result.exitCode).toBe(0);
    expect(received).toBe('BEGIN;\nINSERT INTO "A" VALUES (1);\n\nCOMMIT;\n');
  });

  it("never commits a dump that fails after emitting valid SQL, and reports failure", async () => {
    const { result, received } = await restore('INSERT INTO "A" VALUES (1);\nINSERT INTO "B" VALUES (2);\n', 1);
    expect(result.exitCode).toBe(1);
    expect(received).toBe('BEGIN;\nINSERT INTO "A" VALUES (1);\nINSERT INTO "B" VALUES (2);\n');
    expect(received).not.toContain("COMMIT");
  });

  it("abandons the restore on a dump stdout error even if both children close with exit code zero", async () => {
    const { result, received, unhandledOutputError, killSource } = await restore('INSERT INTO "A" VALUES (1);\n', 0, true);
    expect(unhandledOutputError).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(killSource).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    expect(received).toBe('BEGIN;\nINSERT INTO "A" VALUES (1);\n');
  });
});
