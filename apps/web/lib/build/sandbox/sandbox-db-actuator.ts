// The sandbox database steps of a Build Studio build, executed by the private
// actuator (BI-224F56F1, design row "Sandbox and build work").
//
// The build pipeline waits for the shared sandbox Postgres and seeds it with a
// data-only copy of production. In the qualified portal the actuator does
// both. The request names a build and an operation, never a container:
// admission re-reads the build's sandbox slot, which must be in use and bound
// to the sandbox the actuator observed, and both databases are the bound
// project's own `postgres` and `sandbox-postgres` services.

import { isRecord } from "@/lib/shared/coerce";

export type SandboxDbOperation = "ready" | "seed";
type DockerResult = { exitCode: number; stdout: string; stderr: string };

const BUILD_ID = /^FB-[A-Za-z0-9-]{1,64}$/;
const refuse = (): never => { throw new Error("sandbox_db_admission_refused"); };

/** Actuator side. A refused request never reaches Docker. */
export function createSandboxDbOperator(deps: {
  readSlot: (buildId: string) => Promise<{ containerId: string; status: string } | null>;
  observeSandbox: () => Promise<{ name: string; running: boolean }>;
  resolveService: (service: "postgres" | "sandbox-postgres") => Promise<string>;
  run: (args: string[]) => Promise<DockerResult>;
  pipe: (from: string[], to: string[]) => Promise<{ exitCode: number; stderr: string }>;
}) {
  return async (value: unknown): Promise<{ ok: boolean; detail: string }> => {
    if (!isRecord(value) || Object.keys(value).length !== 2 || !isRecord(value.owner)
      || Object.keys(value.owner).length !== 2 || value.owner.kind !== "build"
      || typeof value.owner.buildId !== "string" || !BUILD_ID.test(value.owner.buildId)
      || (value.operation !== "ready" && value.operation !== "seed")) return refuse();
    const slot = await deps.readSlot(value.owner.buildId);
    const sandbox = await deps.observeSandbox();
    if (slot?.status !== "in_use" || !sandbox.running || slot.containerId !== sandbox.name) return refuse();
    const sandboxDb = await deps.resolveService("sandbox-postgres");
    if (value.operation === "ready") {
      const result = await deps.run(["exec", sandboxDb, "pg_isready", "-U", "dpf"]);
      return { ok: result.exitCode === 0, detail: result.stdout.slice(-512) };
    }
    const production = await deps.resolveService("postgres");
    const result = await deps.pipe(["exec", production, "pg_dump", "--data-only", "-U", "dpf", "dpf"],
      // A failed statement stops psql non-zero and rolls the whole seed back.
      ["exec", "-i", sandboxDb, "psql", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-U", "dpf", "dpf"]);
    return { ok: result.exitCode === 0, detail: result.stderr.slice(-1024) };
  };
}

type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

/** Portal side. Null keeps the local path (no actuator mounted). Without a
 * build the qualified portal refuses; a lost reply is a failure, never a
 * local Docker call. */
export async function sandboxDbThroughActuator(buildId: string | undefined, operation: SandboxDbOperation,
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<{ ok: boolean; detail: string } | null> {
  const observation = await import("../../../../../scripts/lib/scope-writer-observation.mjs");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  if (!buildId) return { ok: false, detail: "The qualified portal runs sandbox database steps only for a build's reserved sandbox." };
  try {
    const result = await (send ?? ((body, ms) => observation.runActuatorSandboxDb(body, { timeoutMs: ms })))(
      { owner: { kind: "build", buildId }, operation }, operation === "seed" ? 11 * 60_000 : 30_000);
    if (isRecord(result) && typeof result.ok === "boolean" && typeof result.detail === "string") return { ok: result.ok, detail: result.detail };
  } catch { /* reported below */ }
  return { ok: false, detail: "The private actuator did not confirm the sandbox database step." };
}
