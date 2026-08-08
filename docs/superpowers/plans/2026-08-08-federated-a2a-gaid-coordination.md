# Federated A2A Coordination with GAID — Implementation Plan

**Date:** 2026-08-08  
**Status:** Ready for a build thread; no implementation started  
**Backlog item:** `BI-BE0E14E0`  
**Epic:** `EP-MSP-FEDERATION`  
**Design WorkCapsule:** `WC-647895E9`  
**Design:** [`docs/superpowers/specs/2026-08-08-federated-a2a-gaid-coordination-design.md`](../specs/2026-08-08-federated-a2a-gaid-coordination-design.md)  
**Kernel decision:** `DI-B726A1900E7C`  
**Backlog coverage receipt:** `cmskls1vz03qi01mu59s9tn3o` (`atomic`)

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## 1. Outcome

Deliver one feature-gated, same-organization A2A loop between two already trusted sovereign DPF installations. The loop discovers a projected coworker, proves the source install/device and speaking GAID, creates a receiver-owned task, exchanges additional input/status/artifacts, enforces local TAK and data boundaries, and exposes readable provenance to operators.

The release is successful only when the organization's production and development installations complete the happy path through the canonical runtime while cross-org, wrong-link, wrong-device, stale-card, and guessed-task paths remain denied.

## 2. Delivery boundary

This plan is **atomic at product-release level** even though it has internal phases. None is independently safe or useful to enable:

- device pinning without issuer/card/task enforcement is unused security metadata;
- card projection without authenticated task ingress leaks discovery without delivering coordination;
- task ingress without device/GAID binding recreates the vulnerability this slice exists to close;
- UI before end-to-end enforcement can imply readiness that does not exist;
- cross-org enablement is explicitly excluded and will require its own future BI.

Every phase stays behind `FederationLink` A2A readiness/capability negotiation. The single BI remains correct because the only shippable outcome is the composed same-org vertical slice. The live coverage receipt in §3 is mandatory before implementation.

## Backlog coverage

Live coverage was recorded against parent `BI-BE0E14E0` for this exact plan path.

- Decision: atomic
- Parent: `BI-BE0E14E0`
- Receipt: `cmskls1vz03qi01mu59s9tn3o`
- Dependencies: `BI-COWORKER-360-AGENTCARD` coordination; all delivery phases remain internal to the parent BI
- Mapped child BIs: none; all phases are internal sequencing under `BI-BE0E14E0`
- Rationale: the security property exists only as the composed same-organization vertical slice. Device pinning, GAID issuer/card projection, task ingress/ownership, policy, and operator readiness are mutually dependent and stay feature-gated until end-to-end acceptance. Shipping any phase alone either exposes unusable metadata/UI or creates the unauthenticated or under-authorized boundary the BI is meant to eliminate. Cross-organization enablement is excluded and will require a separate future BI.

| Deliverable | Independently shippable | Depends on | Live BI mapping |
| --- | --- | --- | --- |
| Phase 0 — red contracts | no | — | `BI-BE0E14E0` atomic scope |
| Phase 1 — schema convergence | no | Phase 0 | `BI-BE0E14E0` atomic scope |
| Phase 2 — device binding | no | Phase 1 | `BI-BE0E14E0` atomic scope |
| Phase 3 — GAID/cards | no | Phase 2 | `BI-BE0E14E0` atomic scope |
| Phase 4 — task path | no | Phases 1–3 | `BI-BE0E14E0` atomic scope |
| Phase 5 — policy/evidence | no | Phase 4 | `BI-BE0E14E0` atomic scope |
| Phase 6 — operator UX | no | Phases 2–5 | `BI-BE0E14E0` atomic scope |
| Phase 7 — acceptance/handoff | no | Phase 6 | `BI-BE0E14E0` atomic scope |

## 4. Non-negotiable invariants

