# Federated A2A Coordination with GAID — Decomposed Implementation Plan

**Date:** 2026-08-08

**Status:** Governed implementation scope with execution-surface parity; ready to execute one slice at a time

**Umbrella backlog item:** `BI-BE0E14E0` under `EP-MSP-FEDERATION`

**Design:** [`docs/superpowers/specs/2026-08-08-federated-a2a-gaid-coordination-design.md`](../specs/2026-08-08-federated-a2a-gaid-coordination-design.md)

**GAID-binding decision:** `DI-B726A1900E7C`

**Enterprise identity-boundary decision:** `DI-6FE234A7399E`

**Decomposition decision:** `DI-61395D1B7A6D`

**Execution-surface decision:** `DI-0171FE184F71`

**MCP standards correction:** `DI-1C305D329ECE`; [MCP 2026-07-28 migration plan](2026-08-08-mcp-2026-07-28-stateless-tasks-migration.md)

**Planning WorkCapsule:** `WC-7528A06C`

**Backlog coverage receipt:** `cmsl168wl01ig01qq5utrc8gu` (`decomposed`; MCP 2026 dependency refresh)

> **For build threads:** claim exactly one mapped BI, use one worktree/branch/PR, run `dpf-verify-substrate-first` again against current `origin/main`, and keep `DPF_FEDERATION_A2A_ENABLED` off unless the slice explicitly owns activation. Use `dpf-tdd`, the local merged-code CI gate, independent semantic review, and the DPF DCO PR path.

## 1. Outcome

Deliver a feature-gated, same-organization A2A loop between two already trusted sovereign DPF installations. The loop discovers a projected coworker, proves both the source installation/device and the speaking GAID, creates a receiver-owned task, exchanges additional input/status/artifacts, applies receiver-local TAK and data boundaries, and presents readable provenance to operators.

The same outcome must be operable from a governed external MCP client such as Codex/Claude/Grok,
an embedded Build Studio agent, and an in-platform AI coworker. These are thin local entry adapters:
all three resolve canonical Principal/GAID context and call one A2A coordination service, which
alone emits federation traffic and returns one `TaskRun`/receipt lineage.

The implementation also establishes the enterprise identity-boundary contract needed before any
future cross-org activation: complete source-side custody of every materially participating agent,
public-only external GAID projection, and a signed privacy-preserving commitment when internal
participation is withheld. Cross-org execution remains disabled in this plan.

The release is complete only when the organization's designated production and development
installations pass the canonical-runtime happy path while wrong-link, wrong-device, stale-card,
guessed-task, and cross-organization paths remain denied. Concrete installation names remain in
install-local acceptance evidence, not the public specification.

## 2. Scope decision

The original plan treated the complete vertical slice as one atomic BI. The 2026-08-08 follow-up review found six independently reviewable seams already reflected in the substrate: GAID identity, federation device authentication, Agent Card discovery, canonical task ingress, authority/evidence, and operator readiness.

`principle_decide` selected **decomposed convergence** with high confidence:

| Option | Composite | Result |
| --- | ---: | --- |
| Decomposed convergence behind disabled capability gates | **15.417** | selected |
| One release-sized atomic BI | 4.197 | rejected |
| Parallel install-specific programs reconciled later | 1.556 | rejected |

Decision ledger: `DI-61395D1B7A6D`; margin `11.220`; strong structured coverage; no commandment conflict. The strongest positive pulls were Research and Use Standards, Ship Real Functionality, Ground New Work in Existing Platform, Single Source of Truth, and one concern per PR. This supersedes the earlier atomic coverage decision for implementation planning; it does not change the reviewed GAID-binding decision.

The execution-surface follow-up compared adding parity to the existing slices, creating a seventh
adapter slice, and creating one implementation per surface. `principle_decide` selected the
existing-slices option with high confidence: `DI-0171FE184F71`, composite `6.589`, margin `1.228`,
strong structured coverage, and no commandment conflict. S3 owns discovery, S4 owns the service and
task adapters, S5 owns authorization/privacy equivalence, and S6 owns human-facing projections.
No additional BI is needed.

## 3. BI parity and sovereignty boundary

BI synchronization between the two installations is an operational coordination prerequisite, not part of the A2A protocol and not a new transport.

Before every slice:

