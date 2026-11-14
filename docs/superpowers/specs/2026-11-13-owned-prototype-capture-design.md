---
status: active
---

# Owned prototype capture

Backlog: BI-CA4DC298. Workroom: WC-49FB71DF. Status: design draft; implementation and runtime verification unrun.

## Observed gap and scope

On canonical source 6b934ef5740105c075af60ed639a7424f588f9ac, `engagement-fulfillment.ts` requires rendered inputs before the first Critic dispatch. `engagement-visual-evidence.ts` consumes an exact engagement/artifact/actor manifest with 1–4 owned immutable image versions. It does not produce those versions. The existing document content route serves an original as an attachment, not an interactive HTML preview. The existing browser-use navigation policy correctly blocks private and localhost destinations. That restriction must remain unchanged.

BI-BCBCA8D1 owns engagement execution and consumption. This item already owns the missing capture producer. C317's original CE83 prototype is one motivating case, not authority to replay its historical reviews. Its source is commit 98e18713d9c9b81189fe32274b91d94cec119ea2, path `docs/superpowers/specs/2026-10-30-native-mailbox-onboarding-prototype.html`, blob e4350f1df2f7e23cef9fd9fa73885ee0ce809f72, SHA256 ff42e688fe3fe8728e82a630f69c84c29a1f4e13a6b202922d814036d8eb434b. Source reading is not rendered evidence.

**OBJ-1:** An authorized requesting agent can obtain genuine rendered captures of its exact engagement artifact without transporting image bytes through the model.

**OBJ-2:** Rendering cannot acquire mailbox, browser-profile, network, filesystem or other installation authority from the prototype.

**OBJ-3:** The existing Critic consumes the resulting owned immutable manifest through its unchanged admission and publication contracts.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | An exact authorized HTML artifact produces attributable PNG/JPEG versions and a manifest accepted by the existing consumer; bytes are stored internally, never returned as model-sized base64. |
| AC-2 | OBJ-2 | Wrong actor, organization, original artifact or current source binding is refused before rendering or storage. |
| AC-3 | OBJ-2 | A fresh isolated browser context contains no user profile, cookies, credentials or persistent storage; all external requests, service workers, popups, downloads, forms and navigation are denied. Existing ordinary navigation SSRF policy is unchanged. |
| AC-4 | OBJ-1, OBJ-2 | Rendering has explicit source-size, time, viewport, pixel, count and output-byte bounds; malformed input, timeout and unavailable browser capacity return a typed failure with cleanup and no successful manifest. |
| AC-5 | OBJ-3 | A current permitted original engagement receives the exact captures, returns attributable Critic findings and records the original-room result; a queued task or screenshot alone is not acceptance. |
| AC-6 | OBJ-2, OBJ-3 | Revocation, source change and concurrent duplicate requests cannot publish a manifest under a displaced authority fence or reset a consumed assessment allowance. |

## Alternatives and decision

1. Add an authenticated sandboxed HTML document preview plus a client image-ingestion bridge. This reuses document access, but leaves platform completion dependent on client capture and needs a separate owned-byte transport.
2. Extend the existing browser-use service with an explicit isolated offline renderer, and reuse document versions/blob storage for outputs. This removes the client dependency and keeps rendering distinct from general browsing.
3. Leave the producer missing and wait for a manual workaround. This preserves the blocker.

Kernel DI-7652EE1A746E recommends option 2, high confidence, usable/autonomy-eligible. Scores used explicit qualitative engineering estimates, not measured performance. Initial DI-7CE9363FC6F5 lacked features and made no recommendation; a subsequent invalid-dimension request was rejected before a decision. Neither is approval evidence. The chosen design remains subject to normal independent review and implementation admission.

## Proposed reuse and boundaries

- Reuse the original engagement's server-resolved actor, artifact and Workroom binding; caller-supplied paths, URLs, actor IDs and current-version pointers cannot select source bytes.
- Reuse immutable source readers and existing Document/DocumentVersion/DocumentBlob storage. Do not add a parallel capture database, provider, runtime or blanket grant. Resolve an existing appropriate tool authority through normal admission before exposing a producer.
- Add an explicit immutable HTML preview to the existing document surface, preserving its session/organization access checks. Serve exact version bytes with a restrictive HTTP CSP sandbox and no same-origin privilege. Its actual URL identifies the rendered source; attachment URLs and invented URLs must not be represented as observed previews.
- Extend the existing browser-use service with a separate operation for server-qualified artifact bytes. It is not a `browse_open` exception. A fresh nonpersistent context blocks service workers and all network; do not send a user browser profile, credential, arbitrary URL, executable evaluation or unrestricted action script.
- Preserve prototype bytes. Initial delivery covers the default state and declared viewport/theme only. Any later interaction-state capture needs separately bounded supported controls and must retain limitations; do not manufacture other states from source inspection.
- Store genuine output pixels as versions owned and created by the requesting agent's principal in the same organization. Probe image type, dimensions and digest before creating the existing manifest. Preserve the consumer's four-image/four-megabyte total bound and exact artifact association.
- Record source hash, actual preview URL, renderer version, timestamp, viewport/theme, limitations and capture hashes. Revalidate original/current authority before publishing a result. A failed render cannot create successful evidence or authorize review replay.

