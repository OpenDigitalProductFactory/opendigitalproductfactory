import { createHmac, timingSafeEqual } from "node:crypto";

import { canonicalJson } from "@/lib/shared/canonical-json";
import {
  projectDeliveryTaskHubRow,
  type DeliveryTaskAsyncOperation,
  type DeliveryTaskHubRow,
  type DeliveryTaskHubSource,
} from "./delivery-task-hub";
import type { DeliveryTaskAsyncTarget } from "./delivery-task-hub-async";

export const DELIVERY_TASK_PAGE_SIZE = 40;
export const DELIVERY_TASK_WINDOW_DAYS = 30;
const DELIVERY_TASK_CURSOR_MAX_AGE_DAYS = DELIVERY_TASK_WINDOW_DAYS + 1;
const ASYNC_PROJECTION_CONCURRENCY = 8;

type DeliveryTaskCursor = { id: string; updatedAt: string; windowStart: string };
type DeliveryTaskDb = {
  workroom: {
    findMany(args: unknown): Promise<unknown[]>;
    findUnique(args: unknown): Promise<unknown | null>;
  };
};

export type DeliveryTaskHubPage = {
  rows: DeliveryTaskHubRow[];
  nextCursor: string | null;
  observedAt: string;
};

export type DeliveryTaskAsyncProjectionLoader = (
  target: DeliveryTaskAsyncTarget,
) => Promise<DeliveryTaskAsyncOperation>;

