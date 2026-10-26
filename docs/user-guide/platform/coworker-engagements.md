# Requesting and reading a coworker contribution

A saved engagement request is the start of work. It does not mean the coworker
has executed or accepted the design.

For an existing engagement, use `request_coworker_engagement` with its
`engagementId`. Omit `fulfillment` to read its persisted state without starting
work. To start the original advisory contribution, include the current
`workroomId`, `stageKey`, and an immutable `artifactRef` naming the repository,
commit, path, and blob. Optional `guidanceArtifacts` pin complete profession
guidance at the room's recorded head. The server retains the original requester,
offer, provider and request scope.

The reviewed artifact may be historical while the Workroom head is newer. If the
original request names a commit, fulfillment must use that commit. This repair
does not authorize a later revision under the old request. A different revision
needs an explicit attributable association; the original request is retained.

Read the same engagement after a lost response. A matching retry observes its
existing task. It does not create a replacement engagement or another execution.

| State | Meaning and next step |
| --- | --- |
| requested | Request stored; no specialist contribution yet. Fulfill the original request. |
| accepted / in-progress | Original task admitted or executing. Observe that same task. |
| completed | Verified specialist result persisted, with source and corpus provenance. Obtain the author's response. |
| failed | Execution failed. Inspect the original failure and its supported recovery. |
| unavailable | No complete verifiable contribution was produced. Inspect read provenance and the named failure or budget. |
| unknown | Effects are uncertain or authority is held. Reconcile the original execution before any retry. |

The result identifies the engagement, execution, exact reviewed artifact, actual
criteria, findings and read evidence. Source pages must form a complete traversal.
Wiki search previews are labeled as previews; complete pinned guidance reads are
listed separately. Evidence retention has explicit count and size limits.

An empty calibrated UX corpus is reported as **UNGROUNDED**. Critic findings
remain advisory. Browser checks, a request, a task reservation and a passing build
are different evidence from an executed specialist critique. The requesting
Workroom receives the result; author disposition remains separately attributable.


A failed request whose worker rejected the immutable packet before execution may
be continued once using the same original fulfillment locator. First observe the
engagement to project the actual task failure. The server verifies that exact
pre-admission failure, unchanged request and current original consent family,
and refuses any recorded execution, uncertainty or prior continuation. The task
and engagement IDs remain unchanged; the original failure and digest are retained.
All other failures require diagnosis of the original task. Observation alone
never starts or resumes execution. A projection error explicitly says to retry
observation and inspect phase timings; it does not imply the Critic ran.
