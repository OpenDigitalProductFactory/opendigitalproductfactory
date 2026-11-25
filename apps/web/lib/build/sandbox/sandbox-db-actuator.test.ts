import { describe, expect, it } from "vitest";

import { createSandboxDbOperator, sandboxDbThroughActuator } from "./sandbox-db-actuator";

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
    expect(h.pipes).toEqual([[["exec", ids.postgres, "pg_dump", "--data-only", "-U", "dpf", "dpf"],
      ["exec", "-i", ids["sandbox-postgres"], "psql", "-U", "dpf", "dpf"]]]);
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