1. Query the live backlog through DPF MCP on the install doing the work.
2. Inspect the synchronized peer view/crosswalk when it is available.
3. Match work using the sync substrate's install-qualified provenance, title/scope, and explicit counterpart reference; never assume a bare `BI-…` value is globally unique.
4. If a peer item already owns the same deliverable, reuse or coordinate it instead of filing another local copy.
5. Keep each install's `BacklogItem` locally authoritative. A remote item is a mirror/coordination reference unless the governed sync contract explicitly adopts it locally.

Current evidence on the MSP-federation install still does not expose `EP-E1F1DB58` or its slice BIs. The reviewed peer-install snapshot remains valid, but this plan does not claim that parity has completed. A future synced view must converge the references below without turning either backlog into a multi-writer replica.

This boundary preserves the existing federation rule: raw `BacklogItem` is not the demand/A2A wire contract, and A2A coordinates agents after work identity and authority have been resolved.

## Backlog coverage

Live coverage was recorded against umbrella `BI-BE0E14E0` for this exact plan path.

- Decision: `decomposed`
- Receipt: `cmsl168wl01ig01qq5utrc8gu`
- Independently shippable mappings: six live sibling BIs under `EP-MSP-FEDERATION`
- Sequencing-only gates: parity/overlap preflight and final two-install umbrella acceptance

| Key | Deliverable | Live BI | Depends on | Ship/merge posture |
| --- | --- | --- | --- | --- |
| P0 | BI parity, overlap, and substrate preflight | umbrella coordination | — | no implementation |
| S1 | GAID issuer namespace and identity continuity | `BI-F51DC0D3` | P0 | independent correctness slice |
| S2 | Peer-device pinning and signed federation events | `BI-51FA49EB` | P0 | independent, A2A disabled |
| S3 | Signed GAID Agent Cards and remote discovery | `BI-B280E853` | S1, S2 | independent, discovery gated |
| S4 | Federated A2A task ingress over `TaskRun` | `BI-90E338D8` | S1–S3; MCP entry also requires `BI-B6F8BFF4` | independent, ingress disabled |
| S5 | Local authority, privacy, receipts, and operations | `BI-0E61A6A7` | S2, S4 | independent safety/readiness slice |
| S6 | Operator readiness UX and activation controls | `BI-68AF8D86` | S3, S5 | independent UI slice |
| A | Canonical-runtime two-install acceptance | umbrella closeout | S1–S6 | not a separate product deliverable |

Cross-install reuse/coordination references:

- `BI-06B66FFD` / PR #4119: historical 2025 Tasks projection over canonical `TaskRun`; useful substrate, but not current-standard completion.
- `BI-B6F8BFF4`: official MCP 2026-07-28 Tasks extension over canonical `TaskRun`; hard dependency for S4's external MCP entry adapter. It owns MCP wire migration while S4 owns the A2A application/federation service.
- `BI-40648BBF`: existing A2A Agent Card exporter; S3 extends its builder.
- `BI-5FB59BC6` / PR #4121: shipped `find_coworker`; S3 adds its link-scoped federated result source.
- `BI-COWORKER-360-AGENTCARD`: current-install whole-coworker Agent Card/read-model coordination seam.

## 4. Non-negotiable invariants

1. GAID/AIDoc plus `Principal`/`PrincipalAlias` remains the only agent-identity source of truth.
2. `FederationLink`, mutual tokens, installation/device identity, CloudEvents, `ProjectionContract`, and `FederatedRecordMirror` remain the only cross-install trust, transport, disclosure, and mirror substrate.
3. Organization, environment/install, device, and GAID remain distinct dimensions.
4. The receiver authenticates link and device before resolving any GAID claim.
5. A remote card/claim is evidence only; receiver-local TAK, offer, delegation, consent, and tool-grant intersection remain authoritative.
6. `TaskRun`/`TaskNode`/`TaskNodeEdge` own execution topology,
   `TaskMessage`/`TaskArtifact` own history/results, and `CoworkerEngagement` owns the accepted
   service/authority context; no participation-graph table is added.
7. Same-org is the only enabled preset; cross-org stays deny-by-default.
8. Every migration is forward-only and tolerates arbitrary existing data.
9. Demand federation remains usable when A2A is disabled, unready, quarantined, or failing.
10. The canonical runtime is the only runtime truth.
11. Complete source-side participation custody and peer-visible identity disclosure are different
    views; preserving every agent never authorizes exposing every agent.
