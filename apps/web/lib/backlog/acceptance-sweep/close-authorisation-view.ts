import { isRecord } from "@/lib/shared/coerce";

import {
  CLOSE_AUTHORISATION_CONFIG_KEY,
  CLOSE_AUTHORISATION_SCOPE,
  DEFAULT_CLOSE_LIMIT,
  MAX_CLOSE_LIMIT,
  parseCloseAuthorisation,
} from "./close-authorisation";
import { MIN_REASON_LENGTH } from "./close-authorisation-writer";

// The read model behind the admin card that grants and revokes the acceptance
// sweep's close pre-authorisation (BI-C2467A2E, AC-1). It reads the recorded
// authorisation (BI-45D3BBF4) and the closing section of the last sweep run's
// summary activity in the standing Acceptance room. It writes nothing; the card
// changes the record only through the existing server actions.

// Duplicated as literals (not imported from acceptance-sweep-task.ts) so this
// read model stays off the scheduler's import graph. A test pins them equal.
export const ACCEPTANCE_ROOM_IDEMPOTENCY_KEY = "acceptance-standing-room";
export const ACCEPTANCE_SWEEP_ACTIVITY_KIND = "acceptance-sweep";

export type LastSweepClosing = {
  ranAt: string;
  closingWasOn: boolean;
  closed: number;
  refused: number;
  deferredByLimit: number;
  /** The sweep's disabledReason code when closing was off for that run; the card words it from the catalog. */
  offReason: string | null;
};

export type CloseAuthorisationView = {
  state: "on" | "off";
  grant: { by: string; at: string; reason: string } | null;
  revocation: { by: string; at: string; reason: string | null } | null;
  /** Set when a record exists but cannot be acted on. */
  recordProblem: "malformed" | "out-of-scope" | null;
  limit: number;
  maxLimit: number;
  minReasonLength: number;
  lastRun: LastSweepClosing | null;
};

export type CloseAuthorisationViewDb = {
  platformConfig: {
    findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; email: true } }): Promise<Array<{ id: string; email: string }>>;
  };
  workroom: {
    findUnique(args: { where: { idempotencyKey: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  workroomActivity: {
    findFirst(args: {
      where: { workCapsuleId: string; kind: string };
      orderBy: Array<{ recordedAt: "desc" } | { id: "desc" }>;
      select: { payload: true };
    }): Promise<{ payload: unknown } | null>;
  };
};

function count(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/** The closing outcome of one sweep summary, or null when the run predates closing. */
export function parseLastSweepClosing(payload: unknown): LastSweepClosing | null {
  if (!isRecord(payload) || !isRecord(payload.closing) || typeof payload.ranAt !== "string") return null;
  const closing = payload.closing;
  return {
    ranAt: payload.ranAt,
    closingWasOn: closing.enabled === true,
    closed: count(closing.closed),
    refused: count(closing.refused),
    deferredByLimit: count(closing.deferredByLimit),
    offReason: typeof closing.disabledReason === "string" ? closing.disabledReason : null,
  };
}

export async function loadCloseAuthorisationView(db: CloseAuthorisationViewDb): Promise<CloseAuthorisationView> {
  const raw = (await db.platformConfig.findUnique({ where: { key: CLOSE_AUTHORISATION_CONFIG_KEY }, select: { value: true } }))?.value;
  const record = raw === null || raw === undefined ? null : parseCloseAuthorisation(raw);
  const recordProblem = raw === null || raw === undefined
    ? null
    : !record ? "malformed" : record.scope !== CLOSE_AUTHORISATION_SCOPE ? "out-of-scope" : null;

  const ids = [record?.setByUserId, record?.revokedByUserId].filter((id): id is string => Boolean(id));
  const users = ids.length > 0
    ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
    : [];
  const who = (id: string) => users.find((user) => user.id === id)?.email ?? id;

  const room = await db.workroom.findUnique({ where: { idempotencyKey: ACCEPTANCE_ROOM_IDEMPOTENCY_KEY }, select: { id: true } });
  const last = room
    ? await db.workroomActivity.findFirst({
        where: { workCapsuleId: room.id, kind: ACCEPTANCE_SWEEP_ACTIVITY_KIND },
        orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
        select: { payload: true },
      })
    : null;

  const usable = record && !recordProblem ? record : null;
  return {
    state: usable?.enabled ? "on" : "off",
    grant: usable ? { by: who(usable.setByUserId), at: usable.setAt, reason: usable.reason } : null,
    revocation: usable && !usable.enabled && usable.revokedByUserId && usable.revokedAt
      ? { by: who(usable.revokedByUserId), at: usable.revokedAt, reason: usable.revokeReason ?? null }
      : null,
    recordProblem,
    limit: usable?.maxClosuresPerRun ?? DEFAULT_CLOSE_LIMIT,
    maxLimit: MAX_CLOSE_LIMIT,
    minReasonLength: MIN_REASON_LENGTH,
    lastRun: parseLastSweepClosing(last?.payload),
  };
}
