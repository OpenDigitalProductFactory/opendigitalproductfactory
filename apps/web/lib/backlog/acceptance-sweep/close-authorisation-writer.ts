import { err, ok, type ActionResult } from "@/lib/shared/action-result";

import {
  CLOSE_AUTHORISATION_CONFIG_KEY,
  grantCloseAuthorisationRecord,
  parseCloseAuthorisation,
  revokeCloseAuthorisationRecord,
  type CloseAuthorisationRecord,
} from "./close-authorisation";

// The governed writer for the acceptance sweep's close pre-authorisation
// (BI-45D3BBF4, AC-1). The capability checks live in the server action
// (lib/actions/acceptance-sweep-close-authorisation.ts); this core takes the
// already-authorised operator id so it is tested without a session.
//
// A grant replaces the record with fresh provenance. A revocation keeps the
// grant's provenance and adds its own, so the record always says who allowed
// the sweep to close and who stopped it. Nothing deletes the row.

const MIN_REASON_LENGTH = 12;

export type CloseAuthorisationWriterDb = {
  platformConfig: {
    findUnique(args: { where: { key: string }; select: { value: true } }): Promise<{ value: unknown } | null>;
    upsert(args: {
      where: { key: string };
      create: { key: string; value: CloseAuthorisationRecord };
      update: { value: CloseAuthorisationRecord };
    }): Promise<unknown>;
  };
};

export async function writeCloseAuthorisation(
  db: CloseAuthorisationWriterDb,
  input:
    | { action: "grant"; userId: string; reason: string; now: Date; maxClosuresPerRun?: number }
    | { action: "revoke"; userId: string; reason: string; now: Date },
): Promise<ActionResult<CloseAuthorisationRecord>> {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    return err(`Say why in at least ${MIN_REASON_LENGTH} characters; the reason is kept with the record.`);
  }
  let record: CloseAuthorisationRecord;
  if (input.action === "grant") {
    record = grantCloseAuthorisationRecord(input);
  } else {
    const current = parseCloseAuthorisation(
      (await db.platformConfig.findUnique({ where: { key: CLOSE_AUTHORISATION_CONFIG_KEY }, select: { value: true } }))?.value,
    );
    if (!current || !current.enabled) return err("There is no pre-authorisation in force to revoke.");
    record = revokeCloseAuthorisationRecord(current, input);
  }
  await db.platformConfig.upsert({
    where: { key: CLOSE_AUTHORISATION_CONFIG_KEY },
    create: { key: CLOSE_AUTHORISATION_CONFIG_KEY, value: record },
    update: { value: record },
  });
  return ok(record);
}
