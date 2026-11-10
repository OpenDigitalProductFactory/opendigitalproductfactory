// BI-E5631708: read the owner's "don't ask again" choice from an envelope
// approval request. Reads a clone, so the on-behalf reader can still consume
// the body. The choice is only a request: envelope-actions.ts decides whether
// the approval may become standing (owner only, non-damaging, unsteered).
export async function readMakeStandingRequest(request: Request): Promise<boolean> {
  const body = await request.clone().json().catch(() => null) as { makeStanding?: unknown } | null;
  return body?.makeStanding === true;
}
