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

## Current execution state

Normal DESIGN claim IRD-E221F1E15860, research receipt initiative-298af8bc-7bcc-4af7-b485-31012038badb, PLAN claim IRD-5EFD36EAEE68 and implementation projection IRD-C42D0694BC96 were admitted. Admission is not approval of the unqualified renderer design. Managed dependency bootstrap now reports compile-ready; no unit/type/runtime gate is claimed. Exact source scopes and test-impact requirements are recorded. Funding attribution for this Workroom item requires owner approval; no spend or allocation is inferred. Production capture remains unavailable, and no previously refused capture was attempted through another transport.
