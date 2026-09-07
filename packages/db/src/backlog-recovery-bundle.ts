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
  /** Absent when the source installation had not sized the item. */
  effortSize?: EffortSize;
  /** Absent when the source installation had not triaged the item. */
  triageOutcome?: TriageOutcome;
  scopeKind: ScopeKind;
  /** Absent when the source installation recorded no scope rationale. */
  scopeRationale?: string;
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
  /** Absent when the source installation recorded no scope rationale. */
  scopeRationale?: string;
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

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  path: string,
): T[number] | undefined {
  return value === undefined ? undefined : enumValue(value, values, path);
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
  };
  const epicScopeRationale = optionalString(input.scopeRationale, `${path}.scopeRationale`);
  if (epicScopeRationale !== undefined) epic.scopeRationale = epicScopeRationale;
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
    scopeKind: enumValue(input.scopeKind, SCOPE_KINDS, `${path}.scopeKind`),
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
  const effortSize = optionalEnum(input.effortSize, EFFORT_SIZES, `${path}.effortSize`);
  const triageOutcome = optionalEnum(input.triageOutcome, TRIAGE_OUTCOMES, `${path}.triageOutcome`);
  const itemScopeRationale = optionalString(input.scopeRationale, `${path}.scopeRationale`);
  if (effortSize !== undefined) item.effortSize = effortSize;
  if (triageOutcome !== undefined) item.triageOutcome = triageOutcome;
  if (itemScopeRationale !== undefined) item.scopeRationale = itemScopeRationale;
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

/** An item the capture could not represent, and why. Never silently dropped. */
export interface BacklogCaptureSkip {
  itemId: string;
  reason: "done-item-has-no-evidence-activity" | "item-has-no-epic" | "epic-not-representable";
  /** For `epic-not-representable`: the contract violation the bundle format raised. */
  detail?: string;
}

/**
 * The outcome of a capture: the reconcilable bundle plus everything it excluded.
 *
 * Callers must surface `skipped`. A capture that silently omitted work would read
 * as a complete backup and lose exactly the thing it promised to protect.
 */
export interface BacklogCaptureResult {
  /** `null` when no item in the epic could be represented — never an empty bundle. */
  bundle: BacklogRecoveryBundle | null;
  skipped: BacklogCaptureSkip[];
}

/** A backlog item as read from the database, before bundle shaping. */
export interface BacklogCaptureItemRow {
  itemId: string;
  epicId: string;
  title: string;
  body: string;
  status: ItemStatus;
  type: ItemType;
  workType: WorkType;
  source: Source;
  priority?: number | null;
  effortSize?: EffortSize | string | null;
  triageOutcome?: TriageOutcome | string | null;
  scopeKind?: ScopeKind | string | null;
  scopeRationale?: string | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
  resolution?: string | null;
  activities: Array<{
    id: string;
    kind: string;
    summary: string;
    recordedAt: Date | string;
    payload?: unknown;
  }>;
}

/** An epic as read from the database, before bundle shaping. */
export interface BacklogCaptureEpicRow {
  epicId: string;
  title: string;
  description: string;
  status: EpicStatus;
  priority?: number | null;
  scopeKind?: ScopeKind | string | null;
  scopeRationale?: string | null;
  createdAt?: Date | string | null;
  completedAt?: Date | string | null;
}

/**
 * Normalise a timestamp to the ISO 8601 UTC form the bundle contract requires.
 *
 * Prisma hands back `Date`, but rows read through a raw query arrive as driver
 * strings such as `2026-08-19 12:34:56.789+00`, which the validator rejects.
 * Normalising here keeps both paths capturable; an unparseable value is dropped
 * rather than passed through to fail validation later.
 */
