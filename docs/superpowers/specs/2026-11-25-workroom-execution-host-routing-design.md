---
status: draft
---

# Qualified execution-host routing for Workrooms

**Backlog:** BI-5A866218 · **Workroom:** WC-3B0AB38E · **Epic:** EP-INPLATFORM-CODING
**Parent:** [T3 Code absorption, S6](2026-11-13-t3-code-absorption-design.md), DI-B806C8D27736 as narrowed.

Select the qualified host that owns the admitted worktree, then keep that host for the lifetime of the attempt. The portal remains the Workroom authority. DPF2 is the only protected executor. Losing a route changes what the portal knows, not where the attempt runs or how it ended.

This is a DPF design, not a launch approval. It does not enroll a production host, use production workload data, turn on an adapter, or authorize a live install change. The January 2027 target belongs to the first-production-Workroom plan, not to this design's acceptance.

## Objectives

**OBJ-S6-QUALIFICATION:** Admit a route only to a currently qualified protected executor in the same installation, and stop dispatch when qualification is missing or revoked.

**OBJ-S6-BINDING:** Persist the link between a Workroom's admitted session, exact stage attempt, and authorized worktree on one host, without another Workroom or session ledger.

**OBJ-S6-REATTACH:** Recover observation and delivery against the original attempt after losing contact, without relaunching it or inventing an outcome.

## Acceptance

| Acceptance | Objectives | Statement |
| --- | --- | --- |
| AC-1 | OBJ-S6-QUALIFICATION | An installation-scoped registry reuses the toolchain host agent for observation and connection, not execution. Unregistered, unqualified, expired and revoked hosts are refused before dispatch. |
| AC-2 | OBJ-S6-BINDING, OBJ-S6-REATTACH | The Workroom records one host proven to own its authorized worktree. Reattachment and readback target the exact original attempt. Ambiguity never launches an attempt on that or any other host. |
| AC-3 | OBJ-S6-QUALIFICATION, OBJ-S6-BINDING | Candidate transports to that same host are loopback, tailnet and authenticated HTTPS, in that order. No plain-HTTP all-interface bind, third-party relay or telemetry. |
| AC-4 | OBJ-S6-QUALIFICATION, OBJ-S6-BINDING | Host links narrow the admitted session's authority. Dispatch and readback bind the immutable origin, and no observation, replay or reconnect can widen authority or move the attempt. |
| AC-5 | OBJ-S6-QUALIFICATION | A paired Dev install remains a federated peer with work sync. It cannot qualify as a production execution host of the other installation. |

## Research and decision