12. Cross-org egress contains only governed `gaid:pub` aliases, never private GAIDs, hidden
    topology, internal Principal/install/device IDs, or source-local graph references.
13. One canonical projection service feeds cards, events, tasks, artifacts, receipts, errors, and
    peer-visible operations; route-local redaction is forbidden.
14. Minimized participation is explicit and bound to the protected graph by a signed,
    nonce-hiding commitment that can be opened only through authorized audit.
15. External MCP clients, Build Studio, and in-platform coworkers resolve through one canonical
    caller/GAID and A2A service contract; surface provenance is evidence, never identity or
    authority.
16. A caller-supplied GAID is not trusted. A surface without a governed Agent Principal/GAID or an
    explicit authorized delegation is denied before federation egress.

## 5. P0 — Parity, overlap, and build preflight

**Delivery:** sequencing-only under `BI-BE0E14E0`; no production code.

1. Query the live local BI, its epic, all six child BIs, and synchronized peer references.
2. Sweep open PRs, active WorkCapsules, code graph, `origin/main`, and the other install's mirrored work before claiming a slice.
3. Record an explicit counterpart/alias when synchronized work matches one of the peer BIs; do not copy a peer-local identifier into local authority without the sync contract.
4. Re-check A2A v1.0 core, enterprise, multi-tenancy, Agent Card, and extension guidance; MCP Tasks
   direction; CloudEvents 1.0; RFC 9421; RFC 9530; and RFC 8785 if implementation begins after a
   standards revision. Confirm whether upstream A2A has since standardized agent-subject identity,
   private/public boundary mapping, participation graphs, or selective-disclosure commitments
   before changing the DPF GAID extension.
5. Verify worktree readiness. A source-only worktree may author/review docs, but an implementation thread must become compile-ready before claiming source-local gates.
6. Claim only the selected slice BI and refresh its plan coverage/context before code.

**Stop conditions:** unresolved duplicate ownership, a changed canonical contract, a missing live BI, a commandment conflict, or a federation/BI-sync change that makes the install-authority boundary ambiguous.

## 6. S1 — GAID issuer namespace and identity continuity

**BI:** `BI-F51DC0D3`

**Delivery:** independent identity-conformance PR; no federation route changes.

### Expected files

- `apps/web/lib/identity/principal-linking.ts` and tests
- `apps/web/lib/identity/aidoc-resolver.ts` and tests
- canonical issuer configuration/type owner selected after the preflight
- one forward-only alias/backfill migration if live data requires it
- `docs/architecture/GAID.md` implementation note, only if the implementation contract is not already stated

### Tasks

1. Add red tests for cross-install collision, legacy alias lookup, explicit continuity, and the current `priv` versus `private` scope-token split.
2. Replace federation advertisement of `gaid:priv:dpf.internal:*` with a governed stable issuer namespace while preserving legacy aliases for local resolution.
3. Preserve a canonical GAID across installs only when a governed continuity record proves the same enduring subject; matching `agentId` or configuration is insufficient.
4. Keep all identity resolution on `Principal` + `PrincipalAlias`; do not add an `Agent.gaid` column or remote-agent table.
5. Model private and public GAIDs for one enduring agent as governed aliases of the same Principal;
   keep issuer on the alias, status in the canonical Principal/AIDoc lifecycle, and mapping proof
   in the existing protected receipt/evidence substrate with authorized audit visibility. Do not
   turn `PrincipalAlias` into a provenance store or invent an ephemeral NAT-style identifier.
6. Deny cross-org projection when a required public alias is absent; never expose the private GAID
   as fallback.
7. Verify AIDoc resolution and every current local caller continue to work.

### Done

Distinct subjects cannot collide, continuity is evidence-backed, legacy aliases resolve locally,
private/public mappings resolve to one Principal, and no non-conformant private GAID is advertised
as federated assurance or leaked when public mapping is absent.

## 7. S2 — Peer-device pinning and signed federation events

**BI:** `BI-51FA49EB`

**Delivery:** independent security-foundation PR; `DPF_FEDERATION_A2A_ENABLED` remains off.

### Expected files