function isoOrUndefined(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * Normalise an item/activity pair into the lowercase semantic recovery key the
 * bundle validator requires.
 *
 * The key is the reconciler's idempotency handle, so it is derived only from the
 * stable item and activity identifiers — never from an array position, which
 * would shift between captures and re-create activities on every recovery.
 */
function recoveryKeyFor(itemId: string, activitySuffix: string): string {
  const key = `${itemId}-${activitySuffix}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  // The validator demands at least three characters after the leading one.
  return key.length >= 3 ? key : `${key}-capture`.slice(0, 80);
}

/**
 * Recursively drop keys the bundle contract forbids.
 *
 * Activity payloads on a live installation routinely carry install-local
 * identifiers (`principalId`, `agentId`, …). Those are meaningless on the
 * installation that recovers the bundle, and the validator rejects them outright.
 * Stripping them keeps the surrounding work capturable instead of failing the
 * whole capture over a field recovery would discard anyway.
 */
/**
 * Coerce a recorded scope kind into the closed vocabulary.
 *
 * `unknown` is the format's own escape hatch, so an installation that never
 * classified an item is represented truthfully rather than guessed into a class.
 */
function scopeKindOrUnknown(value: string | null | undefined): ScopeKind {
  return value && (SCOPE_KINDS as readonly string[]).includes(value)
    ? (value as ScopeKind)
    : "unknown";
}

/** Keep a recorded value only when it is a usable non-empty string. */
function presentString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Keep a recorded value only when it is in the closed vocabulary. */
function presentEnum<const T extends readonly string[]>(
  value: string | null | undefined,
  values: T,
): T[number] | undefined {
  return typeof value === "string" && (values as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function stripSensitive(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(stripSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY.test(key))
        .map(([key, entry]) => [key, stripSensitive(entry)]),
    );
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  return null;
}

function safePayload(value: unknown): { [key: string]: JsonValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  try {
    const plain = JSON.parse(JSON.stringify(value)) as unknown;
    const stripped = stripSensitive(plain);
    if (typeof stripped !== "object" || stripped === null || Array.isArray(stripped)) return {};
    return stripped as { [key: string]: JsonValue };
  } catch {
    return {};
  }
}

/**
 * Build a reconcilable recovery bundle from live backlog rows.
 *
 * This is the capture half of the recovery contract: `reconcileBacklogRecoveryBundle`
 * could already restore a bundle, but nothing produced one, so work created on an
 * installation had no path off it. The result is round-tripped through
 * `parseBacklogRecoveryBundle`, so a bundle that builds is guaranteed to reconcile.
 *
 * A `done` item must carry a `status_change` activity recording its resolution. When
 * the stored activities do not include one, the item's own `resolution` column is
 * projected into that shape — the same fact the invariant asks for, read from the
 * column that holds it rather than invented.
 */
export function buildBacklogRecoveryBundle(input: {
  bundleId: string;
  description: string;
  capturedAt: string;
  repository: string;
  planPath: string;
  sourcePullRequest?: string;
  epic: BacklogCaptureEpicRow;
  items: BacklogCaptureItemRow[];
}): BacklogCaptureResult {
  const skipped: BacklogCaptureSkip[] = [];
  const capturable = input.items.filter((row) => {
    // A completed item must carry real evidence to be recoverable. Evidence is
    // never synthesised — an item that lacks it is reported, not invented.
    if (row.status !== "done") return true;
    if (row.activities.some((activity) => activity.kind === "evidence")) return true;
    skipped.push({
      itemId: row.itemId,
      reason: "done-item-has-no-evidence-activity",
    });
    return false;
  });

  const items: BacklogRecoveryItem[] = capturable.map((row) => {
    const activities: BacklogRecoveryActivity[] = row.activities.map((activity) => ({
      recoveryKey: recoveryKeyFor(row.itemId, activity.id),
      kind: activity.kind,
      summary: activity.summary,
      recordedAt: isoOrUndefined(activity.recordedAt) ?? input.capturedAt,
      payload: safePayload(activity.payload),
    }));

    const hasResolutionActivity = activities.some(
      (activity) =>
        activity.kind === "status_change" && typeof activity.payload.resolution === "string",
    );
    if (row.status === "done" && !hasResolutionActivity) {
      activities.push({
        recoveryKey: recoveryKeyFor(row.itemId, "resolution"),
        kind: "status_change",
        summary: "Captured resolution recorded on the item.",
        recordedAt: isoOrUndefined(row.completedAt) ?? input.capturedAt,
        payload: { resolution: row.resolution ?? "completed" },
      });
    }

    const item: BacklogRecoveryItem = {
      itemId: row.itemId,
      epicId: row.epicId,
      title: row.title,
      body: row.body,
      status: row.status,
      type: row.type,
      workType: row.workType,
      source: row.source,
      scopeKind: scopeKindOrUnknown(row.scopeKind),
      dependsOn: [],
      externalDependencies: [],
      activities,
    };
    const effortSize = presentEnum(row.effortSize, EFFORT_SIZES);
    const triageOutcome = presentEnum(row.triageOutcome, TRIAGE_OUTCOMES);
    const itemScopeRationale = presentString(row.scopeRationale);
    if (effortSize) item.effortSize = effortSize;
    if (triageOutcome) item.triageOutcome = triageOutcome;
    if (itemScopeRationale) item.scopeRationale = itemScopeRationale;
    if (typeof row.priority === "number") item.priority = row.priority;
    const createdAt = isoOrUndefined(row.createdAt);
    if (createdAt) item.createdAt = createdAt;
    if (row.status === "done") {
      const completedAt = isoOrUndefined(row.completedAt);
      if (completedAt) item.completedAt = completedAt;
      if (row.resolution) item.resolution = row.resolution;
    }
    return item;
  });

  const epic: BacklogRecoveryEpic = {
    epicId: input.epic.epicId,
    title: input.epic.title,
    description: input.epic.description,
    status: input.epic.status,
    scopeKind: scopeKindOrUnknown(input.epic.scopeKind),
  };
  const epicScopeRationale = presentString(input.epic.scopeRationale);
  if (epicScopeRationale) epic.scopeRationale = epicScopeRationale;
  if (typeof input.epic.priority === "number") epic.priority = input.epic.priority;
  const epicCreatedAt = isoOrUndefined(input.epic.createdAt);
  if (epicCreatedAt) epic.createdAt = epicCreatedAt;
  const epicCompletedAt = isoOrUndefined(input.epic.completedAt);
  if (epicCompletedAt) epic.completedAt = epicCompletedAt;

  const bundle = {
    schemaVersion: BACKLOG_RECOVERY_SCHEMA_VERSION,
    bundleId: input.bundleId,
    description: input.description,
    source: {
      capturedAt: input.capturedAt,
      repository: input.repository,
      planPath: input.planPath,
      ...(input.sourcePullRequest ? { sourcePullRequest: input.sourcePullRequest } : {}),
    },
    epic,
    items,
  };

  // An epic whose every item was skipped yields no bundle rather than an empty one.
  if (items.length === 0) return { bundle: null, skipped };

  // Round-trip so an unreconcilable bundle fails at capture, not at recovery.
  return { bundle: parseBacklogRecoveryBundle(bundle), skipped };
}

// ── Workroom capture ─────────────────────────────────────────────────────────
//
// A backlog bundle preserves WHAT was asked for. It says nothing about WHERE the
// work is: the Workroom rows that bind a backlog item to a branch, a worktree, a
// lease holder and the evidence recorded along the way live only in Postgres and
// die with it on reinstall (BI-F9939341). The teardown stance calls that work
// "irreplaceable" and asks for a bundle before teardown, so the bundle has to
// carry the Workrooms too. This record is a faithful, non-reconcilable capture:
// a later slice rebinds it to worktrees that still exist on disk.

export interface WorkroomCaptureActivityRow {
  id: string;
  kind: string;
  summary: string;
  payload: unknown;
  recordedAt: Date | string;
}

export interface WorkroomCaptureRow {
  capsuleId: string;
  title: string;
  objective: string;
  status: string;
  source: string;
  executorKind: string | null;
  executorRef: string | null;
  backlogItemId: string | null;
  epicId: string | null;
  repositoryFullName: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  headBranch: string | null;
  headSha: string | null;
  worktreePath: string | null;
  pullRequestUrl: string | null;
  pullRequestNumber: number | null;
  contributionMode: string | null;
  branchTaxonomy: string | null;
  idempotencyKey: string | null;
  scopeClaims: unknown;
  workspaceState: unknown;
  verificationState: unknown;
  leaseHolderPrincipalId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  lastSyncedAt: Date | string | null;
  archivedAt: Date | string | null;
  activities: WorkroomCaptureActivityRow[];
}

export interface WorkroomCaptureRecord {
  schemaVersion: 1;
  capturedAt: string;
  /** Every Workroom in the record. */
  workroomCount: number;
  /** Workrooms that name a branch — the ones a reinstall would otherwise orphan on disk. */
  boundBranchCount: number;
  /** Workrooms in a non-terminal status: the work someone would still expect to find. */
  openCount: number;
  workrooms: Array<
    Omit<WorkroomCaptureRow, "createdAt" | "updatedAt" | "lastSyncedAt" | "archivedAt" | "activities"> & {
      createdAt: string;
      updatedAt: string;
      lastSyncedAt: string | null;
      archivedAt: string | null;
      activities: Array<Omit<WorkroomCaptureActivityRow, "recordedAt"> & { recordedAt: string }>;
    }
  >;
}

const TERMINAL_WORKROOM_STATUSES = new Set(["complete", "abandoned", "archived"]);

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Serialize Workroom rows into the bundle's `workrooms.json` record. Pure and
 * deterministic: rows sort by `capsuleId`, activities by `recordedAt` then id,
 * every date is ISO, and nothing is dropped — a Workroom with no branch is still
 * a Workroom someone opened.
 */
export function buildWorkroomCaptureRecord(
  rows: readonly WorkroomCaptureRow[],
  capturedAt: string,
): WorkroomCaptureRecord {
  const workrooms = [...rows]
    .sort((a, b) => a.capsuleId.localeCompare(b.capsuleId))
    .map((row) => ({
      ...row,
      createdAt: isoOrNull(row.createdAt) as string,
      updatedAt: isoOrNull(row.updatedAt) as string,
      lastSyncedAt: isoOrNull(row.lastSyncedAt),
      archivedAt: isoOrNull(row.archivedAt),
      activities: [...row.activities]
        .map((activity) => ({ ...activity, recordedAt: isoOrNull(activity.recordedAt) as string }))
        .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id)),
    }));
  return {
    schemaVersion: 1,
    capturedAt,
    workroomCount: workrooms.length,
    boundBranchCount: workrooms.filter((room) => room.headBranch !== null && room.headBranch !== "").length,
    openCount: workrooms.filter((room) => !TERMINAL_WORKROOM_STATUSES.has(room.status)).length,
    workrooms,
  };
}