1. Reuse GAID/AIDoc and `Principal`/`PrincipalAlias`; no new identity format or remote-agent table.
2. Reuse `FederationLink`, mutual tokens, installation/device identity, CloudEvents, `ProjectionContract`, and `FederatedRecordMirror`; no parallel transport.
3. Treat organization, environment/install, device, and GAID as separate dimensions.
4. Authenticate the link and device before resolving any agent claim.
5. Treat the remote claim/card as evidence only; the receiver's TAK/delegation/offer/consent policy remains final.
6. Use `TaskRun`/`TaskMessage`/`TaskArtifact` for task lifecycle/history and `CoworkerEngagement` for the accepted service relationship.
7. Same-org is the only enabled preset; cross-org stays deny-by-default.
8. All migrations are forward-only and tolerate arbitrary existing data.
9. The canonical runtime is the only runtime truth; worktree tests are source-local evidence only.

## 5. Phase 0 — Claim, preflight, and red contract tests

**Delivery:** internal sequencing; not independently shippable.  
**Dependencies:** live coverage receipt in §3; fresh worktree from `main`; a claimed WorkCapsule for `BI-BE0E14E0`.

### Tasks

1. Start a new isolated worktree/branch for `BI-BE0E14E0`; fetch `origin/main`, confirm compile readiness, and claim the WorkCapsule through DPF MCP.
2. Run `dpf-verify-substrate-first` again against current `main`; stop if another branch has changed GAID, TaskRun, FederationLink, environment, Agent Card, or A2A contracts.
3. Use `dpf-tdd` and add failing contract tests before production changes:
   - `packages/db/src/federation-link-types.test.ts` — A2A readiness requires trusted link, pinned device, approved issuer binding, and same-org relationship;
   - `packages/db/src/federated-record-sync.test.ts` — `agent-card` mirror create/update/withdraw/revoke semantics;
   - a new `packages/db/src/federated-a2a-contract.test.ts` — closed event types, A2A version, GAID context, environment registry, size/idempotency validation;
   - `apps/web/lib/federation/cloud-event-guard.test.ts` — signed A2A events fail without the new security context;
   - `apps/web/lib/coworker-service-catalog/a2a-tasks.test.ts` — cross-link task isolation and canonical TaskRun mapping;
   - API route tests for wrong/missing token, device signature, issuer binding, GAID card, task ownership, and cross-org denial.
4. Capture the expected request/response fixtures under the existing test modules; never place tokens or private keys in committed fixtures.

### Verification

- Run the selected tests and record the intended red failures, proving each test fails because behavior is absent rather than because fixtures or imports are broken.
- Confirm no production file changed in this phase except test fixtures/helpers needed to express the contract.

## 6. Phase 1 — Schema and canonical-contract convergence

**Delivery:** internal sequencing; feature remains disabled.  
**Dependencies:** Phase 0 red tests.

### Files

- `packages/db/prisma/schema.prisma`
- one new forward-only migration under `packages/db/prisma/migrations/`
- `packages/db/src/federation-link-types.ts` and test
- `packages/db/src/federated-record-sync.ts` and test
- new `packages/db/src/federated-a2a-contract.ts` and test
- `packages/db/src/founder-shared-portfolio.ts` and test
- `packages/db/src/index.ts`
- a new data-impact record under `docs/data-impact/`

### Tasks

1. Add a Prisma enum for the existing federation environment vocabulary: `production`, `development`, `test`. Export the generated TypeScript registry once; all federation demand and A2A consumers import it.
2. Promote `environmentClass` from `FederationLink.metadata` to the typed link field. Backfill valid values; map missing/invalid legacy values to the current safe `development` fallback. Dual-read during rollout, then remove the metadata write path in the same PR.
3. Add link-owned peer-device fields to `FederationLink`: device ID, Ed25519 public key, pin timestamp, and rotation timestamp. Keep them nullable so demand-only legacy links remain valid.
4. Extend the existing federation record-type registry with `agent-card` and the smallest required withdrawal/key-attestation type. Do not add a parallel mirror table.
5. Converge task initiation and storage:
   - add nullable `TaskRun.initiatingPrincipalId` relation to `Principal`;
   - backfill it from existing user principal aliases where a canonical mapping exists;
   - make `TaskRun.userId` nullable only after existing read paths are audited and the migration remains safe for rows without a principal mapping;
   - add nullable typed/indexed `TaskRun` fields for federation link ownership, origin event ID, acting/delegating/target GAIDs, origin installation/environment, card/AIDoc digests, and verification receipt reference;
   - add unique idempotency on `(federationLinkId, originEventId)` when both are present;
   - add nullable unique `CoworkerEngagement.taskRunId` relation.
