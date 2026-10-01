/**
 * Trigger builders for `@/lib/jobs`.
 *
 * A module of its own so a test that mocks the `jobs` client
 * (`vi.mock("@/lib/jobs", ...)`) still gets the real, pure trigger builders.
 */
import type { JobCronTrigger } from "./types";

/** A cron trigger: `triggers: [cron("0 3 * * *")]`. */
export function cron(schedule: string): JobCronTrigger {
  return { cron: schedule };
}
