---
status: draft
---

# Protected DPF2 host-route qualification

**Scope:** BI-AFF3F2BD · WC-C0134995 · design admission IRD-DAF880A401D1. S8 BI-8B3DBAD8 consumes this output. Base: DPF `89cd7b12d4fb7fa89d4a74ac7a7c188859b0ca31`.

## Scope manifest

**OBJ-QUAL-ISSUE:** Allow the independent installation release owner to qualify one exact protected receiver route with auditable evidence, without letting its preparer approve it.

**OBJ-QUAL-ENFORCE:** Bind route use to current issuer authority and keep revocation, receiver fencing, and original-result custody distinct.

| ID | Objectives | Acceptance |
| --- | --- | --- |
| AC-QUAL-ISSUE | OBJ-QUAL-ISSUE | Record one exact current qualification linking the nonproduction installation, registration, receiver, route, build/profile, scope, epoch and expiry to its evidence and distinct approver. An exact retry returns the same audit receipt, while stale, foreign or self-approved input confers no grant. |
| AC-QUAL-DISPATCH | OBJ-QUAL-ENFORCE | Before dispatch require current exact qualification and a separately admitted attempt and worktree. Missing, expired, mismatched or revoked proof holds before transport. A possibly-started attempt becomes readback-only. |
| AC-QUAL-REVOKE | OBJ-QUAL-ENFORCE | Commit the issuer fence and durable revocation request atomically. Prove the competing receiver orderings in a governed nonproduction fixture. Accept only a complete authentic acknowledgement and never interpret it as an attempt outcome. |

## Problem and decision

S6 can consume a current qualification and fence a revoked route, but its host registry is observation only. The production call graph at the base contains no issuer-side caller of `queueFencedHostRevocation`. Neither a registration nor a successful probe grants dispatch. A fixture acknowledgement is not current authority, and neither an acknowledgement nor silence settles an attempt.

Reuse the existing human approval envelope and audit mechanism with a distinct host-qualification action. Do not reuse a rehearsal approval, a task grant, or S5 receipt identity. Keep the issuer-owned qualification lifecycle separate from the registry, as agreed in `cmwweqkfh2d9h0ep1vg2vizrk`. An envelope alone does not provide a live, revocable qualification. An independent approval system would duplicate the existing gate. Resolve the minimal typed lifecycle linkage and authoritative installation release-owner resolver during design/data review; no parallel store or resolver is assumed.

## Qualification, fencing and recovery

- **QUAL-1, exact authority.** The authenticated DPF2 owner supplies receiver evidence. The evidence preparer proposes one exact, same-install registration and selected endpoint/audience, immutable package and profile, contract version, scope, expiry, and expected epoch. The installation release owner independently approves that fingerprint. In the issuer transaction, re-resolve the owner and source evidence, validate the accepted approval, and record one qualification referencing the immutable registration and its audit. Exact retries read the same receipt. Changed receiver, route, scope, or artifact requires new approval. The no-task approval pattern in [the existing producer](../../../apps/web/lib/workroom-runtime/s5-rehearsal-approval-producer.server.ts) is precedent for not waking a provider.
- **QUAL-2, dispatch.** [The existing binding](../../../apps/web/lib/workroom-runtime/protected-execution-binding.ts) verifies exact host and qualification and intersects admitted and observed routes. The Workroom separately pins its admitted worktree, source, origin, and attempt. At admission, start and resume require a fresh positive exact authority read and the current receiver floor. Clearing the floor is not a grant. Stale, ambiguous, foreign or restored state with unproven epoch holds. Use the existing single-use reservation; an attempt that might have started becomes readback-only.
- **QUAL-3, revocation.** In one DPF transaction, record revoked state and the new floor and enqueue via [the existing revocation control](../../../apps/web/lib/workroom-runtime/protected-authority-control.server.ts). The Control floor keys on source installation, receiver, qualification-epoch and qualification ref. Authenticate and verify the full bounded acknowledgement, including affected handles under the exact Store commit, before recording receiver-fenced. Report source-fenced, receiver-fenced and actual attempt outcome independently. Already possibly-started work may only reconcile against the original result or authorized protected stop. Never resend uncertainty. Receiver rotation cannot inherit old proof.

