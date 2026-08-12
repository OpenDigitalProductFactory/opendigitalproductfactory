// EP-MSP-FEDERATION · B1 — federation enroll wire contract. Shared by the route
// and any cross-runtime parity test so both validate the same shape.

import { z } from "zod";

export const FederationEnrollBody = z.object({
  /** Outbound-only base URL of the connecting peer's Authority Core. */
  peerAuthorityUrl: z.string().url(),
  /** The connecting peer's organization identifier (for the B5 crosswalk). */
  peerOrganizationRef: z.string().min(1).max(200).optional(),
  /** Our own organization id, recorded on the link for the crosswalk. */
  localOrganizationId: z.string().min(1).max(200).optional(),
  /** Operator-set display name for the peer (shown in the links admin). */
  displayName: z.string().min(1).max(200),
  /** The connecting peer's OWN inbound link token, so the inviter can call it
   *  back (approval relay + demand push). Optional for backward compatibility:
   *  an older connector omits it and the link stays one-directional. */
  callbackToken: z.string().min(1).max(400).optional(),
  peerDeviceId: z.string().regex(/^did_[a-f0-9]{64}$/).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type FederationEnrollBodyType = z.infer<typeof FederationEnrollBody>;
