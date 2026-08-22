export const BACKLOG_RECOVERY_SCHEMA_VERSION = 1 as const;

const ITEM_STATUSES = ["triaging", "open", "in-progress", "done", "deferred", "retired"] as const;
const ITEM_TYPES = ["portfolio", "product"] as const;
const WORK_TYPES = ["bug", "feature", "chore", "doc", "tool", "skill", "refactor"] as const;
const SOURCES = ["user-request", "automated-detection"] as const;
const EFFORT_SIZES = ["small", "medium", "large", "xlarge"] as const;
const TRIAGE_OUTCOMES = ["build", "runbook", "coworker-task", "defer", "duplicate", "discard"] as const;
const EPIC_STATUSES = ["open", "in-progress", "done"] as const;
const SCOPE_KINDS = ["platform", "common", "archetype-category", "archetype-leaf", "multi-archetype", "unknown"] as const;

type ItemStatus = (typeof ITEM_STATUSES)[number];
type ItemType = (typeof ITEM_TYPES)[number];
type WorkType = (typeof WORK_TYPES)[number];
type Source = (typeof SOURCES)[number];
type EffortSize = (typeof EFFORT_SIZES)[number];
type TriageOutcome = (typeof TRIAGE_OUTCOMES)[number];
type EpicStatus = (typeof EPIC_STATUSES)[number];
type ScopeKind = (typeof SCOPE_KINDS)[number];
type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface BacklogRecoveryActivity {
  recoveryKey: string;
  kind: string;
  summary: string;
  recordedAt: string;
  payload: { [key: string]: JsonValue };
}

export interface BacklogRecoveryItem {
  itemId: string;
  epicId: string;
  title: string;
  body: string;
  status: ItemStatus;
  type: ItemType;
  workType: WorkType;
  source: Source;
  priority?: number;
  effortSize: EffortSize;
  triageOutcome: TriageOutcome;
  scopeKind: ScopeKind;
  scopeRationale: string;
  dependsOn: string[];
  externalDependencies: string[];
  createdAt?: string;
  completedAt?: string;
  resolution?: string;
  activities: BacklogRecoveryActivity[];
}

export interface BacklogRecoveryEpic {
  epicId: string;
  title: string;
  description: string;
  status: EpicStatus;
  priority?: number;
  scopeKind: ScopeKind;
  scopeRationale: string;
  createdAt?: string;
  completedAt?: string;
}

export interface BacklogRecoveryBundle {
  schemaVersion: typeof BACKLOG_RECOVERY_SCHEMA_VERSION;
  bundleId: string;
  description: string;
  source: {
    capturedAt: string;
    repository: string;
    planPath: string;
    sourcePullRequest?: string;
  };
  epic: BacklogRecoveryEpic;
  items: BacklogRecoveryItem[];
}

export interface BacklogRecoveryTransaction {
  findEpic(epicId: string): Promise<{ internalId: string } | null>;
  findItem(itemId: string): Promise<{ internalId: string } | null>;
  createEpic(epic: BacklogRecoveryEpic): Promise<{ internalId: string }>;
  createItem(item: BacklogRecoveryItem, epicInternalId: string): Promise<{ internalId: string }>;
  createActivity(
    activity: BacklogRecoveryActivity,
    itemInternalId: string,
    context: { bundleId: string },
  ): Promise<void>;
}

export interface BacklogRecoveryStore {
  transaction<T>(work: (tx: BacklogRecoveryTransaction) => Promise<T>): Promise<T>;
}

export interface BacklogRecoverySummary {
  bundleId: string;
  mode: "dry-run" | "apply";
  epic: { create: string[]; skip: string[] };
  items: { create: string[]; skip: string[] };
  activities: { create: string[]; skip: string[] };
}

type AnyRecord = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new Error(`Invalid backlog recovery bundle at ${path}: ${message}`);
}

function record(value: unknown, path: string): AnyRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
  return value as AnyRecord;
}

