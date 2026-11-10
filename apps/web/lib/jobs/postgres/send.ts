import type { JobSendEvent } from "../types";
import { jobsPool } from "./pool";
import { insertEvents } from "./store";

/** Record events for the Postgres engine; the worker fans them out. */
export function sendToPostgres(events: Array<JobSendEvent & { id: string }>): Promise<string[]> {
  return insertEvents(jobsPool(), events);
}