6. Keep `a2aMetadata` for non-authoritative protocol extensions only; new authorization and uniqueness checks must use typed columns.
7. Make every migration data-state agnostic: no assumption that every User already has a Principal, every link already has metadata, or every engagement already has a task.

### Verification

- Prisma schema validation and generated client/type checks pass.
- Migration applies to a clean database and an upgrade fixture containing: missing link metadata, invalid metadata, demand-only trusted link, task without principal mapping, and legacy engagement-backed A2A task.
- Registry and pure-contract unit tests pass.
- Existing federated-demand environment tests remain green.

## 7. Phase 2 — Complete the federation device trust binding

**Delivery:** internal sequencing; A2A readiness can be observed but not enabled.  
**Dependencies:** Phase 1 schema.

### Files

- `apps/web/lib/federation/instance-identity.ts` and test
- `apps/web/lib/federation/demand-identity.ts` and test
- `apps/web/lib/federation/sas-pairing.ts` and test
- `apps/web/lib/federation/enrollment.ts` and mutual-token tests
- `apps/web/lib/federation/nearby-pairing-service.ts` and test
- `apps/web/lib/federation/wire-contract.ts`
- `apps/web/lib/auth/federation-link-token.ts`
- new `apps/web/lib/federation/message-signature.ts` and test

### Tasks

1. Extend enrollment/pairing messages to exchange `inst_…`, `did_…`, and Ed25519 public key inside the authenticated/approved transcript.
2. Verify `deriveDeviceId(publicKey) === deviceId` before persistence. Include both installation IDs and both device IDs in the SAS transcript.
3. Require explicit dual approval for first pin and every rotation; do not overwrite a pinned key in response to ordinary traffic.
4. Implement RFC 9421 signing and verification with Node's existing crypto primitives:
   - Ed25519 only for v1;
   - cover method, target URI/authority, content type, `Content-Digest`, A2A/federation version headers, creation/expiry, nonce, and key ID;
   - strict algorithm/key-ID matching and bounded clock/replay windows;
   - sign both directions.
5. Derive A2A readiness from existing link lifecycle plus pinned device and issuer binding. Keep demand readiness independent.
6. Snapshot the verified public key/fingerprint and signature evidence in immutable verification receipts so historical proof survives key rotation.

### Verification

- Unit vectors prove signing success and failure for body mutation, header mutation, wrong path, wrong device, expired signature, replayed nonce, and old key after cutover.
- Pairing/enrollment tests prove no silent token-only downgrade and no unapproved key replacement.
- Existing mutual-token demand exchange tests remain green.

## 8. Phase 3 — GAID issuer conformance and link-scoped Agent Cards

**Delivery:** internal sequencing; discovery is feature-gated.  
**Dependencies:** Phase 2 device pinning; coordination with `BI-COWORKER-360-AGENTCARD`.

### Files

- `apps/web/lib/identity/principal-linking.ts` and test
- `apps/web/lib/identity/aidoc-resolver.ts` and test
- `apps/web/lib/tak/agent-card-types.ts`
- `apps/web/lib/tak/agent-card-service.ts` and test
- `apps/web/lib/coworker-service-catalog/agent-card.ts` and test
- `apps/web/lib/coworker-service-catalog/gaid-authority.ts` and test
- `apps/web/lib/federation/exchange-handlers.ts` and test
- `apps/web/lib/federation/cross-org-sharing.ts` and test
- `packages/db/src/federated-record-sync.ts`

### Tasks

