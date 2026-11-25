# S5 synthetic rehearsal admission read

The read is for the governed Contributor preview only. It is not a launch,
approval, provider egress, or operation gate. It does not change the [v1 wire](workroom-bound-launch-contract-v1.md).

## Target

Use the governed Contributor preview on port 3001, with its live
`local-integration-ci` lease bound to the reviewed source SHA and the
isolated `dev-postgres:5432/dpf` database. The exact admission binds the
lease and source SHA, with the database reference `preview-db:<lease-id>`.
The URL allowlist binds the expected preview resource. It does not prove a
loopback network connection. The Control signature, preview environment
gate and database host gate are the runtime controls.
Never provision this profile against the live DB, upload store, or a tunnel.

The admitted Workroom and its current TaskRun and drive stage must exist on
that target. The owning Workroom record pins the reviewed synthetic fixture,
case, destination and data-only recipient, the active stage attempt, original
deadline and scoped credential identity, and the registered Control signing
public key. Only Control holds the corresponding private key. The server reads
the current governed platform approval, scoped credential, permit, binding,
subject, room access and grants. A cloned room, approval marker or fixture is
not a way to create authority. An unbound inbox decision, even if approved,
cannot substitute for the exact approval.
The approving human must still have `manage_platform` (including the install
owner through the existing capability model) and must not be the Workroom
requester or the task actor.

## Read interface

`GET /api/internal/s5-rehearsal-admission` accepts exactly four unique query
parameters, `workroomId`, `sessionRef`, `stageKey` and `stageAttemptRef`.
Control signs canonical JSON with keys `purpose`, `method`, `receiver`,
`attempt`, `leaseId`, `sourceSha` and `expiresAt`. The purpose is
`dpf.s5.rehearsal.admission.read.v1`. The method is `GET`. The receiver
object binds `issuer`, `receiverRef`, `hostRef` and the exact preview
`resource`. The attempt object uses the four exact lookup fields. The proof
is the base64 Ed25519 signature in `x-dpf-s5-proof` with its DPF-checked
Unix-millisecond deadline in `x-dpf-s5-proof-until` (at most 15 seconds).
The signature authenticates the request, not an admission document.

The read returns either a non-cacheable `observed` snapshot or an opaque
`held` response. The response cannot create custody, update Control's local
subject expectation, substitute for S6 freshness or authorize a start.
Provider egress remains held without governed approval and the joined no-send
proof. Production and v1 cannot use this qualification.