const HUB_SELECT = {
  id: true,
  capsuleId: true,
  title: true,
  objective: true,
  status: true,
  source: true,
  executorKind: true,
  executorRef: true,
  backlogItemId: true,
  repositoryFullName: true,
  headBranch: true,
  pullRequestUrl: true,
  leaseExpiresAt: true,
  updatedAt: true,
  lastSyncedAt: true,
  archivedAt: true,
  taskRun: {
    select: {
      taskRunId: true,
      title: true,
      status: true,
      routeContext: true,
      progressPayload: true,
      startedAt: true,
      completedAt: true,
      updatedAt: true,
      actionEnvelopes: {
        where: { status: { in: ["proposed", "approved"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 2,
        select: { id: true, status: true, createdAt: true, expiresAt: true },
      },
    },
  },
  activities: {
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    take: 5,
    select: { id: true, kind: true, summary: true, recordedAt: true },
  },
  runtimeVerifications: {
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { verificationId: true, kind: true, status: true, result: true, completedAt: true, updatedAt: true },
  },
} as const;

function iso(value: unknown, field: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw new Error(`Invalid delivery task cursor ${field}`);
  return new Date(value).toISOString();
}

function cursorSecret(override?: string): string {
  const secret = override ?? process.env.DPF_DELIVERY_TASK_CURSOR_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret?.trim()) throw new Error("Delivery task cursors require a signing secret");
  return secret;
}

function signCursor(encoded: string, secret: string): string {
  return createHmac("sha256", secret).update(encoded, "utf8").digest("base64url");
}

function equalSignature(expected: string, actual: string): boolean {
  const left = Buffer.from(expected, "utf8");
  const right = Buffer.from(actual, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encodeDeliveryTaskCursor(cursor: DeliveryTaskCursor, options: { secret?: string } = {}): string {
  const encoded = Buffer.from(canonicalJson(cursor), "utf8").toString("base64url");
  return `${encoded}.${signCursor(encoded, cursorSecret(options.secret))}`;
}

export function decodeDeliveryTaskCursor(value: string, options: { secret?: string } = {}): DeliveryTaskCursor {
  try {
    const separator = value.lastIndexOf(".");
    if (separator <= 0 || separator === value.length - 1) throw new Error("shape");
    const encoded = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    if (!equalSignature(signCursor(encoded, cursorSecret(options.secret)), signature)) throw new Error("signature");
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    if (Buffer.from(decoded, "utf8").toString("base64url") !== encoded) throw new Error("encoding");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (typeof parsed.id !== "string" || !parsed.id || Object.keys(parsed).sort().join(",") !== "id,updatedAt,windowStart") {
      throw new Error("shape");
    }
    return { id: parsed.id, updatedAt: iso(parsed.updatedAt, "updatedAt"), windowStart: iso(parsed.windowStart, "windowStart") };
  } catch {
    throw new Error("Invalid delivery task cursor");
  }
}

function asSource(value: unknown): DeliveryTaskHubSource {
  return value as DeliveryTaskHubSource;
}

function asyncTarget(source: DeliveryTaskHubSource): DeliveryTaskAsyncTarget {
  return {
    capsuleId: source.capsuleId,
    taskRunId: source.taskRun?.taskRunId ?? null,
  };
}

async function projectRows(
  sources: DeliveryTaskHubSource[],
  now: Date,
  loadAsyncOperation?: DeliveryTaskAsyncProjectionLoader,
): Promise<DeliveryTaskHubRow[]> {
  const rows = sources.map((source) => projectDeliveryTaskHubRow(source, now));
  if (!loadAsyncOperation || sources.length === 0) return rows;
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(ASYNC_PROJECTION_CONCURRENCY, sources.length) },
    async () => {
      while (nextIndex < sources.length) {
        const index = nextIndex;
        nextIndex += 1;
        const source = sources[index];
        if (!source) continue;
        try {
          const asyncOperation = await loadAsyncOperation(asyncTarget(source));
          const asyncObservedAt = asyncOperation.coreHandleAvailable
            ? Date.parse(asyncOperation.observedAt)
            : Number.NaN;
          const rowObservedAt = Date.parse(rows[index]!.observedAt);
          rows[index] = {
            ...rows[index]!,
            observedAt: Number.isFinite(asyncObservedAt) && asyncObservedAt > rowObservedAt
              ? new Date(asyncObservedAt).toISOString()
              : rows[index]!.observedAt,
            asyncOperation,
          };
        } catch {
          rows[index] = { ...rows[index]!, asyncOperation: { coreHandleAvailable: false } };
        }
      }
    },
  );
  await Promise.all(workers);
  return rows;
}

export async function loadDeliveryTaskHubPage(
  db: DeliveryTaskDb,
  options: {
    now?: Date;
    cursor?: string | null;
    cursorSecret?: string;
    loadAsyncOperation?: DeliveryTaskAsyncProjectionLoader;
  } = {},
): Promise<DeliveryTaskHubPage> {
  const now = options.now ?? new Date();
  const decoded = options.cursor ? decodeDeliveryTaskCursor(options.cursor, { secret: options.cursorSecret }) : null;
  if (decoded) {
    const cursorWindowStart = new Date(decoded.windowStart);
    const earliestAllowed = new Date(now.getTime() - DELIVERY_TASK_CURSOR_MAX_AGE_DAYS * 24 * 60 * 60 * 1_000);
    if (cursorWindowStart < earliestAllowed || cursorWindowStart > now) {
      throw new Error("Invalid delivery task cursor");
    }
  }
  const windowStart = decoded
    ? new Date(decoded.windowStart)
    : new Date(now.getTime() - DELIVERY_TASK_WINDOW_DAYS * 24 * 60 * 60 * 1_000);
  const cursorFilter = decoded ? [{ OR: [
    { updatedAt: { lt: new Date(decoded.updatedAt) } },
    { updatedAt: new Date(decoded.updatedAt), id: { lt: decoded.id } },
  ] }] : undefined;
  const found = await db.workroom.findMany({
    where: {
      archivedAt: null,
      updatedAt: { gte: windowStart },
      ...(cursorFilter ? { AND: cursorFilter } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: DELIVERY_TASK_PAGE_SIZE + 1,
    select: HUB_SELECT,
  });
  const page = found.slice(0, DELIVERY_TASK_PAGE_SIZE).map(asSource);
  const last = page.at(-1);
  return {
    rows: await projectRows(page, now, options.loadAsyncOperation),
    nextCursor: found.length > DELIVERY_TASK_PAGE_SIZE && last
      ? encodeDeliveryTaskCursor({ id: last.id, updatedAt: last.updatedAt.toISOString(), windowStart: windowStart.toISOString() }, { secret: options.cursorSecret })
      : null,
    observedAt: now.toISOString(),
  };
}

export async function loadDeliveryTaskHubRow(
  db: DeliveryTaskDb,
  workroomId: string,
  options: { now?: Date; loadAsyncOperation?: DeliveryTaskAsyncProjectionLoader } = {},
): Promise<{ capsuleId: string; row: DeliveryTaskHubRow | null } | null> {
  const now = options.now ?? new Date();
  const value = await db.workroom.findUnique({ where: { id: workroomId }, select: HUB_SELECT });
  if (!value) return null;
  const source = asSource(value);
  if ((value as { archivedAt?: Date | null }).archivedAt) return { capsuleId: source.capsuleId, row: null };
  const windowStart = new Date(now.getTime() - DELIVERY_TASK_WINDOW_DAYS * 24 * 60 * 60 * 1_000);
  if (source.updatedAt < windowStart) return { capsuleId: source.capsuleId, row: null };
  const [row] = await projectRows([source], now, options.loadAsyncOperation);
  return { capsuleId: source.capsuleId, row: row ?? null };
}
