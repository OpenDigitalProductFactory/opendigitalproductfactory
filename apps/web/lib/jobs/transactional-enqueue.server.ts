import { canonicalJson } from "@dpf/integration-shared/canonical-json";

import { JOBS_NOTIFY_CHANNEL } from "./postgres/store";
import { readJobsEngineSelection, routesToPostgres, type JobsEngineSelection } from "./routing";

export type TransactionalJobDb = {
  $queryRaw<T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<number>;
};

export type OwnedJobEvent = { id: string; name: string; data: Record<string, unknown> };

/** Enqueue alongside the caller's domain mutation. Never opens its own transaction or uses the external jobs engine. */
export async function enqueueOwnedPostgresJob(tx: TransactionalJobDb, input: {
  functionId: string; event: OwnedJobEvent; now: Date; selection?: JobsEngineSelection;
}): Promise<"inserted" | "replay"> {
  if (!routesToPostgres(input.selection ?? readJobsEngineSelection(), input.functionId)) throw new Error("owned-job-routing-unavailable");
  const { id, name, data } = input.event;
  if (!id || !name || !Number.isFinite(input.now.getTime())) throw new Error("owned-job-invalid-event");
  const encoded = canonicalJson(data);
  const inserted = await tx.$queryRaw<{ id: string }[]>`
    INSERT INTO "JobEvent" ("id", "name", "data", "ts")
    VALUES (${id}, ${name}, ${encoded}::jsonb, (${input.now}::timestamptz AT TIME ZONE 'UTC'))
    ON CONFLICT ("id") DO NOTHING RETURNING "id"`;
  if (inserted.length === 1) {
    // Postgres delivers NOTIFY only after this transaction commits.
    await tx.$executeRaw`SELECT pg_notify(${JOBS_NOTIFY_CHANNEL}, 'event')`;
    return "inserted";
  }
  const [old] = await tx.$queryRaw<{ name: string; data: unknown }[]>`SELECT "name", "data" FROM "JobEvent" WHERE "id" = ${id} FOR UPDATE`;
  if (!old || old.name !== name || canonicalJson(old.data) !== encoded) throw new Error("owned-job-content-conflict");
  return "replay";
}