- `packages/db/prisma/schema.prisma` plus one forward-only migration and data-impact record
- `packages/db/src/federation-link-types.ts` and tests
- `apps/web/lib/federation/instance-identity.ts`, `demand-identity.ts`, `sas-pairing.ts`, `enrollment.ts`, and tests
- `apps/web/lib/federation/cloud-event-guard.ts` and tests
- new `apps/web/lib/federation/message-signature.ts` and tests

### Tasks

1. Promote the existing production/development/test federation environment vocabulary from metadata to its typed canonical field with a data-state-safe backfill and bounded compatibility read.
2. Add nullable link-owned peer device ID, Ed25519 public key, pin time, and rotation time; legacy demand links remain valid but A2A-not-ready.
3. Exchange and verify `inst_…`, `did_…`, and public key in the enrollment/SAS transcript. Require `deriveDeviceId(publicKey) === deviceId`.
4. Require explicit dual approval for first pin and rotation; ordinary traffic cannot replace a key.
5. Implement RFC 9421 Ed25519 signing/verification and RFC 9530 `Content-Digest` over method, target/authority, content type, federation/A2A versions, creation/expiry, nonce, key ID, and body.
6. Reuse the existing CloudEvent `dpflinkid` binding and ±15-minute replay window; do not add another envelope guard.
7. Derive independent `demand-ready` and `a2a-ready` states and preserve immutable verification evidence across key rotation.

### Done

Mutation, wrong path/link/device, expired signature, nonce replay, unapproved rotation, and token-only downgrade fail; existing mutual-token demand exchange remains green.

## 8. S3 — Signed GAID Agent Cards and federated discovery

**BI:** `BI-B280E853`

**Delivery:** independent projection/discovery PR; remote discovery remains capability-gated.

### Expected files

- `apps/web/lib/a2a/agent-card.ts` and tests
- canonical TAK/coworker Agent Card and AIDoc projection modules
- `apps/web/lib/mcp/packs/coworker-pack.ts` and discovery tests
- federation exchange/projection handlers
- `packages/db/src/federated-record-sync.ts` and tests

### Tasks

1. Upgrade the existing unsigned A2A v0.3.0/no-GAID exporter to the reviewed v1.0 card profile; do not create a federation-only builder.
2. Add the GAID extension, AIDoc reference/digest, exact offers, and authenticated federation interface.
3. Canonicalize with RFC 8785 and sign with the installation device key; separately verify AIDoc issuer status/binding.
4. Project only allowed fields through `ProjectionContract` and store peer cards as link-scoped `FederatedRecordMirror(recordType="agent-card")`.
5. Emit only `gaid:pub` aliases in cross-org/public cards; never enumerate private coworkers,
   private issuer prefixes, hidden topology, or internal installation/device details.
6. Declare the versioned GAID A2A boundary extension in the Agent Card and require negotiation for
   any future cross-org relationship.
7. Implement expiry, refresh, withdrawal, revocation, and key-rotation invalidation.
8. Extend `find_coworker` and the existing coworker/service catalog with verified, link-scoped remote results.
9. Fail closed for the authenticated federated card path when identity/signing is unavailable. Do not inherit the current public read-only card's fail-open provenance fallback.
10. Return one canonical remote-coworker discovery shape to external MCP clients, Build Studio tool
    calls, and in-platform coworker/catalog consumers. Presentation may differ; target GAID/card,
    offer, link, environment, freshness, and boundary evidence may not.

### Done

Valid cards verify against the pinned link/device and GAID issuer; stale, withdrawn, wrong-link/key,
mismatched-GAID, unapproved-offer, private-GAID, topology, and forbidden-field cases fail without
enumerating private coworkers. All three entry surfaces discover the same eligible target set from
the same mirrored cards and projection policy.

## 9. S4 — Federated A2A task ingress over canonical TaskRun

**BI:** `BI-90E338D8`

**Delivery:** independent protocol/task PR; receiving ingress remains disabled until S5.

### Expected files

- `packages/db/prisma/schema.prisma` plus a forward-only migration/data-impact record if typed ownership fields are needed
- new canonical A2A contract module under `packages/db/src/`
- new `/api/v1/federation/a2a` route and tests
- federation A2A exchange/delivery modules following the demand patterns
- the stable task/application-service contract delivered by `BI-B6F8BFF4`; MCP route, version
  adapter, and legacy lifecycle files remain owned by that BI rather than this S4 PR