1. Replace federation advertisement of `gaid:priv:dpf.internal:*` with a GAID-standard-conformant issuer namespace configuration. Preserve legacy GAID aliases for local lookup/history; do not infer identity continuity from matching `agentId` strings.
2. Represent approved peer GAID issuer namespaces through the link's existing `AuthorityBinding`; validate that every advertised GAID belongs to an approved prefix.
3. Produce standard A2A v1.0 Agent Cards from the canonical CoworkerIdentity/AIDoc projection. Reuse the existing card builder; do not fork card construction inside federation.
4. Add the GAID A2A extension metadata, AIDoc reference/digest, exact service-offer capability, and authenticated federation interface.
5. Canonicalize cards with RFC 8785 and JWS-sign them using the pinned device key. Separately validate AIDoc issuer status/binding; device possession is not issuer authority.
6. Project only explicitly allowed cards through `ProjectionContract`, persist them as link-scoped `FederatedRecordMirror` rows, and implement expiry, refresh, withdrawal, revocation, and key-rotation invalidation.
7. Keep the public/minimal well-known card non-enumerating. Remote coworker discovery uses authenticated extended cards/curated link catalog.

### Verification

- Card schema/version/signature fixtures validate with the pinned A2A version.
- Negative tests cover unapproved issuer, GAID/card mismatch, stale AIDoc, withdrawn card, wrong link, wrong key, unprojected offer, and forbidden card fields.
- A legacy local GAID still resolves internally but is not advertised as federated assurance.

## 9. Phase 4 — Federation A2A ingress, task service, and lifecycle adapter

**Delivery:** internal sequencing until Phase 6 UI and Phase 7 live acceptance.  
**Dependencies:** Phases 1–3.

### Files

- new `apps/web/app/api/v1/federation/a2a/route.ts` and test
- new modules under `apps/web/lib/federation/` for A2A exchange/delivery, following `demand-exchange.ts` and `demand-delivery.ts`
- `apps/web/lib/federation/cloud-event-guard.ts` and test
- `apps/web/lib/federation/client.ts` and test
- `apps/web/lib/federation/outbound.ts`
- `apps/web/lib/coworker-service-catalog/a2a-tasks.ts` and test
- `apps/web/lib/coworker-service-catalog/engagements.ts` and test
- `apps/web/lib/tak/task-records.ts` and test
- `apps/web/lib/tak/collaboration-authority.ts` and test
- `apps/web/app/api/a2a/coworkers/[agentId]/offers/[offerId]/route.ts` and test
- `apps/web/app/api/a2a/tasks/[taskId]/route.ts` and test

### Tasks

1. Add the versioned DPF federation A2A contract as A2A payload + GAID extension inside the existing CloudEvents transport.
2. Implement the fixed ingress chain from the spec: link token → device signature/digest → replay/idempotency → link installation/org/environment → issuer/card/AIDoc → target GAID → TAK/delegation/offer/projection/consent → task.
3. Make the receiver generate `TaskRun.taskRunId`; create/link `CoworkerEngagement` for the accepted offer and persist messages/artifacts through `TaskMessage`/`TaskArtifact`.
4. Implement non-streaming A2A v1.0 operation semantics needed by the slice: send message/create or continue task, get/list task, additional input, cancel, and retrieve artifact/task snapshot.
5. Scope every operation by the stored `FederationLink` and verified agent context. A task ID is never sufficient authorization.
6. Implement durable outbox retry/dead-letter and exact-duplicate idempotency using existing federation delivery patterns. Preserve loop/hop guards and trace context.
7. Convert the current `/api/a2a/*` cross-boundary paths into internal compatibility adapters to the canonical task service. External/partner requests must go through `/api/v1/federation/*`; remove unauthenticated cross-boundary retrieval.
8. Stop using the local HMAC delegation receipt as sovereign-peer proof. Keep it for legacy local flows; federated receipts use verified device/link evidence.
9. Label the surface accurately: do not claim a custom A2A binding unless every standard core operation and mapping requirement is met.

### Verification

- Contract/unit/API tests cover every operation and lifecycle transition, including terminal immutability and input/auth-required behavior.
- Security tests prove token-only, signature-only, wrong-link task reads, task enumeration, body mutation, replay, cross-org, unprojected target, and over-classification all fail.
- Concurrency test proves two identical creates yield one canonical task; conflicting same-key payloads fail.
- Existing internal A2A and federated-demand tests remain green.

## 10. Phase 5 — Policy, receipts, observability, and operational controls

**Delivery:** internal sequencing.  
**Dependencies:** Phase 4 task path.

### Files

