// BI-7BCC87BB (plan B8, AC-OVERRIDE): read an on-behalf decision from an
// envelope decision request. The body says `{ onBehalf: true, reason }`; whether
// the caller may act on it is the capability the user-management surface
// checks (manage_users, lib/actions/users.ts), resolved from the session here
// and enforced in envelope-actions.ts. A request without the body is the
// delegate's own decision, unchanged.
import { can } from "@/lib/permissions";

import type { OnBehalfDecisionRequest } from "./envelope-actions";

type SessionUser = { platformRole?: string | null; isSuperuser?: boolean | null };

export async function readOnBehalfRequest(request: Request, user: SessionUser): Promise<OnBehalfDecisionRequest | undefined> {
  const body = await request.json().catch(() => null) as { onBehalf?: unknown; reason?: unknown } | null;
  if (!body || body.onBehalf !== true) return undefined;
  return {
    reason: typeof body.reason === "string" ? body.reason : "",
    callerIsAdmin: can({ platformRole: user.platformRole ?? null, isSuperuser: user.isSuperuser === true }, "manage_users"),
  };
}