- `apps/web/lib/mcp/packs/coworker-pack.ts`, `apps/web/lib/tak/coworker-collaboration.ts`, and
  task-chat projection adapters
- `apps/web/lib/coworker-service-catalog/a2a-tasks.ts`, `engagements.ts`, and tests
- existing `/api/a2a/*` routes as internal adapters only
- Build Studio task/WorkCapsule linkage and tool-dispatch tests only where the shared handler is not
  already inherited

### Tasks

1. Reconcile current main with legacy peer Slice 4 `BI-06B66FFD`/PR #4119 and current `BI-B6F8BFF4`. Preserve one `TaskRun` convergence. S4 may build the core A2A service first, but its external MCP adapter remains disabled until the official 2026 Tasks service contract is complete.
2. Define one surface-neutral application service over the existing A2A task/engagement modules for
   discovery selection, initiate/message-send, additional input, get/list/status/result, cancel,
   artifact retrieval, and receipt projection. Only its federation adapter may emit cross-install
   traffic.
3. Add closed, versioned A2A CloudEvent payload contracts with size, version, extension, and idempotency validation.
4. Replace the scalar acting/delegating/delegated call-chain metadata with a versioned, receipt-linked
   participation view derived from canonical `TaskRun`/`TaskNode`/`TaskNodeEdge`, Principal/GAID,
   artifact producer, and receipt/evidence records. Add only the minimum agent-Principal/GAID and
   receipt bindings to canonical nodes; do not add an A2A participation-graph table.
5. Define bounded node, edge, depth, serialized-size, and graph-version rules; support fan-out and
   fan-in without flattening. Legacy scalar records dual-read as `legacy-incomplete` until migrated.
6. Store federation/link ownership, origin event, acting/delegating/target GAIDs, origin
   install/environment, card/AIDoc digests, protected graph reference, applied projection version,
   commitment, and verification receipt as typed/indexed ownership where query/integrity needs
   justify it.
7. Implement the non-streaming v1.0 operations required by the first slice: message/send, get/list, additional input, cancel, status/history, and artifact retrieval.
8. Generate the task ID on the receiver and use `TaskRun` as authority; link `CoworkerEngagement` for service/approval context and persist `TaskMessage`/`TaskArtifact` history.
9. Bind every operation to the authenticated `FederationLink`, verified agent context, and local target. Task-ID possession is never authorization.
10. Converge the external MCP path without editing the wire protocol in this slice: `find_coworker`
    selects verified remote cards; final MCP 2026-07-28 server-directed task creation and official
    `tasks/get|update|cancel` reach the A2A service through `BI-B6F8BFF4`'s stable task contract. The
    legacy `tasks/submit|get|result|list|cancel` adapter may call that same service until its governed
    retirement, but never defines S4's internal API.
11. Resolve an external MCP request through its authenticated user/service Principal to a governed
    acting Agent Principal + GAID, or require an explicit authorized delegation to one. Reject raw
    caller-supplied GAID selection and never fabricate a local user/agent identity.
12. Route `request_coworker` to the same service when target resolution returns a verified remote
    card; preserve its current local thread path for local targets. Keep `summon_coworker` local in
    this slice.
13. Let Build Studio invoke the same governed tool/service handler and attach the returned remote
    `TaskRun`/receipt to existing `FeatureBuild`/`WorkCapsule` evidence. Do not add a Build Studio
    A2A state machine or direct federation-route call.
14. Reuse federation delivery/idempotency/loop patterns. Keep `/api/a2a/*` as internal compatibility adapters, not external trust paths.
15. Claim A2A binding conformance only if all required operations and semantics are implemented; otherwise label the surface as the DPF federation A2A profile.

### Done

Lifecycle/concurrency tests pass; a multi-agent fan-out/fan-in fixture preserves every material hop
and receipt; graph limits and immutable versioning pass; duplicate creates converge; conflicting
idempotency payloads fail; guessed/cross-link task IDs, token-only/signature-only calls, replay, and
body mutation are denied; existing internal A2A and demand paths remain green.
The external MCP, Build Studio, and in-platform coworker adapters all exercise the same service
contract and produce one receiver-owned task/receipt shape; an unmapped or spoofed acting GAID is
denied before egress. The MCP parity case uses the final 2026-07-28 request envelope and official
Tasks extension; the legacy adapter is tested only for compatibility and may not be required for
S4 activation.