- `apps/web/lib/federation/cross-org-sharing.ts` and test
- `apps/web/lib/security/federation-projection.ts` and test
- `apps/web/lib/work-management/federation-governance.ts` and test
- existing federation demand activity/observability modules where shared
- `apps/web/lib/ai-operations-map/project-a2a-interactions.ts` and tests
- `apps/web/lib/operate/a2a-collaboration-health/*` and tests

### Tasks

1. Add same-org A2A policy to the existing relationship/projection resolver. Keep every cross-org path explicitly false unless a later BI supplies the full cross-org contract.
2. Enforce per-link and per-GAID request size, rate, concurrency, task TTL, retention, and artifact classification limits.
3. Persist immutable verification/authority receipts with link/device/install/GAIDs/org/environment/card/AIDoc/event/task/decision/trace evidence; never persist tokens, private keys, raw prompts, or unminimized payloads.
4. Add bounded-cardinality metrics and structured failure categories; keep raw GAIDs out of metric labels.
5. Project the cross-install task into the existing A2A interaction/operations map without creating a new observability graph.
6. Quarantine-worthy failures surface through existing link controls; no automatic destructive response.

### Verification

- Negative egress tests cover prompts, memory, secrets, internal grants, restricted/confidential data, and verbose errors.
- Health/operations-map tests show accepted and denied coordination with the right provenance and no duplicate events.
- Link revoke/quarantine mid-task blocks new peer operations while preserving local audit/history.

## 11. Phase 6 — Operator UX and accessibility

**Delivery:** completes the user-visible vertical slice but remains feature-gated until Phase 7.  
**Dependencies:** Phases 2–5 read models.

### Files

- `apps/web/components/platform/federation-links/FederationLinksAdminClient.tsx` and test
- `apps/web/app/(shell)/platform/federation-links/page.tsx`
- `apps/web/components/platform/coworker-service-catalog/CoworkerCatalogView.tsx` and test
- existing engagement/task and A2A interaction timeline components, including `apps/web/components/platform/a2a-interaction-graph.ts` where appropriate
- shared form/status/disclosure primitives only; no new page shell or card system

### Tasks

1. Add one progressive-disclosure “Agent coordination” section to the federation-link detail: readiness, org, environment, install, short device ID, key/card status, last verified event/failure, projection/authority links, and dual-approved pin/rotation action.
2. Add projected remote coworkers to the existing service catalog with peer, environment, verification, freshness, offered outcome, risk, and data-boundary information.
3. Add a consequence-first dispatch confirmation showing both agents, both environments/installations, data classes, write/advisory posture, approval boundary, and retention.
4. Show task messages, lifecycle, artifacts, and verification receipts on the existing timeline/interaction surface. Default view is plain language; raw identifiers and proof details sit behind disclosure.
5. Use shared components, generated design tokens, `--dpf-*` colors, semantic headings, text status (not color alone), visible focus, ≥44px targets, accessible names, keyboard operation, reduced motion, and responsive narrow layouts.
6. Make failure states actionable: needs device confirmation, issuer unverified, card expired, link quarantined, and cross-org not enabled each name one safe next step.

### Verification

- Component tests cover readiness states, provenance ordering, confirmation consequence copy, failures, and hidden technical detail.
- Axe and semantic/ARIA snapshots have no new violations.
- Visual verification covers light/dark themes, organization branding, desktop/narrow viewport, keyboard-only operation, reduced motion, loading, empty, stale, error, and success states.

## 12. Phase 7 — Completion gate and canonical-runtime acceptance

**Delivery:** the only independently releasable outcome: complete same-org A2A slice.  
**Dependencies:** all prior phases.

### Source-local gate

1. Run affected Vitest suites for `packages/db` and `apps/web`.
2. Run Prisma validation/generation and apply the migration to clean and representative upgrade fixtures.
3. Run the production web build with zero errors.
4. Run style/token, route-contract, and documentation checks affected by the UI/routes.
5. Run a regression suite proving federated demand still exchanges when A2A is off and when A2A verification fails.

### Canonical-runtime gate

