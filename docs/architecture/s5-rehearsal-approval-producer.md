# One-shot S5 rehearsal approval

The [preview admission reader](s5-rehearsal-admission-read.md) accepts a distinct,
one-shot owner qualification. Production and v1 do not use it. The producer
only creates a pending request and a permit, without approving or running the
rehearsal.

## Request on the exact Contributor preview

The reviewed non-production Workroom stores its draft under
`workspaceState.s5RehearsalApprovalDraft`. Bind the reviewed fixture, case,
destination and data-only recipient, exact Workroom session, stage and attempt,
issuer and subject, platform approving Principal, Control key and resource, current scoped grants, preview
lease, source SHA, and the original DPF-clock deadline. The deadline may not
be later than 120 seconds after the producer's clock. The preview requires
its own configured GPP signing key. An unsigned or shadow permit is refused.

The private-mesh POST at `/api/internal/s5-rehearsal-admission/request-approval`
accepts a same-origin request with a current platform approver session. The
current `manage_platform` capability is required. The approving user and
Principal are separate from the Workroom requester and the permit's task
actor. The query carries
only the four exact lookup fields of the admission read and a
`reviewedPinDigest` computed over the server-side draft. Changed or expired pins
hold. The handler cannot provide or repair approved data and never exposes a
signed permit handle or a room credential.

Under the exact Workroom command lock, reserve a stable result for the one
attempt, raise the canonical pending Inbox envelope and persist the enforced
exact-stage permit linked to that envelope in the same transaction. The
approval fingerprint names that permit. An exact replay only reads the
stored result. The signed permit is prepared while the envelope is pending
but is not usable for S5 admission until the owner records the exact one-time
approval. The ordinary Inbox uses the server's decision-only action
registration. Both completion paths stop before looking for a call to replay
or a task to resume, and the decision cannot become standing.
The one-shot limit applies to provider requests, including every retry and
reconnect. Control and the relay must enforce it at egress. The stage permit
and broker's operation ID deduplication do not meter provider requests.
Provider send stays held without the joined no-send proof and current
rehearsal admission. No provider call is made by either action here.

Before any scoped room credential is issued, the Build Studio dispatch test
route must refuse Workroom and other non-operator credentials, as well as
revoked or expired operator PATs (BI-38C7C842).