## 10. S5 — Authority, privacy, receipts, and operations

**BI:** `BI-0E61A6A7`

**Delivery:** independent safety/readiness PR; owns the activation predicate, not the operator UI.

### Expected files

- TAK collaboration-authority and effective-grant modules/tests
- federation cross-org/projection/security modules/tests
- canonical task/receipt/evidence owners
- existing federation activity/health and A2A operations-map projections

### Tasks

1. Enforce the fixed ingress order: link token → device signature/digest → replay/idempotency → install/org/environment → issuer/card/AIDoc → target GAID → local TAK/offer/projection/consent → task.
2. Keep peer claims evidentiary. Intersect local TAK, delegation, offer, consent, tool grants, sensitivity, and projection policy before execution.
3. Implement one canonical pre-signing boundary projector consumed by Agent Cards, CloudEvents,
   task/message/artifact responses, task history, receipts, errors, and peer-visible operations.
4. For same-org, disclose private/federated GAIDs or topology only when `ProjectionContract`
   explicitly allows them. For cross-org, require approved `gaid:pub` aliases for every disclosed
   participant and deny any private/internal identity or topology field.
5. When material hops are withheld, create `participationMinimized=true` plus a signed commitment
   over RFC 8785 canonical graph + task/event context + policy version + high-entropy private nonce;
   retain the nonce/graph for receipted authorized audit opening. Never use an unsalted digest.
6. Add a whole-response egress scanner for private GAIDs, Principal IDs, private issuer prefixes,
   hidden hop/edge IDs, internal installation/device IDs, graph references, and forbidden data in
   payloads, cards, artifacts, errors, receipts, and peer-visible telemetry.
7. Enable only same-org A2A. Existing demand cross-org privacy is the floor; customer-domain, confidential, restricted, prompt, memory, secret, and private-grant material remains denied.
8. Add per-link/per-GAID size, rate, concurrency, TTL, retention, graph, and artifact-classification limits.
9. Persist immutable chain-of-custody and authorization receipts without tokens, private keys, raw prompts, or unminimized payloads.
10. Add bounded-cardinality metrics, structured failure reasons, retry/stuck state, quarantine/revocation behavior, and existing operations-map projection. Metrics never label hidden participant identity or count.
11. Define one fail-closed readiness predicate used by S6 and rollout.
12. Apply the same caller-resolution, TAK/tool-grant intersection, task-ownership check, boundary
    projection, egress scan, and receipt policy to MCP, Build Studio, and in-platform coworker
    adapters. A surface-specific serializer or handler cannot weaken them.
13. Retain caller surface only as bounded local provenance using the existing task trigger/source
    vocabulary. Do not serialize it across the peer boundary unless the `ProjectionContract`
    explicitly allows a minimized value.

### Done

Negative-egress, missing-public-alias, private-ID side-channel, commitment mutation/opening,
revocation-mid-task, cross-org, over-classification, authority-denial, and demand-isolation tests
pass; accepted and denied work is legible through existing evidence/operations surfaces. Cross-org
remains disabled after the tests. Cross-surface authorization tests prove that switching clients
cannot gain task access, spoof a GAID, or bypass the boundary projector.

## 11. S6 — Operator readiness UX and activation controls

**BI:** `BI-68AF8D86`

**Delivery:** independent UI PR over S3/S5 read models.

### Expected files

- existing federation-link detail/admin components and page
- existing coworker/service-catalog components
- existing engagement/task/A2A interaction timeline
- existing Build Studio activity/evidence timeline and WorkCapsule task linkage
- shared status, disclosure, confirmation, and report primitives
- required UX-fit evidence

### Tasks

1. Add progressive-disclosure A2A readiness to the federation link: organization, environment/install, short device identity, issuer/card verification, negotiated version/capability, last refresh/failure, and approved pin/rotation actions.
2. Show remote coworkers in the existing catalog with peer/environment badges, verified-card freshness, offered outcome, and data boundary.
3. Provide consequence-first initiation and cancellation showing both agents, both environments, data classes, write/advisory posture, approval boundary, and retention.
4. Show task lifecycle, messages, artifacts, denials, and verification receipts on existing engagement/interaction surfaces; keep raw proof details behind disclosure.
5. Give authorized source operators a full participation view; give peer/external views only public
   accountable agents, “internal participation protected,” commitment state, and the audit-request
   path. Do not show hidden-hop count by default or imply the public boundary agent acted alone.