1. Use `dpf-use-shared-nonprod-environment`; claim the governed environment lease before runtime-bound checks.
2. Advance the canonical nonproduction install only through the governed install/self-upgrade path. Do not rebuild the live portal from the worktree.
3. Pair or upgrade the two designated same-org test installs and explicitly approve device pins/issuer bindings.
4. Exercise the happy path:
   - discover one projected remote coworker;
   - inspect verified GAID/AIDoc and environment/install provenance;
   - submit a bounded task;
   - receive `working` and `input-required`, send additional input, receive a minimized artifact, and reach `completed`;
   - retrieve the task from the initiating install and inspect the receipt/timeline.
5. Exercise negative paths live: wrong/rotated device key, stale card, unprojected GAID, cross-org preset, task ID from another link, revoked link, and development-to-production consequential action without local approval.
6. Run the UX fit review against the live portal. Capture screenshots/evidence links through the governed verification record.
7. Complete independent semantic review of the stable committed tree, local merged-code CI, DCO-signed commit, push, ready PR, and merge-queue handoff.

### Definition of done

- All eight BI acceptance criteria pass with recorded evidence.
- Unit, production build, migration, UX, and final-acceptance evidence is attached to `BI-BE0E14E0`/its WorkCapsule.
- Cross-org remains disabled and negative-tested.
- Documentation in §13 is current.
- `pnpm pr:health <PR>` reports merge-ready; no visual-scan substitution.

## 13. Documentation updates in the implementation PR

- `docs/architecture/GAID.md` — implementation/conformance note for issuer configuration, device-bound HTTP claims, and legacy alias migration; do not duplicate the standard's normative rules.
- federation architecture/orientation and pairing operator docs — A2A readiness, device pinning/rotation, capability negotiation, and failure recovery.
- API/contract docs — A2A version, extension URI, event/operation mapping, error taxonomy, and conformance label.
- service-catalog/coworker help — remote provenance, data boundary, and task ownership.
- route map if endpoints change.
- `docs/install/platform-support-watchlist.md` only if Windows/macOS/Linux crypto or key-store behavior differs.

## 14. Risks and mitigations

| Risk | Blast radius | Mitigation |
| --- | --- | --- |
| TaskRun principal convergence breaks existing task creators | every coworker/build/task producer | nullable additive migration, exhaustive call-site grep, backfill, dual-read tests, no fabricated users |
| Environment migration changes demand classification | founder shared portfolio and production eligibility | reuse existing values/default, backfill fixtures, demand regression tests, no new vocabulary |
| Device signing breaks current demand links | all sovereign-peer traffic | separate `demand-ready` from `a2a-ready`; no requirement for signatures on legacy demand until its own governed migration |
| GAID alias migration fragments history | identity, receipts, links | retain legacy aliases, canonical alias mapping, no rename-by-agentId, issuer/status tests |
| Card projection leaks coworker internals | org/customer privacy | authenticated extended cards, explicit field allowlist, forbidden-field negative tests |
| Task ID enumeration exposes remote work | cross-link confidentiality | typed link ownership on every read/list/cancel/add-input path; non-enumerating errors |
| Key rotation destroys historic proof | audit/nonrepudiation | immutable receipt snapshots of verified public key/fingerprint and local acceptance decision |
| “A2A compliant” overclaim | interoperability and trust | conformance tests; label DPF profile accurately unless all core requirements pass |
| UI collapses identity dimensions | operator error between prod/dev | fixed org → environment/install → GAID hierarchy; accessible text labels and consequence confirmation |

## 15. Rollback and recovery

1. Disable A2A capability per link; do not revoke the federation link unless the relationship itself is compromised. Federated demand continues.
2. Stop A2A outbox delivery and preserve pending/dead-letter events for inspection; never replay after re-enable without current card/link validation.
3. Keep additive schema fields and backfilled environment data. Rollback application code by deployment; forward-fix migrations rather than reversing committed migrations.
4. Preserve TaskRun/engagement/message/artifact and verification receipts. Disable remote mutation while allowing authorized local read/audit.
5. If a key is suspect, quarantine the link, rotate through dual approval, invalidate current card bindings, and require reprojection before A2A readiness returns.
6. If GAID issuer binding is wrong, withdraw affected cards and block new tasks; preserve aliases/history while correcting the canonical issuer mapping.
7. Recovery is complete only after demand regression, A2A negative tests, and one fresh signed same-org task pass on the canonical runtime.