## Receiver evidence and outstanding handback

The Mac is a client or VM host, not a provider CLI execution target. The protected receiver target is a separately nominated nonproduction NixOS environment. The existing NixOS scaffold does not package the newer qualified launcher. Delivery Coordination and the release owner need authenticated effective connector/service evidence for the exact installed target, separately issued qualification and an admitted attempt. No installed target or release qualification is evidenced here.

DPF2 handoff SHA-256 `c87576f16877a621a5f79dbed98938bbbd5194504e54a9dba95a0a6c04e93447`. Foundation `8b3afa0f0c1c4cf5d6d9b190dd2b807c75130d6a` is source only. FB-2c `2c329ec80b484969373b9e3bb3f80c65ab5d3b9d` / tree `1f0196c6d1bebb8427377cd2e263d29afce632e6` supplies injected-auth admission and floor vectors, not a registered peer or an externally qualified exact-attempt read endpoint. The distinct offline HA10/EX Green 4/4 at `7a75ccd04346f2283898dc5cfdda81c6c00f011c` / tree `dced712be2f620dfa00926033693b198d009fe1d` (TAP SHA-256 `a84e0e8e5b89ede828fd8ca96eaba29b3a70ef6744bf2f1ca98d1435c5e9907c`) supports one synthetic loopback dispatch and original read after restart with no second dispatch or upstream request. It is not installed NixOS evidence or a Control callback identity. The replacement-attempt negative fixture at `f5757f569eb9aa5f957ab9df8a05b6e0cf06e749` and actual HA10 HOLD stay negative.

## Research and benchmarking

On committed base `89cd7b12`, the unchanged dispatch guard ran exactly once and passed (one case passed, three deselected). It checks missing authority and epoch mismatch before transport. The scoped producer-side test then failed as intended: the existing Inbox lookup returns `undefined` for the proposed host route qualification action (one assertion failure, 103 ms runner duration, Workroom test evidence under command `aff3f2bd-issuer-policy-red-observed-v1`). The Red is a local test candidate, not a production change or proof of actor separation.

DPF2 offline timings and Ubuntu evidence do not benchmark or qualify the installed NixOS route. The Lane C packaging evidence pins a harmless staging regression proposal, but no NixOS package or backend has been accepted. No comparative throughput, cost, runtime latency or capacity observation is claimed.

## Verification plan

First local Red for QUAL-1: use the existing Inbox decision-policy lookup with the proposed distinct action identity `protected-host-route-qualification`. The lookup must expose an owner-only, decision-only handler, rather than treating the action as executable or returning no policy. The test invokes only the lookup. It does not create an envelope, write a qualification, call a provider, or touch the receiver. This is the first producer-side condition, not proof of actor separation, issuance, revocation or installed NixOS qualification.

| Case | Required result |
| --- | --- |
| Issue and replay QUAL-1 | Separate preparer and current release-owner approver. One exact approval produces one auditable qualification. Expired, substituted, stale or self-approved input produces none. |
| Read and dispatch QUAL-2 | Read the exact decision, issuer, time and evidence. Wrong host, rotated registration, mismatched worktree/route or unproven floor cannot start. |
| Revoke versus admit QUAL-3 | Source fence and one durable job commit together. Incomplete or stale acknowledgement remains unknown. Test both receiver ordering outcomes and reconcile already admitted handles rather than claiming they stopped. |
| Joined synthetic NixOS witness | After separate authorization, one provider-free operation and one independently authenticated original-result read after interruption. Zero duplicate launches, provider calls, and host CLI execution. No witness until exact target and scope are admitted. |

DPF approves and fences; DPF2 authenticates, enforces its floor, and reports original outcome. T3 stays available. The provider-free fixture is readiness evidence only and earns no S8 cost, throughput or capacity parity credit. The unchanged S6 dispatch guard passed on the observed base with mock inputs. Producer Green and joined verification remain unrun. The existing references are not a research pass, independent approval, or runtime admission.
