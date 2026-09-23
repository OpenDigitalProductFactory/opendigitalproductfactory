// The revision of this local-CI gate client, reported on every
// claim_nonprod_environment_lease call. The admission server refuses clients
// below its floor (apps/web/lib/nonprod/gate-client-revision.ts) with
// `gate_client_upgrade_required`, which is how a client-side defect fixed on
// main is retired from branches that have not rebased yet.
//
// Bump this in the same change as a client fix the server must be able to
// require, then add the matching floor on the server side.
//
// 1 - durable-wait resumer and its gate runs spawn with windowsHide
//     (BI-69178E02): older clients open a focus-stealing terminal window on
//     every re-claim on Windows.
export const GATE_CLIENT_REVISION = 1;