| Reference | Adopt | Leave out |
| --- | --- | --- |
| [T3 comparison in the parent design](2026-11-13-t3-code-absorption-design.md) | Environment-owned execution, ordered routes, non-expanding links and an origin fence. | A device ledger, hosted relay and telemetry, or treating T3 linkage as DPF authority. |
| [GitHub Actions self-hosted runner routing](https://docs.github.com/en/actions/reference/runners/self-hosted-runners#routing-precedence-for-self-hosted-runners) | Match eligibility before sending and hold when no eligible runner is available. | Reassigning an ambiguously delivered job to another runner. S6 must preserve the exact worktree and attempt, not just equivalent capacity. |
| [Kubernetes node status and heartbeats](https://kubernetes.io/docs/reference/node/node-status/#heartbeats) | Keep timed reachability separate from admission and represent missing observations as unknown. | A cluster, new lease service or scheduling policy. Do not inherit its timing constants or infer attempt termination from node reachability. |

For OAuth-protected hop credentials, follow [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707.html) and [RFC 9700 §2.3](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.3) on binding credentials to the intended protected resource and narrowing privileges. The receiver's transport credential and the S5 room credential have different audiences. No token is forwarded to a different resource or used as evidence of host qualification.

WWMD DI-531221429EA5 favored a pinned host through the existing outbox and protected receiver over retry-time host selection or a second routing and session ledger. High confidence and eligible for autonomous design work. It does not grant activation or satisfy independent review.

## Substrate and ownership

| Existing owner | Use in S6 |
| --- | --- |
| [Workroom runtime outbox](../../../apps/web/lib/workroom-runtime/workroom-effect-store.ts), [supervised session record](../../../apps/web/lib/workroom-runtime/supervised-session.ts) and [broker §7.2](2026-10-27-agent-dialog-broker-design.md#72-sessions-on-execution-hosts-t3-absorption-bi-fd5d9302) | Use the existing Workroom command, receipt and outbox transaction. The current local `hostId` identifies a portal process, not a qualified remote host. The production binding belongs to Workroom state. The broker's earlier host-side token issuance language does not apply to protected execution. S5 retains issuance and revocation. |
| [Toolchain host agent](../../../packages/dpf-skill-pack/scripts/toolchain_agent.py) and [readiness model](../../../packages/db/prisma/schema/ai-coworker.prisma) | Extend the existing observation and connection path. A readiness row, client heartbeat, host name or declared digest is not qualification. Review a distinct authoritative qualification record and its lifecycle before choosing exact schema. Do not retrofit telemetry into a grant or add a device daemon. |
| [T3 synthetic coding-session port](../../../apps/web/lib/build/t3-code/t3-coding-session-port.ts) | Preserve the launch-versus-readback separation and opaque correlation idea. It has no deployed route or protected admission. Do not register it as a live adapter or make T3 thread or run IDs part of the authority contract. |
| [Workroom-bound toolsets](2026-11-25-workroom-bound-toolset-design.md) and BI-B62B218E | S5 owns the versioned launch projection, room credential and tool ceilings. External membership and staffing come from BI-B62B218E. S6 takes the exact admitted context, resolves the host, and only narrows it. Missing current job qualification, when required, remains held even on a qualified host. |

**BI-224F56F1 overlap.** On `codex/workroom-restart-recovery` at `ddbaf32d184e`, the design and plan repair fresh portal edit-scope enrollment after a same-container restart. They bind current cohort proof to the claim transaction and harden the canonical portal/actuator boundary. S6 relies on those admission guarantees where applicable. It does not change that work, the local boot supervisor, cohort/transition fences, or proof cleanup. The local boot supervisor reopens local sessions through `start()` and may requeue their inputs. A protected remote attempt must not enter that local boot enumeration or its process-bound retirement path. Use a distinct, versioned remote binding on the same Workroom and host-addressed outbox effects, not a second supervisor or ledger.

## Host qualification and dispatch

1. **Register as a candidate.** Use the authenticated existing host-agent connection to report available route kinds to its own installation. DPF registers a stable, opaque `hostRef` within that installation by verifying its binding to the protected receiver's local key-store identity. The receiver checks that binding against local configuration, not a caller's asserted host identity. Ignore client-supplied installation, addresses and display names as authority. A peer installation never enters this registry. Registration alone cannot dispatch.
2. **Qualify the protected route.** The DPF installation records a current, revocable route qualification only after its authorized admission owner validates same-install ownership and the authenticated DPF2 receiver's bound local host identity, protected execution profile and supported contract version. Bind the approved endpoint identity, version, allowed scope, expiry and revocation epoch to the qualification and its evidence. Check proof and issuer through the existing authority path at admission. Keep the host qualification separate from the coworker's job qualification. No self-assertion, successful probe, possession of a room token or operator access to the machine substitutes for either. Until the protected-executor qualification producer and verifier are identified and approved, candidates stay unqualified.
3. **Bind before sending.** Resolve the active participant, stage attempt, canonical worktree ownership and immutable origin on the portal. A match must resolve to exactly one admitted, currently qualified same-install host. Persist the session and host correlation and pending effect in one Workroom transaction. If ownership is absent, ambiguous or no longer matches, hold. Do not select based on provider availability, the initiating device, a bare path, or last heartbeat.
4. **Revalidate at dispatch.** The effect worker rechecks the exact current binding, qualification epoch, membership, stage, worktree, origin and credential ceiling before contacting the receiver. Only enumerate the bound host's approved routes. Try verified loopback first, then authenticated tailnet, then authenticated HTTPS. Loopback must genuinely be local to that receiver. Require authenticated endpoint identity on each hop, no caller-controlled redirects, and no downgrade after an identity or authorization refusal. Reachability fallback before handoff may switch transport, never host. Once a start may have crossed a route, subsequent contact is readback only. No alternate route gets a second start.
5. **Revoke and fence.** The DPF qualification owner can revoke a host or route grant. Loss or rotation of the underlying host credential, endpoint identity, approved protected profile, version, or expiry also invalidates its prior proof. Requalification needs a new approved epoch, not a heartbeat. On revocation the portal fences subsequent dispatch and addressed turns, invalidates affected route access, and suppresses pending delivery or observation that no longer has authority. S5 owns exact session-token release. DPF2 owns effect-side enforcement and reconciliation. The receiver must check current authority against the bound epoch at admission and refuse a revoked, expired, unqualified or unverifiable target, including a revocation racing an already-sent request. If the peers cannot prove this boundary, dispatch remains disabled. Already-started work needs exact-attempt reconciliation. Revocation does not prove cancellation, cleanup or a terminal outcome.

## Boundary with DPF2

The S5 projection stays normative and unchanged. It contains the opaque session reference, admitted GAID, Workroom and stage attempt, authorized worktree/host reference, runtime mode and permitted operations. DPF supplies the immutable origin and pinned-host qualification correlation to the authenticated receiver through its bound transport. The opaque room credential travels separately on the secure launch connection. Neither the projection nor correlation is a credential. No plaintext secrets, provider credentials or local absolute paths go into the outbox, logs or fixtures.

DPF owns selection and correlation. DPF2 independently refuses the wrong installation or local host, an unverified worktree or source, an unsupported mode, mismatched origin and any attempt outside the current admission. Only the protected executor can accept or restart the original attempt, and only DPF2 issues its outcome receipt. S6 does not implement those actions. A host link can apply a narrower restriction, never substitute another principal, worktree, operation, credential or origin.

The DPF2 FB-2c approach check at `e7479d38` confirms the proposed ownership boundary, local host mismatch refusal, and exact-attempt status and outcome receipt as the reattachment surface. The lookup must use the admitted session and canonical DPF attempt identity at the pinned host. If DPF2 needs a generation for lookup, it is opaque correlation on the same attempt. A changed process generation is never new DPF authorization. New attempts require a separate DPF-authorized stage transition. Use the same authenticated protected receiver for status and receipt. Exact fields, endpoint and epoch interoperability still need joint fixture conformance. S6 adds no signing requirement or wire fields to the S5 projection.

| Observation | DPF action |
| --- | --- |
| Authenticated host reachable | Update bounded reachability for that qualified host. Do not report an attempt as accepted or running. |
| Exact binding accepted or observable | Restore observation against that attempt, using its opaque ref and cursor if provided. Do not issue a start, restart, or unscoped list. |
| Exact terminal outcome receipt | Correlate the authenticated receipt to the original host, session, stage attempt and origin, directly or through its immutable attempt handle. Use the opaque receipt reference for deduplication and record it through the existing Workroom evidence path. Usage is observed or unknown, never inferred as zero. |
| Timeout, broken route, `unknown-attempt`, uncertain outcome, missing or ambiguous reply, incomplete correlation | Hold for readback. Neither an elapsed lease nor missing data proves start refusal, completion or termination. |
| Explicit refusal, revoked binding or wrong origin, host, attempt or protocol | Refuse new effects. Keep authorized historical evidence and do not downgrade to local execution or broaden the read. The refusal does not settle an earlier in-flight attempt. |

Exact-attempt polling is sufficient for the first slice. It needs no new DPF2 host heartbeat endpoint. If a readback cursor is available, it must not jump across attempts or overwrite a newer observation. Keep it separate from the room-message delivery cursor. A broker message stays held or queued when the pinned recipient is unreachable. Do not add a new delivery budget or a new outbox. A portal restart recovers qualified remote correlations and bounded readbacks through existing durable Workroom processing. It never triggers the local `start()` path for a remote binding. A timeout can age into an operator-visible supervision hold, but cannot settle the protected attempt. Closing or releasing a room stops new actions without forging a terminal receipt.

A coordination activity that cannot write source may still need the S5 room credential for its specific admitted room operations. Route qualification never supplies that credential or the coworker's JSI. The `s5-route-handoff` pilot plan owns those decisions. No writing credential, generic inspection job or production use of fixture JSI is implied here.

## Verification and release boundary

All functional evidence is unrun at design time. The later plan must bind each row to an immutable build and a synthetic nonproduction fixture, then exercise the compatible DPF2 receiver in the governed shared environment. A fixture alone is not a live qualification or protected-execution pass.

| Objectives | Required later evidence |
| --- | --- |
| OBJ-S6-QUALIFICATION | Accept an approved synchronized installation/host/profile/epoch pair. Refuse missing, stale, forged, wrong-audience, peer and revoked qualification. Race revocation with a leased dispatch and verify no protected admission after the fence. Assert an upgrade or new endpoint cannot inherit prior proof silently. |
| OBJ-S6-BINDING | Index lookups by installation, host and worktree binding. Two eligible routes to a single host preserve one attempt. Ambiguous worktree ownership, wrong source/host/origin, unsupported mode and a stale member or stage refuse before dispatch. A second eligible host must not get an already bound effect. Credentials and paths never appear in evidence. |
| OBJ-S6-REATTACH | Lose the first reply, expire the outbox lease, restart the portal and reconnect to the same attempt. Verify no second launch and no effect through the local supervisor. A stale or wrong receipt, missing readback, host disappearance, and a late cursor cannot settle or advance the attempt. Accept the matching receipt once without touching siblings. |

Use bounded indexed reads of the exact binding and qualification, and consider at most the three supported transport kinds. Probe out of band or with bounded authenticated readback, never scan all rooms or hosts per dispatch. Retain only bounded reachability and correlation metadata. Qualification provenance, revocation audit, outbox retention and rollback compatibility belong to the data review. On a rollback that cannot interpret the binding, hold remote dispatch and preserve the evidence. Never convert remote sessions to local ones.

The next gate is independent design approval on the exact note, then architecture/security/data review and a covered implementation plan as applicable. The DPF route candidate is tentatively Dec 14–22, with Dec 22–Jan 9 as the risk window. The forecast assumes a stable S5 fixture (BI-3F265686 affects its claim), compatible FB-2c, reproducible protected-route qualification, BI-B62B218E membership binding and native review capacity. No production installation, release, qualification or endpoint is approved here.
