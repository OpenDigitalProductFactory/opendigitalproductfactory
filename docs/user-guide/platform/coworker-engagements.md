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

A provider-capacity pause retains its original engagement and task. After its
recorded retry time, repeat the identical fulfillment packet to request a
bounded wake of that task. Reading the engagement only observes it. Current and
original authority are revalidated; changed scope, unknown execution outcomes
and exhausted attempts do not dispatch. Prior continuation audit history stays
attached through later waits and terminal results. A provider refusal is not a
Critic contribution: a completed critique still requires the coworker's actual
source reads, WSID evidence and persisted result returned to the Workroom.


### Native reader failures

The Critic's bounded read lane attaches the authorized source, profession wiki
and calibrated critique readers directly to Codex through DPF MCP. It preserves
the original coworker, user, artifact and task fence. A restricted read profile
cannot run shell commands or write files. It must obtain complete immutable
artifact pages and actual corpus evidence before its contribution can complete.
An empty calibration corpus remains an explicit advisory limitation.

Missing evidence produces a held, nonresumable outcome with the missing source
or corpus requirement. Native closure/effect proof belongs to the existing
execution-proof producer; this reader repair does not manufacture that proof or
repeat provider calls to turn missing evidence into a passing contribution.
The earlier pre-inference capacity wait and completed-result observation paths
retain their existing bounded, idempotent recovery contracts.

Historical unrestricted CLI attempts without native capability, descendant
closure and effect evidence remain unavailable for replay even if they returned
normal text and recorded no governed tools. Their next action names the existing
recovery owner's supported finite disposition. A newer restricted transport does
not supply retrospective proof for an earlier attempt. Unknown outcomes and
unattested native attempts remain held without replacement requests.


For a visual critique, supplied captures can be bound to the original request with
an immutable document-version manifest. Each capture records the reviewed source
revision, state, time, viewport, image dimensions and exact version/hash. Captures
are inputs; only the coworker's persisted contribution counts as participation.
Missing or inaccessible captures stop execution with `engagement_visual_input_refused`.
Unsupported image transport stops before inference. A source-only answer cannot
complete a request bound to rendered inputs. Missing execution proof still holds
an incomplete attempt without replay. An older bound request keeps its original
revision; later material and its limits must be explicitly associated and reported.

Structured specialist completion also holds the boundary against an additional
conversational review/debate call. The validated contribution or held failure is
returned unchanged; ordinary conversations retain their configured deliberation.


A rejected specialist response retains its first validation reason on the original
task. Its bounded original text is kept as **unvalidated assessment data** in
TaskMessage metadata, with a digest, original byte length and truncation or
redaction flags. Retention excludes image data and credential-shaped output.
This data follows the task's existing access and sensitivity. It does not count
as a contribution, authorize replay or change an unknown execution outcome.
Settlement preserves the first reason rather than validating the generated hold
message. A completed contribution still requires all source, corpus and rendered
input checks; the requesting author must provide a separate disposition.

### A held original UX request

An original request whose earlier execution is uncertain can be observed with
its existing engagementId. Observation starts no work. When the current native
policy permits one additional bounded assessment, the supported request is:

```json
{
  "engagementId": "CE-1234ABCD",
  "fulfillment": { "presentAssessment": true }
}
```

This keeps the engagement and its original artifacts. It records a separate
assessment and preserves the earlier task and its unresolved history. It cannot
change the revision, replace the screenshots or restart the earlier execution.

Read presentAssessment for the new task reference, state and next action. A
completed result has its own resultArtifactId, executionRef, native authority
decision, exact artifact and capture references, actual criteria and findings.
A request, working task or held assessment is not a returned critique.

Failure retains the first available reply and failed predicate. An expired or
cancelled task remains observable; repeating the request does not replenish its
allowance or start another generation. Configuration, permission and evidence
failures identify what must be inspected. The requesting author still owns the
response and disposition. Empty calibration evidence remains an explicit
limitation, and the Critic's findings remain advisory.
