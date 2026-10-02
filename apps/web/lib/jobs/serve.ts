/**
 * HTTP entry point for the job engine, used only by `app/api/inngest/route.ts`.
 *
 * Kept apart from `./index` so that importing the facade from a job or a send
 * site never pulls the Next.js serve handler into its module graph.
 */
import { serve } from "inngest/next";

import { inngestClient } from "./inngest-adapter";
import { isPostgresFunction } from "./postgres/registry";
import type { JobFunction } from "./types";

type InngestServeFunctions = Parameters<typeof serve>[0]["functions"];

export function serveJobs(functions: readonly JobFunction[]) {
  // Functions routed to the owned Postgres engine are not Inngest's to serve.
  const inngestFunctions = functions.some(isPostgresFunction) ? functions.filter((fn) => !isPostgresFunction(fn)) : functions;
  return serve({
    client: inngestClient,
    functions: inngestFunctions as unknown as InngestServeFunctions,
  });
}
