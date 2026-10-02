/**
 * Start the Postgres job worker in this process when any function is routed
 * to it (BI-85E6EF14). A no-op with DPF_JOBS_ENGINE unset, so today's runtime
 * opens no extra connections.
 */
import { readJobsEngineSelection } from "../routing";
import { positiveIntFromEnv } from "./durations";
import { isPostgresFunction, registeredFunction, type RegisteredFunction } from "./registry";
import type { JobWorker } from "./worker";

let started: JobWorker | null = null;

export async function startPostgresJobWorker(env: Record<string, string | undefined> = process.env): Promise<JobWorker | null> {
  if (started) return started;
  if (readJobsEngineSelection(env).engine !== "postgres") return null;
  // Importing the function index registers every function; the runtime list
  // already honours DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED.
  const { areScheduledInngestFunctionsEnabled, getInngestFunctionsForRuntime } = await import("@/lib/queue/functions");
  const functions = getInngestFunctionsForRuntime(env)
    .filter(isPostgresFunction)
    .map((fn) => registeredFunction(fn.id()))
    .filter((fn): fn is RegisteredFunction => Boolean(fn));
  if (functions.length === 0) return null;
  const [{ createJobWorker }, { jobsPool }] = await Promise.all([import("./worker"), import("./pool")]);
  started = createJobWorker({
    pool: jobsPool(),
    functions,
    schedulesEnabled: areScheduledInngestFunctionsEnabled(env),
    concurrency: positiveIntFromEnv(env["DPF_JOBS_WORKER_CONCURRENCY"], 8),
  });
  await started.start();
  console.log("[jobs/postgres] worker %s started for %d function(s)", started.owner, functions.length);
  return started;
}