6. Make unready states actionable: device confirmation, issuer verification, expired card, missing
   public mapping, commitment failure, quarantine, unsupported extension/version, and cross-org disabled.
7. Use shared primitives and `--dpf-*` tokens; verify keyboard use, ≥44px targets, text status, visible focus, narrow layouts, reduced motion, light/dark themes, and organization branding.
8. Show a Build Studio-originated remote task in the existing build activity/evidence timeline using
   the same task status, target provenance, protected-participation state, artifact, and receipt read
   models. Do not create a Build Studio A2A page or duplicate controls already available through the
   agent/tool interaction.
9. Ensure the in-platform coworker panel and service catalog render the same canonical task and
   remote-agent provenance as the external MCP and Build Studio projections, translated to the
   audience rather than exposing protocol plumbing.

### Done

Component, accessibility, and measured UX-fit evidence pass; the UI never implies A2A readiness
unless S5's canonical predicate is true and never leaks or falsely attributes protected internal
participation. Build Studio and coworker views point to the same `TaskRun`/receipt evidence rather
than copied surface-local records.

## 12. Acceptance and rollout

**Owner:** umbrella `BI-BE0E14E0`; not another implementation BI.

### Per-slice gate

Every slice must:

1. start with red contract/security tests;
2. pass affected unit tests;
3. pass Prisma validation/migration fixtures when schema changes;
4. pass the production web build;
5. update its architecture/API/operator docs or record a concrete no-docs-needed reason;
6. receive independent semantic review on the stable commit;
7. pass exact-tree local merged-code CI, DCO, ready-PR, and merge-queue handoff.

### Canonical-runtime two-install gate

After S1–S6 merge:

1. Re-run the BI parity/crosswalk audit and confirm both installs show the same implementation graph without ambiguous duplicate ownership.
2. Use the governed nonproduction environment/lease and canonical self-upgrade path; never rebuild the live portal from a worktree.
3. Upgrade both designated same-org installs and explicitly approve device pins and issuer bindings.
4. Happy path: discover a projected remote coworker; inspect GAID/AIDoc and install/environment provenance; submit a bounded task; receive working/input-required; add input; receive a minimized artifact; complete; retrieve the task and receipt from the initiating side.
5. Surface-parity matrix: run that discovery/initiate/input/status/result/cancel/artifact/receipt
   contract independently from (a) a governed external MCP client, (b) a Build Studio agent with a
   linked `FeatureBuild`/`WorkCapsule`, and (c) an in-platform AI coworker. Prove all three resolve
   the same remote GAID/card and use the same service, `TaskRun`, authority, projection, and receipt
   contracts. Negative-test a missing acting-agent mapping, a caller-supplied spoofed GAID, and a
   cross-surface task read/cancel from an unauthorized Principal.
6. Multi-agent custody path: run a five-agent fixture with delegation plus fan-out/fan-in; prove the
   source view contains every material GAID/edge/receipt and the allowed same-org projection matches
   its explicit `ProjectionContract`.
7. Enterprise boundary dry-run while execution remains disabled: generate the cross-org projection
   and prove it contains only approved `gaid:pub` participants, minimized-participation state, and a
   signed commitment. Search payload, history, artifacts, cards, receipts, errors, traces, logs, and
   operator exports for every seeded private identifier. Open the commitment through the authorized
   audit path; mutations to graph, context, policy version, or nonce must fail.
8. Negative paths: wrong/rotated device key, token-only request, replay, stale/withdrawn card,
   unprojected GAID, missing public mapping, private-ID/topology leak, unsalted/invalid commitment,
   legacy scalar-only custody, graph-limit breach, task ID from another link, revoked/quarantined
   link, unsupported extension/version, cross-org preset, and development-to-production
   consequential work without local approval.
9. Prove demand federation still functions when A2A is off and when A2A authentication fails.
10. Run live UX-fit review and record screenshots/evidence against the umbrella WorkCapsule.
11. Enable `DPF_FEDERATION_A2A_ENABLED` only for the approved same-org link after every positive and negative case passes.

