/**
 * `@/lib/jobs` — the platform's durable-job facade (spec
 * docs/superpowers/specs/2026-09-25-postgres-durable-job-engine-design.md §5.1,
 * §6 step 1).
 *
 * Job functions and send sites import from here, never from `inngest` or the
 * adapter; scripts/check-no-direct-job-engine-import.mjs enforces it. The engine behind
 * `jobs` is currently the Inngest adapter, with no behaviour change; the owned
 * Postgres engine replaces it behind this same surface.
 */
import { inngestJobsClient } from "./inngest-adapter";
import type { JobsClient } from "./types";

export const jobs: JobsClient = inngestJobsClient;

export { cron } from "./triggers";
export * from "./types";
export type * from "./events";
