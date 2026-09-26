/**
 * The Inngest adapter behind the `@/lib/jobs` facade (spec
 * docs/superpowers/specs/2026-09-25-postgres-durable-job-engine-design.md §6
 * step 1).
 *
 * Every call passes straight through to the same Inngest client the platform
 * has always used — same app id, same off-threadpool transport, same options
 * and handler objects — so runtime behaviour is unchanged. The facade's types
 * are the narrowing; this file only bridges them to the SDK's generics.
 *
 * This directory is the only place allowed to import `inngest`
 * (scripts/check-no-direct-job-engine-import.mjs).
 */
import { Inngest } from "inngest";

import { createOffThreadpoolFetchTransport } from "@/lib/network/off-threadpool-fetch";

import type { JobFunction, JobsClient } from "./types";

const inngestTransport = createOffThreadpoolFetchTransport();

export const inngestClient = new Inngest({
  id: "dpf-platform",
  fetch: inngestTransport.fetch,
});

type InngestCreateFunctionArgs = Parameters<typeof inngestClient.createFunction>;
type InngestSendPayload = Parameters<typeof inngestClient.send>[0];

export const inngestJobsClient: JobsClient = {
  createFunction(options, handler) {
    return inngestClient.createFunction(
      options as unknown as InngestCreateFunctionArgs[0],
      handler as unknown as InngestCreateFunctionArgs[1],
    ) as unknown as JobFunction;
  },
  send(payload) {
    return inngestClient.send(payload as unknown as InngestSendPayload);
  },
};
