/**
 * `@/lib/jobs` — the platform's durable-job facade (spec
 * docs/superpowers/specs/2026-09-25-postgres-durable-job-engine-design.md §5.1,
 * §6 step 1).
 *
 * Job functions and send sites import from here, never from `inngest` or the
 * adapter; scripts/check-no-direct-job-engine-import.mjs enforces it. The engine behind
 * `jobs` is the Inngest adapter unless DPF_JOBS_ENGINE routes functions to the
 * owned Postgres engine (§6 step 2, BI-85E6EF14).
 */
import { inngestJobsClient } from "./inngest-adapter";
import { createRoutingJobsClient, readJobsEngineSelection } from "./routing";
import type { JobsClient } from "./types";

/**
 * With DPF_JOBS_ENGINE unset this is the Inngest adapter itself. Set to
 * `postgres`, functions route to the owned engine (./routing.ts); its sender
 * is loaded on first send, so job modules never import `pg`.
 */
export const jobs: JobsClient = createRoutingJobsClient(
  readJobsEngineSelection(),
  inngestJobsClient,
  async (events) => (await import("./postgres/send")).sendToPostgres(events),
);

export { cron } from "./triggers";
export * from "./types";
export type * from "./events";
