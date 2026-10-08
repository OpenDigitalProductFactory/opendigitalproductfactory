import { can, type UserContext } from "@/lib/permissions";

import {
  AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY,
  AUTHOR_STAGE_PREAUTHORISATION_SCOPE,
  MIN_PREAUTHORISATION_REASON_LENGTH,
  parseAuthorStagePreauthorisation,
} from "./author-stage-preauthorisation";

// The read model behind the admin card that grants and revokes the drive's
// author-stage pre-authorisation (BI-8A32EBFF). Reads the record; writes nothing.

/** Who may see and change it: an operator setting, and the drive re-checks manage_platform every run. */
export function mayManageAuthorStagePreauthorisation(user: UserContext): boolean {
  return can(user, "manage_platform");
}

export type AuthorStagePreauthorisationView = {
  state: "on" | "off";
  grant: { by: string; at: string; reason: string } | null;
  revocation: { by: string; at: string; reason: string | null } | null;
  /** A record exists but cannot be acted on. */
  recordProblem: boolean;
  minReasonLength: number;
};

export type AuthorStagePreauthorisationViewDb = {
  platformConfig: {
    findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null>;
  };
  user: {
    findMany(args: { where: { id: { in: string[] } }; select: { id: true; email: true } }): Promise<Array<{ id: string; email: string }>>;
  };
};

export async function loadAuthorStagePreauthorisationView(db: AuthorStagePreauthorisationViewDb): Promise<AuthorStagePreauthorisationView> {
  const raw = (await db.platformConfig.findUnique({ where: { key: AUTHOR_STAGE_PREAUTHORISATION_CONFIG_KEY }, select: { value: true } }))?.value;
  const parsed = raw === null || raw === undefined ? null : parseAuthorStagePreauthorisation(raw);
  const record = parsed && parsed.scope === AUTHOR_STAGE_PREAUTHORISATION_SCOPE ? parsed : null;
  const ids = [record?.setByUserId, record?.revokedByUserId].filter((id): id is string => Boolean(id));
  const users = ids.length > 0 ? await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }) : [];
  const who = (id: string) => users.find((user) => user.id === id)?.email ?? id;
  return {
    state: record?.enabled ? "on" : "off",
    grant: record ? { by: who(record.setByUserId), at: record.setAt, reason: record.reason } : null,
    revocation: record && !record.enabled && record.revokedByUserId && record.revokedAt
      ? { by: who(record.revokedByUserId), at: record.revokedAt, reason: record.revokeReason ?? null }
      : null,
    recordProblem: raw !== null && raw !== undefined && !record,
    minReasonLength: MIN_PREAUTHORISATION_REASON_LENGTH,
  };
}
