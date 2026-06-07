// packages/db/src/data-model-mirror-config.ts
// EP-DATA-ARCH Phase 6 (BI-8E274CD3): shared identity for the nightly
// data-model mirror scheduled task. Imported by the seed (packages/db) and the
// scheduler branch (apps/web) so both agree on the task id.

export const DATA_MODEL_MIRROR_TASK_ID = "data-model-mirror-nightly";
export const DATA_MODEL_MIRROR_AGENT_ID = "AGT-BUILD-DA";
export const DATA_MODEL_MIRROR_TASK_TITLE = "Data Model Mirror (nightly)";
export const DATA_MODEL_MIRROR_ROUTE_CONTEXT = "/ea/data-model";
export const DATA_MODEL_MIRROR_SCHEDULE = "0 3 * * *"; // 03:00 UTC daily
export const DATA_MODEL_MIRROR_DEFAULT_TIMEZONE = "UTC";
export const DATA_MODEL_MIRROR_SCHEDULED_JOB_NAME = "Data Model Mirror Nightly";
export const DATA_MODEL_MIRROR_PROMPT =
  "Reconcile the Prisma data model into the EA data-model view (data_object elements + relationships), " +
  "then run the data-architecture steward drift pass. Deterministic — runs without an LLM loop.";