## Independent design findings and required qualification

A CLIENT-only independent review found three blockers before implementation. These are accepted findings, not a native approval or passing runtime result.

1. `services/browser-use/server.py` currently launches Chromium with its sandbox disabled; the Dockerfile retains root and Compose mounts persistent profiles. A fresh browser context alone cannot establish OBJ-2. The new operation must execute in a distinct least-privileged child with a clean environment and no access to profile/evidence secrets, using a sandbox-enabled Chromium launch. Qualify actual container user-namespace and filesystem behavior. If the sandbox cannot start, return unavailable and clean up; never fall back to the existing unsafe launch. Preserve compatibility and permissions of existing browser sessions. Dockerfile/process-policy changes require exact source claims and security review before delivery.
2. The shipped service uses browser-use/CDP; it does not explicitly declare Playwright. Do not apply Playwright examples to BrowserSession. Proposed concrete API: explicitly pinned Python `playwright==1.64.0`, verified available from its Microsoft-maintained PyPI release, driving the already-installed Chromium in the isolated child. This is a declared dependency change requiring installation/API/browser compatibility tests, not an assumed transitive dependency. No additional browser download, provider, container or broad navigation tool is needed.
3. Authenticated preview and offline rendering are distinct transports. Extend the existing document content route with an explicit pinned preview query, preserving default attachment behavior. A human may view that authenticated URL. The renderer receives server-qualified exact bytes and fulfils only the initial logical source request internally with those bytes and restrictive CSP; it sends no credentials and makes no network fetch. The manifest must record `offline-qualified-bytes` and explicitly say its URL is the immutable source locator, not an observed authenticated fetch. Block every subsequent request, service worker, WebSocket, popup, download and navigation before loading bytes. Actual preview-byte equality, effective CSP, isolation and cleanup require runtime proof.

