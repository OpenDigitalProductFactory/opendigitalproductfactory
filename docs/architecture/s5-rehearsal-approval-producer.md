# One-shot S5 rehearsal approval

The [preview admission reader](s5-rehearsal-admission-read.md) accepts a distinct,
one-shot owner qualification. Production and v1 do not use it. The producer
creates only a pending request and reserves a permit reference. The exact
owner decision issues the permit but does not run the rehearsal.

## Request on the exact Contributor preview

There is no governed writer for `workspaceState.s5RehearsalApprovalDraft`
in this change. Serving stays held until the reviewed Contributor preview
provisioner writes that intent from its reviewed fixture and verified
non-production lease, source and DB, under the exact Workroom attempt lock.
The provisioner must resolve the current subject, separate platform
approver, authority, candidate Control receiver and destination from their
owners. It must bind the fixture, case, data-only recipient, original
DPF-clock deadline, work shape and operations, and leave an exact provisioning
receipt. A generic state update, direct DB row or test fixture is not a
substitute. The deadline may not be later than 120 seconds after the
producer's clock. The preview requires its own configured GPP signing key.
An unsigned or shadow permit is refused.

The private-mesh POST at `/api/internal/s5-rehearsal-admission/request-approval`
accepts a same-origin request with a current platform approver session. The
current `manage_platform` capability is required. The approving user and
Principal are separate from the Workroom requester and the permit's task
actor. The query carries
only the four exact lookup fields of the admission read and a
`reviewedPinDigest` computed over the server-side draft. Changed or expired pins
hold. The handler cannot provide or repair approved data and never exposes a
signed permit handle or a room credential.

Under the exact Workroom command lock, reserve a permit reference and raise
the canonical pending Inbox envelope. No permit row exists yet. The
approval fingerprint binds the reference, work shape, exact operation list
and original absolute deadline. The Inbox rationale shows those values and
marks `post_room_message` as a write that records only a quiet route proposal.
An exact proposal replay reads the stored result without raising another card.

The decision-only action re-reads the current approver, reviewed pins and
original proposal receipt under the Workroom lock. The canonical owner
approval and the exact signed permit commit in one transaction. A failed
permit write rolls back the approval. Declining or missing the window leaves
no permit, and a permit issued before the deadline expires at that same
absolute instant. The approval cannot become standing. The click and both
approval-completion paths never replay a tool or start or resume a task.

**A missed approval window permanently spends this attempt.** The original
deadline cannot be extended, and **Ask again** cannot reopen this request.
Any further rehearsal would need a separately governed attempt and approval.
The one-shot limit applies to provider requests, including every retry and
reconnect. Control and the relay must enforce it at egress. The stage permit
and broker's operation ID deduplication do not meter provider requests.
Provider send stays held without the joined no-send proof and current
rehearsal admission. No provider call is made by either action here.

Before any scoped room credential is issued, the Build Studio dispatch test
route must refuse Workroom and other non-operator credentials, as well as
revoked or expired operator PATs (BI-38C7C842).

Admin service logs also refuse the direct Docker fallback if the private
actuator mount is present or the mount table cannot be read and parsed.
A missing mount table on a non-Linux development host is the only read-error
exception. BI-42438509 owns the later switch to the shared actuator client.