function exactKeys(value: AnyRecord, allowed: readonly string[], path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) fail(`${path}.${unknown}`, "unknown key");
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "expected a non-empty string");
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringValue(value, path);
}

function integerValue(value: unknown, path: string): number {
  if (!Number.isInteger(value)) fail(path, "expected an integer");
  return value as number;
}

function optionalInteger(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : integerValue(value, path);
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T, path: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    fail(path, `expected one of: ${values.join(", ")}`);
  }
  return value as T[number];
}

function dateValue(value: unknown, path: string): string {
  const text = stringValue(value, path);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) ||
    !Number.isFinite(Date.parse(text))
  ) {
    fail(path, "expected an ISO 8601 UTC date-time");
  }
  return text;
}

function optionalDate(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : dateValue(value, path);
}

function semanticId(value: unknown, prefix: "BI" | "EP", path: string): string {
  const id = stringValue(value, path);
  if (!new RegExp(`^${prefix}-[A-Z0-9](?:[A-Z0-9-]{1,62}[A-Z0-9])?$`).test(id)) {
    fail(path, `expected a stable ${prefix}-* id`);
  }
  return id;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value.map((entry, index) => stringValue(entry, `${path}[${index}]`));
}

const SENSITIVE_KEY = /(password|secret|token|credential|api[-_]?key|principal[-_]?id|agent[-_]?id|user[-_]?id|internal[-_]?id)/i;

function jsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${path}[${index}]`));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as AnyRecord).map(([key, entry]) => {
        if (SENSITIVE_KEY.test(key)) fail(`${path}.${key}`, "sensitive or install-local keys are not allowed");
        return [key, jsonValue(entry, `${path}.${key}`)];
      }),
    );
  }
  fail(path, "expected JSON-safe data");
}

function parseActivity(value: unknown, path: string): BacklogRecoveryActivity {
  const input = record(value, path);
  exactKeys(input, ["recoveryKey", "kind", "summary", "recordedAt", "payload"], path);
  const recoveryKey = stringValue(input.recoveryKey, `${path}.recoveryKey`);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(recoveryKey)) {
    fail(`${path}.recoveryKey`, "expected a lowercase semantic key");
  }
  const payload = jsonValue(record(input.payload, `${path}.payload`), `${path}.payload`);
  return {
    recoveryKey,
    kind: stringValue(input.kind, `${path}.kind`),
    summary: stringValue(input.summary, `${path}.summary`),
    recordedAt: dateValue(input.recordedAt, `${path}.recordedAt`),
    payload: payload as { [key: string]: JsonValue },
  };
}

function parseEpic(value: unknown): BacklogRecoveryEpic {
  const path = "$.epic";
  const input = record(value, path);
  exactKeys(
    input,
    ["epicId", "title", "description", "status", "priority", "scopeKind", "scopeRationale", "createdAt", "completedAt"],
    path,
  );
  const epic: BacklogRecoveryEpic = {
    epicId: semanticId(input.epicId, "EP", `${path}.epicId`),
    title: stringValue(input.title, `${path}.title`),
    description: stringValue(input.description, `${path}.description`),
    status: enumValue(input.status, EPIC_STATUSES, `${path}.status`),
    scopeKind: enumValue(input.scopeKind, SCOPE_KINDS, `${path}.scopeKind`),
    scopeRationale: stringValue(input.scopeRationale, `${path}.scopeRationale`),
  };
  const priority = optionalInteger(input.priority, `${path}.priority`);
  const createdAt = optionalDate(input.createdAt, `${path}.createdAt`);
  const completedAt = optionalDate(input.completedAt, `${path}.completedAt`);
  if (priority !== undefined) epic.priority = priority;
  if (createdAt !== undefined) epic.createdAt = createdAt;
  if (completedAt !== undefined) epic.completedAt = completedAt;
  if (epic.status === "done" && !epic.completedAt) fail(`${path}.completedAt`, "is required when status is done");
  return epic;
}

function parseItem(value: unknown, index: number): BacklogRecoveryItem {
  const path = `$.items[${index}]`;
  const input = record(value, path);
  exactKeys(
    input,
    [
      "itemId", "epicId", "title", "body", "status", "type", "workType", "source", "priority",
      "effortSize", "triageOutcome", "scopeKind", "scopeRationale", "dependsOn", "externalDependencies", "createdAt", "completedAt", "resolution", "activities",
    ],
    path,
  );
  if (!Array.isArray(input.activities)) fail(`${path}.activities`, "expected an array");
  const item: BacklogRecoveryItem = {
    itemId: semanticId(input.itemId, "BI", `${path}.itemId`),
    epicId: semanticId(input.epicId, "EP", `${path}.epicId`),
    title: stringValue(input.title, `${path}.title`),
    body: stringValue(input.body, `${path}.body`),
    status: enumValue(input.status, ITEM_STATUSES, `${path}.status`),
    type: enumValue(input.type, ITEM_TYPES, `${path}.type`),
    workType: enumValue(input.workType, WORK_TYPES, `${path}.workType`),
    source: enumValue(input.source, SOURCES, `${path}.source`),
    effortSize: enumValue(input.effortSize, EFFORT_SIZES, `${path}.effortSize`),
    triageOutcome: enumValue(input.triageOutcome, TRIAGE_OUTCOMES, `${path}.triageOutcome`),
    scopeKind: enumValue(input.scopeKind, SCOPE_KINDS, `${path}.scopeKind`),
    scopeRationale: stringValue(input.scopeRationale, `${path}.scopeRationale`),
    dependsOn: stringArray(input.dependsOn, `${path}.dependsOn`).map((id, dependencyIndex) =>
      semanticId(id, "BI", `${path}.dependsOn[${dependencyIndex}]`),
    ),
    externalDependencies: stringArray(input.externalDependencies, `${path}.externalDependencies`).map(
      (id, dependencyIndex) => semanticId(id, "BI", `${path}.externalDependencies[${dependencyIndex}]`),
    ),
    activities: input.activities.map((activity, activityIndex) =>
      parseActivity(activity, `${path}.activities[${activityIndex}]`),
    ),
  };
  const priority = optionalInteger(input.priority, `${path}.priority`);
  const createdAt = optionalDate(input.createdAt, `${path}.createdAt`);
  const completedAt = optionalDate(input.completedAt, `${path}.completedAt`);
  const resolution = optionalString(input.resolution, `${path}.resolution`);
  if (priority !== undefined) item.priority = priority;
  if (createdAt !== undefined) item.createdAt = createdAt;
  if (completedAt !== undefined) item.completedAt = completedAt;
  if (resolution !== undefined) item.resolution = resolution;
  if (item.status === "done" && !item.completedAt) fail(`${path}.completedAt`, "is required when status is done");
  if (item.status === "done" && !item.resolution) fail(`${path}.resolution`, "is required when status is done");
  if (item.status === "done" && !item.activities.some((activity) => activity.kind === "evidence")) {
    fail(`${path}.activities`, "a done item requires at least one evidence activity");
  }
  if (
    item.status === "done" &&
    !item.activities.some(
      (activity) => activity.kind === "status_change" && typeof activity.payload.resolution === "string",
    )
  ) {
    fail(`${path}.activities`, "a done item requires a status_change activity with resolution");
  }
  if (item.status !== "done" && item.completedAt) fail(`${path}.completedAt`, "is only allowed when status is done");
  if (item.status !== "done" && item.resolution) fail(`${path}.resolution`, "is only allowed when status is done");
  return item;
}

export function parseBacklogRecoveryBundle(value: unknown): BacklogRecoveryBundle {
  const input = record(value, "$");
  exactKeys(input, ["schemaVersion", "bundleId", "description", "source", "epic", "items"], "$");
  if (input.schemaVersion !== BACKLOG_RECOVERY_SCHEMA_VERSION) {
    fail("$.schemaVersion", `expected ${BACKLOG_RECOVERY_SCHEMA_VERSION}`);
  }
  const sourceInput = record(input.source, "$.source");
  exactKeys(sourceInput, ["capturedAt", "repository", "planPath", "sourcePullRequest"], "$.source");
  if (!Array.isArray(input.items) || input.items.length === 0) fail("$.items", "expected a non-empty array");

  const epic = parseEpic(input.epic);
  const items = input.items.map(parseItem);
  const itemIds = new Set<string>();
  const activityKeys = new Set<string>();
  for (const [index, item] of items.entries()) {
    if (item.epicId !== epic.epicId) fail(`$.items[${index}].epicId`, `must equal ${epic.epicId}`);
    if (itemIds.has(item.itemId)) fail(`$.items[${index}].itemId`, "must be unique");
    itemIds.add(item.itemId);
    for (const activity of item.activities) {
      if (activityKeys.has(activity.recoveryKey)) fail(`$.items[${index}].activities`, `duplicate recoveryKey ${activity.recoveryKey}`);
      activityKeys.add(activity.recoveryKey);
    }
  }
  for (const [index, item] of items.entries()) {
    for (const dependency of item.dependsOn) {
      if (!itemIds.has(dependency)) fail(`$.items[${index}].dependsOn`, `${dependency} is not in this bundle`);
      if (dependency === item.itemId) fail(`$.items[${index}].dependsOn`, "an item cannot depend on itself");
    }
    for (const dependency of item.externalDependencies) {
      if (itemIds.has(dependency)) {
        fail(`$.items[${index}].externalDependencies`, `${dependency} is bundled and must be listed in dependsOn`);
      }
    }
  }

  const source: BacklogRecoveryBundle["source"] = {
    capturedAt: dateValue(sourceInput.capturedAt, "$.source.capturedAt"),
    repository: stringValue(sourceInput.repository, "$.source.repository"),
    planPath: stringValue(sourceInput.planPath, "$.source.planPath"),
  };
  const sourcePullRequest = optionalString(sourceInput.sourcePullRequest, "$.source.sourcePullRequest");
  if (sourcePullRequest !== undefined) source.sourcePullRequest = sourcePullRequest;
  return {
    schemaVersion: BACKLOG_RECOVERY_SCHEMA_VERSION,
    bundleId: stringValue(input.bundleId, "$.bundleId"),
    description: stringValue(input.description, "$.description"),
    source,
    epic,
    items,
  };
}

export async function reconcileBacklogRecoveryBundle(
  store: BacklogRecoveryStore,
  bundle: BacklogRecoveryBundle,
  options: { apply: boolean },
): Promise<BacklogRecoverySummary> {
  return store.transaction(async (tx) => {
    const summary: BacklogRecoverySummary = {
      bundleId: bundle.bundleId,
      mode: options.apply ? "apply" : "dry-run",
      epic: { create: [], skip: [] },
      items: { create: [], skip: [] },
      activities: { create: [], skip: [] },
    };
    const existingEpic = await tx.findEpic(bundle.epic.epicId);
    const epicInternalId = existingEpic?.internalId ?? null;
    (existingEpic ? summary.epic.skip : summary.epic.create).push(bundle.epic.epicId);

    const existingItems = new Map<string, { internalId: string } | null>();
    for (const item of bundle.items) {
      const existing = await tx.findItem(item.itemId);
      existingItems.set(item.itemId, existing);
      (existing ? summary.items.skip : summary.items.create).push(item.itemId);
      for (const activity of item.activities) {
        (existing ? summary.activities.skip : summary.activities.create).push(activity.recoveryKey);
      }
    }
    if (!options.apply) return summary;

    const resolvedEpicId = epicInternalId ?? (await tx.createEpic(bundle.epic)).internalId;
    for (const item of bundle.items) {
      if (existingItems.get(item.itemId)) continue;
      const created = await tx.createItem(item, resolvedEpicId);
      for (const activity of item.activities) {
        await tx.createActivity(activity, created.internalId, { bundleId: bundle.bundleId });
      }
    }
    return summary;
  });
}