### Umbrella done

- all six child BIs are done with governed evidence;
- the cross-install BI view has explicit counterpart mapping and no unresolved duplicate ownership;
- the live happy path and all negative paths pass on both canonical installs;
- cross-org remains disabled;
- enterprise boundary projection and authorized commitment opening are proven without leaking the
  protected graph;
- demand regression evidence is green;
- MCP client, Build Studio, and in-platform coworker parity evidence is green, including identity
  spoofing and unauthorized cross-surface negatives;
- the spec, plan, route/architecture docs, and operator guidance match shipped behavior.

## 13. Architecture review

**Verdict:** aligned after decomposition.

| Lens | Result | Required control |
| --- | --- | --- |
| Canonical contracts | aligned | protocol types live in the existing DB/shared-contract owner; wire adapters map versions |
| Identity stewardship | aligned | GAID/AIDoc and `PrincipalAlias` only; no remote-agent or per-agent credential store |
| Identity-boundary projection | aligned | complete protected graph locally; public GAID aliases and signed commitment externally |
| Trust/transport | aligned | A2A extends `FederationLink` + CloudEvents + mutual tokens + pinned device signing |
| Data-model stewardship | aligned with slice separation | link/device fields in S2; task ownership in S4 only when query/integrity requires typed columns |
| Task source of truth | aligned | `TaskRun` owns lifecycle; `CoworkerEngagement` owns service/authority context |
| Discovery source of truth | aligned | extend the existing Agent Card builder and `find_coworker` |
| Entry-surface parity | aligned | MCP clients, Build Studio, and in-platform coworkers are thin adapters over one service; `DI-0171FE184F71` |
| Backlog sovereignty | aligned with guardrail | BI sync provides mirrored/crosswalk coordination; local `BacklogItem` remains authoritative |
| Privacy | aligned | one pre-signing `ProjectionContract` projector; same-org explicit disclosure; public-only cross-org dry-run; cross-org execution disabled |
| Enterprise scale | aligned with bounded contract | DAG node/edge/depth/bytes limits, immutable versions, constant-size commitments, no GAID metric labels |
| Operability | aligned | independent demand/A2A readiness and kill switches; canonical runtime acceptance |

Review corrections carried into the plan:

1. The former atomic implementation scope is replaced by six feature-disabled, independently reviewable slices.
2. GAID conformance is separated from Agent Card federation so identity correctness can land first.
3. Device/link authentication is separated from task semantics and cannot silently upgrade legacy demand links.
4. The authenticated federated card path is explicitly fail-closed; the current public read-only builder's fail-open provenance fallback is not reused there.
5. MCP Tasks/`TaskRun`, Agent Card, and `find_coworker` are dependencies and extension seams, not parallel implementations.
6. BI parity is a coordination layer outside A2A and cannot create multi-writer backlog authority.
7. Full chain-of-custody and external disclosure are separated; the former scalar call-chain seam
   is replaced by the existing receipt/evidence substrate's bounded participation graph.
8. Public/private identity mapping converges through `PrincipalAlias`, while one canonical
   `ProjectionContract` service prevents route-by-route redaction drift.
9. A2A's standard extension points carry the GAID enterprise profile; standard task/card/auth
   semantics and the federation transport remain unchanged.
10. Execution-surface parity is owned inside S3/S4/S5/S6. No seventh BI, surface-specific task
    model, client-supplied GAID authority, or Build Studio federation path is introduced.

## 14. Rollback and recovery

1. Disable A2A per link without revoking the federation relationship; demand continues.
2. Stop A2A delivery and preserve pending/dead-letter records for inspection. Revalidate link/card state before replay.
3. Keep additive schema/backfill data and roll application code through the governed deployment path; forward-fix committed migrations.
4. Preserve task, engagement, message, artifact, and verification history while remote mutation is disabled.
5. On device compromise, quarantine the link, rotate by dual approval, invalidate current card bindings, and require reprojection.
6. On issuer error, withdraw affected cards and block new tasks while preserving alias/history continuity.
7. Recovery is complete only after demand regression, A2A negative tests, and one fresh signed same-org task pass in the canonical runtime.
8. Disable or roll back a local surface adapter without altering stored remote tasks or the
   federation link; remaining surfaces continue to resolve the canonical task according to their
   authorization context.
