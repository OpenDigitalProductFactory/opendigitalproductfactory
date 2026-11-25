# One-shot S5 rehearsal approval

The [preview admission reader](s5-rehearsal-admission-read.md) accepts a distinct,
one-shot owner qualification. Production and v1 do not use it. The producer
only creates a pending request and a permit, without approving or running the
rehearsal.

## Request on the exact Contributor preview

The reviewed non-production Workroom stores its draft under
`workspaceState.s5RehearsalApprovalDraft`. Bind the reviewed fixture, case,
destination and data-only recipient, exact Workroom session, stage and attempt,
issuer and subject, Control key and resource, current scoped grants, preview
lease, source SHA, and the original DPF-clock deadline. The deadline may not
be later than 120 seconds after the producer's clock. The preview requires
its own configured GPP signing key. An unsigned or shadow permit is refused.

The private-mesh POST at `/api/internal/s5-rehearsal-admission/request-approval`
accepts a same-origin request with a current owner session. The query carries
only the four exact lookup fields of the admission read and a
`reviewedPinDigest` computed over the server-side draft. Changed or expired pins
hold. The handler cannot provide or repair approved data and never exposes a
signed permit handle or a room credential.

Under the exact Workroom command lock, reserve a stable result for the one
attempt, raise the canonical pending Inbox envelope and persist the enforced
exact-stage permit linked to that envelope in the same transaction. The
approval fingerprint names that permit. An exact replay only reads the
stored result. The human uses the ordinary Inbox decision, which for this
action records approval without dispatching, resuming, or making it standing.
Provider send still requires the separate joined no-send proof and current
rehearsal admission. No provider call is made by either action here.
