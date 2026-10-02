/**
 * Engine selection for the `@/lib/jobs` facade (spec 2026-09-25 §5.5, BI-85E6EF14).
 *
 *   DPF_JOBS_ENGINE=inngest (default) — every function on Inngest; the facade
 *     is the Inngest adapter itself and nothing about today changes.
 *   DPF_JOBS_ENGINE=postgres — functions run on the owned Postgres engine.
 *     DPF_JOBS_POSTGRES_FUNCTIONS, a comma-separated list of function ids,
 *     narrows that to those functions for a per-domain soak (§6 step 2); the
 *     rest stay on Inngest.
 *
 * While any function remains on Inngest, `send` delivers to both engines, so
 * an event reaches every function that listens to it whichever engine runs it.
 * The selection is read at process start; changing it is a restart.
 */
import { randomUUID } from "node:crypto";

import { registerPostgresFunction } from "./postgres/registry";
import type { JobsClient, JobSendEvent } from "./types";

export type JobsEngineSelection =
  | { engine: "inngest" }
  | { engine: "postgres"; functions: ReadonlySet<string> | null };

export function readJobsEngineSelection(env: Record<string, string | undefined> = process.env): JobsEngineSelection {
  const engine = env["DPF_JOBS_ENGINE"]?.trim().toLowerCase();
  if (!engine || engine === "inngest") return { engine: "inngest" };
  if (engine !== "postgres") {
    throw new Error(`DPF_JOBS_ENGINE must be "inngest" or "postgres", not ${JSON.stringify(env["DPF_JOBS_ENGINE"])}.`);
  }
  const list = env["DPF_JOBS_POSTGRES_FUNCTIONS"]?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
  return { engine: "postgres", functions: list.length > 0 ? new Set(list) : null };
}

export function routesToPostgres(selection: JobsEngineSelection, functionId: string): boolean {
  return selection.engine === "postgres" && (selection.functions === null || selection.functions.has(functionId));
}

/** True when some function can still be on Inngest, so sends must reach it. */
export function inngestStillServes(selection: JobsEngineSelection): boolean {
  return selection.engine === "inngest" || selection.functions !== null;
}

export function createRoutingJobsClient(
  selection: JobsEngineSelection,
  inngest: JobsClient,
  sendToPostgres: (events: Array<JobSendEvent & { id: string }>) => Promise<string[]>,
): JobsClient {
  if (selection.engine === "inngest") return inngest;
  return {
    createFunction(options, handler) {
      return routesToPostgres(selection, options.id)
        ? registerPostgresFunction(options as never, handler as never)
        : inngest.createFunction(options, handler);
    },
    async send(payload) {
      const list = Array.isArray(payload) ? payload : [payload as JobSendEvent];
      // One id per event, given to both engines, so dedupe and the returned ids agree.
      const events = list.map((event) => ({ ...event, id: event.id ?? `evt_${randomUUID()}` }));
      await sendToPostgres(events);
      if (inngestStillServes(selection)) await inngest.send(events);
      return { ids: events.map((event) => event.id) };
    },
  };
}