The [verified package release](https://pypi.org/project/playwright/1.64.0/) establishes package availability only. The [BrowserType API](https://playwright.dev/python/docs/api/class-browsertype) establishes the launch contract, not suitability of this container. No code may weaken the ordinary URL policy to accommodate these requirements. The three findings remain open until source and runtime evidence substantiate them.

## Standards and verification basis

The [Playwright BrowserContext contract](https://playwright.dev/python/docs/api/class-browsercontext) warns that service-worker requests evade ordinary routing; use a fresh context with service workers blocked in addition to request interception. The [W3C CSP sandbox contract](https://www.w3.org/TR/CSP3/#directive-sandbox) provides origin and browsing-context restrictions; browser isolation and explicit network denial remain separate controls. These are design requirements, not tests already run.

## Ordered implementation and proof

1. Confirm the producer slice remains within this existing item's approved scope; preserve its separate archived-room successor issue. Resolve funding through recorded scope before paid review/runtime allocation.
2. Reproduce the missing producer with a focused failing contract test around existing engagement and manifest admission; retain current consumer tests unchanged.
3. Implement the bounded artifact/source qualification and owned storage composition, plus immutable sandbox preview and isolated existing-service renderer. Obtain required architecture/security and changed-surface reviews before publication.
4. Test cross-actor/org/source substitution, duplicate identity, revocation/fencing, all network channels, popups/downloads, oversized output, timeout and cleanup. Run affected package checks and canonical shared-runtime gate; no hand-built installation image.
5. Publish through signed protected PR and canonical update. Verify containing bytes, then drive one currently permitted original engagement end to end. Capture actual Critic findings and room return. Preserve CE83's existing permissions and original settlement boundaries; do not substitute a new engagement merely to obtain a pass.

## Execution history and evidence limits

Normal DESIGN claim IRD-E221F1E15860, research receipt initiative-298af8bc-7bcc-4af7-b485-31012038badb, PLAN claim IRD-5EFD36EAEE68 and implementation projection IRD-C42D0694BC96 were admitted. Admission is not approval of the unqualified renderer design. Managed dependency bootstrap now reports compile-ready; no unit/type/runtime gate is claimed. Exact source scopes and test-impact requirements are recorded. Funding attribution for this Workroom item requires owner approval; no spend or allocation is inferred. Production capture remains unavailable, and no previously refused capture was attempted through another transport.

Subsequent checkpoint: funding approval cmwfe47pk086p0ep48h5v8qfk is EXECUTED; an actual room read confirms its item-specific binding at 2026-11-13T19:56:38.360Z. Amended atomic plan coverage cmwfelwwq0eet0ep4vtzb0qb4 binds f9c597. Source-local renderer contracts now cover exact source/output identity and limits, a dedicated child identity with clean environment/process group, private profile-directory qualification, sandbox-enabled browser launch without unsafe fallback, network guards before source loading and cleanup. Fourteen new source tests pass; browser APIs/processes are test doubles, not a real container/browser result. The two missing shipping contracts first failed, then passed after declaring the API dependency and copying required modules. Removing the sandbox flag produced the expected failing control before restoration. Existing URL-policy checks (4) and outcome checks (7) pass separately. No ordinary URL restriction was relaxed.

The DPF connector subsequently returned `MCP authentication required. Reconnect to continue using this server.` Native coordination, new scope admission, canonical verification and publication cannot proceed through it until an authenticated call succeeds. No alternate token, DB write or grant bypass was used. Work remains source-local under existing admission. Native engagement wiring, owned document/image/manifest production, actual preview, container/browser security qualification, independent native review, protected PR, deployment and original business acceptance are still unrun. The renderer findings are not closed by these source tests.

CLIENT source review of local checkpoint f8e814d6b22a8b918342bd209b13bd1099e0791c found two further blocking gaps: HTTP/WebSocket interception does not establish a network boundary for channels such as WebRTC/STUN, and process-group termination does not contain descendants that create another session/group. The worker still shares the service network namespace. The mocked cleanup tests do not prove real Chromium/driver termination. The source is therefore a partial, unpublished implementation, not a qualified offline renderer; no native entry was wired and it must not be invoked as acceptance evidence. After reconnect, obtain a current architecture decision for an enforceable network boundary and complete owned-family cleanup, then run actual adverse egress and detached-descendant tests on a governed target. Do not weaken host security or ordinary SSRF policy, and do not infer a successful native review from this CLIENT assessment.

## Kernel transport and cleanup repair checkpoint

MCP coordination is restored through an authenticated room read and heartbeat.
The funding approval above is executed; no replacement approval is needed.
DI-3D36CA7B4044 selects a kernel-filtered worker within the existing service,
subject to actual qualification. It does not approve weaker host security.

The source now installs libseccomp before loading Playwright or starting its
driver. It denies new sockets, external connections/listeners, io_uring and
descriptor-acquisition paths, and refuses inherited sockets. Only private Unix
stream/seqpacket socketpairs remain available for descendant IPC. Filters and
no-new-privileges inherit across fork/exec. HTTP interception and CSP remain
additional controls, not the asserted network boundary. This is not a claim
that seccomp alone is a complete browser sandbox.

The root controller holds a cross-process lock, requires an empty reserved-UID
inventory and enables orphan adoption before launch. It pins kernel process
handles before accepting process identity; cleanup follows the reserved identity
across new groups/sessions and repeats until empty. Unknown inventory is a hold,
never empty. The controller persists an unsettled marker before launch and
clears it only after cleanup succeeds. Cancellation cannot release admission
early; uncertain cleanup retains the directory and durable hold.

Nineteen worktree unit tests pass, including guard-before-browser-load and
repeated cancellation followed by inventory failure. Browser/process APIs in
those tests are doubles. Existing URL-policy and outcome tests pass separately.
The new cloud workflow builds the existing production browser Dockerfile and
executes Linux kernel, detached-process and real sandboxed-browser tests with
bounded resources, no credentials and no security exceptions. Those tests are
UNRUN at this checkpoint. Compatibility, memory containment, actual sandboxing,
native producer wiring, image/manifest storage, Critic findings and business
acceptance remain unproven. Keep the producer unwired until qualification.

Subsequent CLIENT review confirms the cancellation defect is closed in de01526.
It identifies missing production aggregate memory/process containment. Source
admission now requires an actual private cgroup-v2 root with positive finite
memory/PID limits no greater than 1 GiB/256; unbounded, absent or ambiguous
limits refuse capture before launch. Two added resource-admission tests first
errored for missing behavior, then passed, bringing source-local tests to 21.
This closes an unsafe admission path, not production configuration or resource
qualification. No container limit or live host setting has been changed here.

Further source inspection found the mounted screenshot evidence directory also
needed qualification. A regression test against the old helper failed because
it accepted a readable evidence root; the new helper qualifies both roots.
Read-only canonical diagnostics confirmed root:root 0755 for both mounts and
unbounded actual memory/PID limits. The portal's actual UID and mounted evidence
owner are both root. Source now creates private roots for fresh images and
converges existing safe root-owned directories at normal service startup through
no-follow descriptors, preserving their contents. It refuses wrong owners,
symlinks and writable-by-others roots rather than adopting them. Normal browsing
still starts if capture setup cannot qualify. Compose and its canonical budget
registry declare 1 GiB/one CPU/256 PIDs. No live chmod, resource mutation or
container recreation was performed.

Source-local tests are now 25 passing Python cases plus the existing 16-case
resource-budget suite. Actual Compose configuration rejects the original
unbounded configuration and accepts the declared new limits. This is source
configuration evidence, not proof of deployed limits. Eight Linux image checks,
including actual service-startup wiring, remain UNRUN. The earlier shared gate
queued at source9959325 and was normally cancelled before admission to fix this
newly identified boundary; status is INCONCLUSIVE/cancelled, not a code failure
or pass. A new source-bound gate and cloud qualification are required.

## Proposed sandbox design amendment — not approved or actuated

Actual default-policy cloud image tests on both AMD64 and native ARM at
5c7f231619cedd47d269b0f4b476d051f370fc0e each executed eight checks: seven
passed, and real Chromium launch failed with `No usable sandbox!`. The bounded
fixture diagnostic identifies the sandbox-launch failure class, not the decisive
package or syscall. Source compilation, the seven containment results and an
architecture score cannot qualify this browser. The producer remains disabled.

The current prohibition on relaxing host/container policy remains in force.
This section proposes a reviewable amendment; it grants no runtime action.
The existing source owner and sole release coordinator retain their roles.

1. **Reuse a proven, already-authorized sandbox-capable runtime.** Require actual
   browser, filesystem, network, resource, cleanup and original/current authority
   evidence from its existing owner, with no new provider, spend, grant or client
   dependency. The inspected running-target records describe a portal peer and
   Build Studio sandbox, not a qualified browser service. The build sandbox's
   checked-in image is Node/Alpine without Chromium/Playwright. Empty service
   catalog searches are not proof that no eligible runtime exists. A healthy
   peer record is not environment-class or execution authority.
2. **Prepare a maintained namespace-profile amendment for the existing service.**
   The [official Playwright Docker guidance](https://playwright.dev/python/docs/docker)
   requires a nonroot browser and a Docker seccomp profile permitting its user
   namespace creation. Compare an exact maintained baseline with the proposed
   delta; do not substitute an old broad profile or disable seccomp. Independent
   security and architecture review must assess the whole service's changed
   kernel surface, version/architecture support and compatibility. Review and
   subsequent governed admission must precede any test or production actuation
   of changed policy. No `--no-sandbox`, unconfined mode, added host capability,
   host IPC, global sysctl change or new runtime/provider is an allowed shortcut.
3. **Retain the unsupported hold.** Preserve all evidence and ownership while
   the runtime boundary is unresolved. This is safe containment, not delivery
   of the producer or either original acceptance criterion.

The canonical reviewer roster names AGT-WS-EA for architecture and AGT-190 for
security. Read-only live queries resolve their principals; those identity reads
do not prove current reviewer eligibility. The actual issuer packet must select
an eligible independent holder after the amendment is published. No author may
proxy an approval. WWMD consultation and review requests were deferred during
the release coordinator's observed DRAINING window, without claiming they ran.

The actual diagnostic also shows Playwright's temporary profile under `/tmp`
outside the request HOME. The source-only cleanup correction binds TMPDIR to
the owned request home. Its environment regression failed before the fix and
the 25 source tests now pass. A new physical timeout/artifact-cleanup test is
authored but unrun. This correction neither enables sandboxing nor authorizes a
replay of an original engagement. The next qualified runtime must prove both
normal and failed/cancelled cleanup before producer integration.

WWMD DI-94DF1EA45BD5 compared these three source/design paths after the
coordinator verified NORMAL. It recommends review of the namespace-design
amendment with low confidence/margin 0.198227: usable, but autonomyEligible is
false (`confidence_not_high`). Its canonical outcome is unresolved with no
chosen option. No scores were tuned or review outcome inferred. Independent
critique of both alternatives is evidence gathering under the existing repair
scope; it does not select or implement the disputed policy. Current medium-item
architecture/security recovery reads expose no initiative-review packet. Use
only a normally admitted independent source-review issuer; do not borrow another
case's packet or proxy a reviewer. The current runtime hold remains intact.

## Current diagnostic disposition — November 13, not an approval

This section supersedes earlier unrun Linux/TMPDIR statements above. Published
source `10d985276b082d8d7aa25bf3b398d1f7c787718d` passed canonical gate
`cmwfmon0u0c800eqcmbpb355z`; lease `NPEL-1023758256` released normally.
The [actual image qualification](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/actions/runs/43529921030)
ran ten tests per architecture: eight containment/startup/cleanup checks passed,
one availability diagnostic completed, and actual browser capture failed.
An availability diagnostic completing is not a successful namespace creation.
The prior run `43527236463` physically verified owned TMPDIR artifact cleanup
on both architectures. Python source tests separately passed 25 cases; those
are not the gate's 29 TypeScript tests or a real browser pass.

| Observed boundary | AMD64 job 132244781331 | ARM job 132244781593 |
| --- | --- | --- |
| Engine / kernel | 29.4.2 / 7.0.0-1019-azure | 28.0.4 / 7.0.0-1017-azure |
| Image SHA-256 | `58ffeb4a6daab0e6ffd3c02d49ed354d0d80791da54ab5a90bf55863c4997a52` | `7d775516c5af79730bf4870e8f116e691a1ec2ad0ef101e6afc1c301cde3921b` |
| Chromium / Playwright / libseccomp | 156.0.8078.79 / 1.64.0 / 2.6.0 | 156.0.8078.79 / 1.64.0 / 2.6.0 |
| Existing policies | builtin seccomp; docker-default AppArmor | builtin seccomp; docker-default AppArmor |
| Both probe identities | UID/GID 10001, groups empty, NNP 1, CapEff 0 | UID/GID 10001, groups empty, NNP 1, CapEff 0 |
| Before / after transport guard | seccomp filter count 1 / 2 | seccomp filter count 1 / 2 |
| `unshare(0)` and `unshare(CLONE_NEWUSER)` | EPERM in both probes; namespace unchanged | EPERM in both probes; namespace unchanged |

Both probes confirmed an actual syscall path with `getpid`, enforced NNP's
irreversibility with EINVAL, ran sequentially with finite deadlines, and left
no capture-UID process. Both images lack `chromium-sandbox`. A positive host
user-namespace sysctl does not remove a container denial. These results establish
that the added worker filter is not the sole source of the observed denial.
They do not distinguish every AppArmor contribution, trace the browser's exact
failing syscall, or prove that changing seccomp alone will make capture work.

Primary source for the tested Chromium version explains the failure path:
[sandbox selection](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.79/content/browser/zygote_host/zygote_host_impl_linux.cc)
uses a successful user-namespace probe or an available setuid helper;
[the probe](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.79/sandbox/linux/services/credentials.cc)
requires a CLONE_NEWUSER fork and an unprivileged CLONE_NEWUSER unshare. The
[namespace launcher](https://chromium.googlesource.com/chromium/src/+/refs/tags/156.0.8078.79/sandbox/linux/services/namespace_sandbox.cc)
also requests PID/network namespaces. These upstream sources support a
namespace-boundary hypothesis, not an attestation of Debian's entire patched
binary or successful capture. Installing a setuid helper is not a demonstrated
solution under the required no-new-privileges boundary.

### Alternative 1: bounded eligibility and adaptation cost

A candidate is eligible only with all of: an existing accountable owner;
authorized environment class and current execution scope for this operation;
immutable image/browser/dependency identities for the relevant architecture;
an already-authorized sandbox policy; credential/profile isolation from the
capture UID; actual transport/descriptor denial; finite cgroup resources;
verified timeout, cancellation and whole-family cleanup; owned evidence
publication; and legitimate original/current engagement authority. A healthy
URL, a renderer screenshot or an ordinary portal verification is insufficient.

Fresh authorized runtime-map searches covered running, verified, verifying and
assigned records, plus the browser service catalog query. Running returned the
portal peer and Build Studio sandbox, neither with browser qualification;
verified returned the ordinary root portal; verifying/assigned and the browser
catalog query were empty. The unrestricted map request was truncated and is not
a complete inventory. Broader contributor-inventory and browser-task grants
were unavailable and were not bypassed. No observed candidate satisfies the
predicate; global absence has not been proved.

If an existing owner supplies a candidate satisfying that predicate, reuse avoids
changing the ordinary browser service's kernel surface. Dependency installation,
a sidecar, new mounts or a new transport are adaptations requiring their own
normal design/admission and qualification; they are not already-authorized
reuse. The inspected Node/Alpine Build Studio image would require browser and
dependency installation plus new containment proof. No such adaptation, owner,
schedule or cost has been approved. This path is bounded by candidate evidence,
not an indefinite search or an invented claim that a new runtime is cheaper.

### Alternative 2: exact baseline and candidate delta for critique only

The AMD64 Engine reported Git commit `d329809`, resolved from the public Moby
repository to `d3298094ac5111e5d67517a252d291d27543e408`. Its
[vendored baseline](https://github.com/moby/moby/blob/d3298094ac5111e5d67517a252d291d27543e408/vendor/github.com/moby/profiles/seccomp/default.json)
has SHA-256 `1a4d017730647621403920d9558aa0152adef04dd89ed7720e4abafa24551999`.
The ARM Engine's commit is `6430e49a55babd9b8f4d08e70ecb2b68900770fe`;
its [baseline](https://github.com/moby/moby/blob/6430e49a55babd9b8f4d08e70ecb2b68900770fe/profiles/seccomp/default.json)
hash is `9c1025c88ccaa517b648da571961838744ea2137f176bfe6a48b21294cae9c76`.
These are source-matched upstream baselines, not dumps of the loaded filters.
Their clone rules exclude namespace flags without CAP_SYS_ADMIN and unshare is
only conditionally allowed with that capability. The measured effective
capabilities are zero. Preserve all baseline rules and their conditions in any
future reviewed candidate; do not replace a modern baseline wholesale with the
older Playwright example.

In particular, the [Playwright-linked profile](https://github.com/microsoft/playwright/blob/ae935a43d9e376e4759548f6b3c6905c7b282333/utils/docker/seccomp_profile.json)
hash `cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849`
allows unrestricted clone/setns/unshare and differs elsewhere, including
io_uring rules. It is guidance, not a minimal drop-in delta or runtime consent.

The **unapproved W candidate for review** retains each exact Engine baseline
and adds only these two argument-qualified allow rules. Both additions are
restricted to the two examined Linux daemon architectures; they must not alter an
unqualified architecture's baseline:

```json
[
  {
    "names": ["clone"], "action": "SCMP_ACT_ALLOW",
    "args": [{"index": 0, "value": 235012096, "valueTwo": 0, "op": "SCMP_CMP_MASKED_EQ"}],
    "includes": {"arches": ["amd64", "arm64"]}
  },
  {
    "names": ["unshare"], "action": "SCMP_ACT_ALLOW",
    "args": [{"index": 0, "value": 268435456, "op": "SCMP_CMP_EQ"}],
    "includes": {"arches": ["amd64", "arm64"]}
  }
]
```

On the two supported architectures clone flags are argument zero. The first
mask retains denial of NEWNS/NEWUTS/NEWIPC/NEWCGROUP while allowing USER/PID/NET
namespace combinations, including PID/NET without USER; ordinary clone rules
remain unchanged. That breadth requires explicit review, not an assumption that
every new namespace must be paired with USER. The second permits
only CLONE_NEWUSER unshare. Setns and clone3 behavior stay at baseline; no
io_uring, ptrace, descriptor-transfer or other syscall permission is added.
This is a proposed qualification hypothesis, not proven sufficient, selected,
installed, or declared minimal. No candidate profile file or security_opt change
exists in source or runtime.

The whole service, including ordinary root browser sessions, would acquire the
outer profile's new syscall surface. Its kernel exposure and compatibility must
be reviewed explicitly; capture's additional filter does not protect ordinary
sessions. The worker guard is installed before browser/library loading and
denies sockets, broker connections, io_uring_setup, ptrace, process_vm and
pidfd_getfd. It has no clone/unshare rule. Linux documents
[filter inheritance and precedence](https://docs.kernel.org/userspace-api/seccomp_filter.html):
layering cannot relax an outer denial. Do not move the guard after browser
startup to work around this boundary. NNP, cgroup limits, private directories,
no-network execution and sandbox-enabled startup remain mandatory.

The canonical host is a distinct Docker Desktop 4.98.0 / Engine 29.9.2,
Git commit `0367cbe`, ARM/kernel 7.0.14-linuxkit. The initial short-commit lookup
returned HTTP 422; that lookup failure is now **superseded**, not an outstanding
source-provenance blocker. The release coordinator found the official
[`docker-v29.9.2` tag](https://github.com/moby/moby/releases/tag/docker-v29.9.2).
This source owner independently read its annotated tag object
`d7dfd6629b22aed77600050ab53695149b8c550d`, verified API signature status
`verified: true`, and resolved full Engine commit
`0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c`. Its
[vendored expected profile](https://github.com/moby/moby/blob/0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c/vendor/github.com/moby/profiles/seccomp/default.json)
was independently fetched and hashed as
`785b2429264afba4d594320337cb17f144f3c7d51585f9805eef72e28f4f9334`.
Its namespace conditions match the relevant pattern described above. This
proves expected upstream source at the advertised Engine commit, not the
Desktop binary's compiled/effective BPF or policy approval. No canonical
namespace experiment ran, and neither CI profile is its production baseline.
Any production proposal must name this distinct maintained baseline and its
exact delta, retain the observed-runtime distinction and undergo normal review.

The existing owner must obtain normal independent security/architecture review
of the concrete candidate, a genuine governed decision and admission **before**
any changed-policy CI qualification. If admitted, test exact image/Engine/profile
identities, normal browser pixels, original negative controls, rejected forbidden
namespace flags and other syscalls, resources and full cleanup. A refusal or
remaining denial is a failed hypothesis; do not silently widen permissions.
Only actual passing qualification, compatibility and normal protected delivery
can precede producer enablement. Production policy and live advance stay with
the sole release coordinator. DI-94DF1EA45BD5 remains unresolved.

Native af9 architecture-decision review `TR-GATE-DE9942C16A1085002F3ABC45`
passed the earlier alternatives/hold with zero critical blockers and eight
important/minor issues. The current diagnosis, bounded predicate, baseline
comparison and layering account address its evidence requests for a new review;
that historical receipt is not approval of these new candidate rules. Original
Critic findings and the operator's email/MSP acceptance remain unrun.

## Required changes from the c67 policy critique — unresolved before actuation

Native policy critique `TR-GATE-CF2EB8214655B477A6026C8F`, receipt
`cmwfnjfvd0ieq0eqco09ylfet`, passed the c67 source proposal/hold with no critical
blockers and seven important/minor findings. It did not authorize a profile or
certify the ordinary root browser. The four important obligations below are
explicitly dispositioned as **documented, unresolved before actuation**. This
amendment does not turn them into accepted residual risks. One review branch
abbreviated W's mask incorrectly as `0x0E000000`; the actual c67 mask is
`0x0E020000`, confirmed by the other branch and arithmetic checks.

### Observed and inferred namespace operations

| Operation | Evidence class | What is established |
| --- | --- | --- |
| `unshare(0)` | Actual fixed-code CI probe, both architectures | EPERM with and without the worker guard; no namespace change |
| `unshare(CLONE_NEWUSER)` | Actual fixed-code CI probe, both architectures | EPERM with and without the worker guard; no namespace change |
| Chromium sandbox launch | Actual browser process, both architectures | No usable sandbox; no browser pixels; exact browser syscall flag word was not traced |
| `CLONE_NEWUSER \| SIGCHLD`, then NEWUSER unshare | Upstream Chromium 156 credentials source | Required by the cited support probe; not an observed syscall trace of the packaged browser |
| USER/PID/NET default namespace types | Upstream Chromium 156 namespace launcher source | Default options and per-type support probes are visible; the actual capture's accepted launch flags remain unobserved |
| `CLONE_NEWPID \| SIGCHLD` | Upstream Chromium 156 `ForkInNewPidNamespace` helper | A PID-only helper exists; its presence does not prove this capture calls it |

The two unshare probes do not observe the browser's clone flags. No ptrace,
capability addition, altered filter or host audit access was used to manufacture
that evidence. Any future instrumentation needs its own normal admission.

### U versus W: explicit tighter alternative, neither selected

Candidate **U** uses exactly W's two appended rules, including the architecture
conditions and exact NEWUSER unshare rule, except that its clone argument is:

```json
{"index": 0, "value": 503447552, "valueTwo": 268435456, "op": "SCMP_CMP_MASKED_EQ"}
```

The mask is `0x1E020000`, requiring USER and denying NEWNS/NEWCGROUP/NEWUTS/NEWIPC;
PID/NET remain optional. Original no-namespace clone rules remain intact.

| Namespace bits in clone, ignoring ordinary nonnamespace flags | U's added permission | W's added permission |
| --- | --- | --- |
| None | None needed; original baseline applies | None needed; original baseline applies |
| USER; USER+PID; USER+NET; USER+PID+NET | Allowed | Allowed |
| PID; NET; PID+NET without USER | Not added | Allowed by the added filter rule; kernel capability checks still apply |
| Any NEWNS/NEWCGROUP/NEWUTS/NEWIPC combination | Not added | Not added |

Both candidates leave setns and clone3 at baseline and permit only exact NEWUSER
unshare. Pure arithmetic checked all 128 combinations of the seven listed
namespace bits for each predicate. Arithmetic is not syscall execution,
successful browser launch, minimum-necessity proof or security qualification.
U may reject a legitimate PID-only fork after an earlier user-namespace
transition; W may expose combinations capture never needs. Before admission,
the independent reviewer must compare the actual required packaged-browser
paths, both candidates' permitted combinations, ordinary-session exposure and
the supported Engine/architecture boundary. Do not silently choose W if U fails.
The bounded fallback is the unchanged unsupported hold or an actually eligible
already-authorized runtime under Alternative 1, not another relaxed boundary.

For reproducible review, these full candidates were assembled **in memory only**
from each hash-verified baseline: parse its JSON, append the two stated rules,
serialize UTF-8 with Python `json.dumps(sort_keys=True, indent=2)` plus one LF.
Data comparison confirmed every pre-existing syscall rule and every other field
unchanged. No candidate file was written or loaded. Byte formatting changes in
this reproduction are not additional semantic permissions.

| Expected upstream Engine source baseline | U assembled SHA-256 | W assembled SHA-256 |
| --- | --- | --- |
| 28.0.4; baseline `9c1025c88ccaa517b648da571961838744ea2137f176bfe6a48b21294cae9c76` | `52bb8634d9142662c1e4e4641aa9188c149d01dedae4beda269131fc736bff3b` | `59ca04ee59fd6254825a266cc305afce050467ed3fdf4266e4facd1f690454e4` |
| 29.4.2; baseline `1a4d017730647621403920d9558aa0152adef04dd89ed7720e4abafa24551999` | `9a330d950206c7cb8dd182e6234dcc78ca2792b8b08576fdde20c93d62515c82` | `22f84e482c873a04d28eec8b2372989bf36e9d6de6542379ab2476d2e2ddebf8` |
| 29.9.2; baseline `785b2429264afba4d594320337cb17f144f3c7d51585f9805eef72e28f4f9334` | `24e2920d769ee9c0fd86ddd7b83d2d7689c6aa8ccfa5cc5442a90423bf533468` | `49372a24fe71c179521b3f48c4726e4fac9645a9dc11576ea7535a09a5c3c1d2` |

These are six distinct source candidates, not six approved policies. A future
qualification must bind the actual Engine/source/baseline/candidate and refuse
an unrecognized identity; a CI baseline cannot stand in for another Engine.
Profile selection must refuse any architecture outside amd64/arm64. The
maintained [Engine filter reader](https://github.com/moby/moby/blob/0367cbeb49b9d98cb0b4f51e95f7b54b4803e76c/vendor/github.com/moby/profiles/seccomp/seccomp_linux.go)
maps daemon GOARCH to those native names and omits a rule when its `includes`
architecture list does not match. That source condition is not foreign-hardware
qualification. The worker also rejects unsupported OS/machine pairs before
libseccomp or browser loading. Four source-level mocked controls (Linux
ppc64le/s390x/riscv64 and Darwin aarch64) confirmed that refusal without loading
either library; no foreign-architecture runtime was exercised.

### Named failure and residual-risk scenarios

**R1 — post-actuation ordinary-session kernel exposure.** After a future admitted
change, an attacker-controlled page in an ordinary root browser session could
exploit the newly reachable namespace kernel paths. The capture UID's added
filter does not protect that session, its profile credentials or host integrity.
The CA4 delivery owner and independent security reviewer must assess the entire
service, U versus W, the eligible-runtime alternative and the effective outer
boundary before choosing a candidate. Required detection is actual ordinary-
session compatibility plus positive and negative namespace/transport/descriptor
controls, exact runtime identity, finite resources and complete cleanup.
Recovery requires the governed last-qualified image/profile rollback; suspected
host compromise follows existing incident/recovery authority, not an agent's
manual host repair. **Residual unaccepted:** namespace kernel attack surface
cannot be eliminated by these two rules or a passing screenshot. The independent
security reviewer and release coordinator must record an accountable residual
disposition before any production proposal; present source publication accepts
none of that post-actuation risk.

**R2 — choosing breadth without minimum-necessity evidence.** U could fail on a
PID-only helper; W could allow unnecessary combinations. The implementer must
separate observed flag words from upstream inferences and compare both exact
candidate artifacts before admission. Detection requires admitted fixed-code
controls for individual namespace combinations and actual packaged-browser
behavior, not only the 128 arithmetic cases. A failed candidate remains failed;
hold rather than automatically widening, selecting an unreviewed third rule or
changing clone3/setns. **Residual unaccepted:** minimum viable permissions and
both candidates' sufficiency are unproven. The CA4 delivery owner supplies the
evidence; the independent security/architecture review and genuine governed
decision select the next permitted hypothesis.

**R3 — continued AppArmor denial and second-boundary pressure.** A seccomp-only
candidate may still fail because the LSM, packaged browser or another boundary
denies sandbox setup. Before actuation, require an AppArmor-aware hypothesis
with the existing enforcing label preserved and a finite failed-hypothesis stop.
Detection is the actual sandbox result and scoped diagnostic evidence; absent
audit/trace access is unavailable evidence, not permission to obtain it by a
different account or host path. If denial remains, **STOP changed-policy
qualification and retain the unsupported hold**. No AppArmor relaxation,
unconfined mode, host capability, sysctl or second-boundary change is authorized.
The CA4 delivery owner records the failed hypothesis; the release coordinator
and independent security reviewer own any later separately governed decision.
**Residual unaccepted:** this source proposal does not establish that seccomp
alone is sufficient and does not authorize widening to make the test pass.

**R4 — portal update mistaken for browser delivery.** Existing C54E691E/00F7D2E3
source reconciliation is shadow, and the capability-transition actuator's
complete-profile `up -d --wait` has no explicit browser image build. Active saved
settings, an unchanged capability reconciliation or a containing portal SHA
cannot establish new browser bytes, limits or startup permissions. The existing
C54 source owner and sole release coordinator must supply normal design,
admission and actual image/config convergence receipts before live capture
acceptance. Do not toggle capabilities, hand-build or replace a host container
as a shortcut. **Residual unresolved:** this dependency is separately owned and
not delivered by the capture proposal; no duplicate convergence case is created.

### Preconditions and current review route

All four important obligations are required preconditions, not optional follow-
ups: actual-versus-inferred flag map and U/W comparison (R2); whole-service/root
threat model, fallback, compatibility and accountable residual (R1); AppArmor-
aware hypothesis and no-second-boundary stop (R3); and explicit minimum-
permission independent security/architecture review covering all of these.
Service convergence (R4), original/current task authority and actual image
qualification remain additional delivery prerequisites. Only a genuine governed
decision/admission may authorize a bounded nonproduction policy experiment.

The latest native reads still classify this case as `delivery-medium@1.0.0`.
Exact classification/security/architecture recovery queries expose no available
gates or reviewer packets, only a body-baseline acceptance-completion route.
Security and architecture offer searches returned no offers. These bounded
results do not prove no independent reviewer exists; they establish that none
has yet been offered/admitted through those routes. Do not invoke completion
before delivery, manufacture an AGT-190 receipt, borrow another item's packet or
re-size solely to mint authority. The source owner and coordinator must resolve
legitimate scope/shape classification or obtain an actual eligible independent
route for this privileged impact, preserving author/reviewer separation. The
current generic/architecture policy critique is evidence, not that formal role
or changed-policy authority. DI-94DF1EA45BD5 remains unresolved.

The three minor findings are separately dispositioned: workflow concurrency
fallback has no reported functional defect and is unchanged; a shared typed
failure-code contract is required before producer wiring; a structured PID
registry field would extend the existing registry schema and is not silently
added here. Compose and the runtime qualifier still enforce 256 PIDs.
