---
status: active
---

# Consume audited approvals with the recorded decision maker

Backlog: BI-6BA00C83. Workroom: WC-8903C5DA.

This is a correction to the existing [approval convergence design](2026-10-07-approval-convergence-on-envelope-design.md), AC-OVERRIDE and W6/B8, and the existing DEV review exception. It introduces no new approval policy or grant. The [implementation plan](../plans/2026-10-16-audited-approval-consumption.md) carries the single delivery unit.

## Observed defect

On served source `c38edb55c0ddf10f6db4eab4848698e2aeed7019`, exact request `cmvafy5xq08mx01obg4ruh7xy` was approved on behalf, then failed with: "The delegate needs the existing verified operator approval for this exact exception." The failed request remains immutable. No exception was recorded.

On base `7d3c363c227408446ff400b53e3b017a5fdb8ee6`, `envelope-actions.ts` records the actual administrator as `humanApproval.userId` and `by`, the delegated owner as `onBehalfOf`, and the reason. `human-approved-execution.ts` accepts only a marker naming the delegated owner. `semantic-review-policy-exemption.ts` repeats that assumption when consuming an exception. The producer and consumers disagree about an already-supported decision.

## Objectives and acceptance

**OBJ-EXECUTE:** A permitted recorded decision executes its exact delegated action once.

**OBJ-PROVENANCE:** Preserve the actual decision maker, delegated owner and agent without treating one identity as another.

**OBJ-BOUNDARY:** Reject unverifiable or changed approval and preserve action-specific authority.

| ID | Objectives | Acceptance |
| --- | --- | --- |
| AC-OWNER | OBJ-EXECUTE, OBJ-BOUNDARY | Existing direct-owner approvals remain valid under their current consumer contract. |
| AC-ONBEHALF | OBJ-EXECUTE, OBJ-PROVENANCE | A valid persisted on-behalf decision is accepted at exception creation and consumption, with the actual approver and delegated owner retained separately. |
| AC-CAPABILITY | OBJ-BOUNDARY | The actual on-behalf decider must be a current eligible human account and hold both the existing administrator capability and the action's required capability; manage_users alone does not authorize a manage_platform exception, and a canonical automation fixture is not a human decision maker. |
| AC-BINDING | OBJ-BOUNDARY | Wrong owner, agent, tool, input fingerprint, marker identity, onBehalfOf, missing reason, future or invalid time, unreserved approval, expiry and revocation are refused. |
| AC-CONSUMERS | OBJ-BOUNDARY | The break-fix declaration's owner-only human contract is unchanged; a shared helper does not silently enable on-behalf approval for every consumer. |
| AC-ASSURANCE | OBJ-PROVENANCE, OBJ-BOUNDARY | Failed reviews, failed envelopes, native review UNRUN and client independence UNVERIFIED keep their existing meaning; no historical failed request is replayed or rebound. |
| AC-LIVE | OBJ-EXECUTE, OBJ-PROVENANCE | After canonical deployment, a fresh supported exact request is authorized and executed through the existing workflow; verify its recorded decision and result without caller-supplied approval context or alternate credentials. |

## Existing substrate and correction

Extend `human-approved-execution.ts`; do not add another approval store, marker format, tool or permission. Reuse the existing persisted marker and on-behalf interpretation, current user-context resolver, capability checks, and canonical input fingerprint.

One strict persisted-envelope resolver serves execution and consumption. Execution requires the existing reserved approved state. Consumption accepts only the existing reserved approved or executed states. Both validate the envelope's owner, agent, tool, exact inputs, reservation, expiry and actual marker. A direct-owner marker and an on-behalf marker remain distinct facts.

On-behalf acceptance is explicit at the action consumer: the DEV exception supplies `manage_platform`, and the resolver also checks the established administrator capability. Existing consumers that do not opt in retain their owner-only behavior. Current membership and account activity are read through the existing canonical resolver. The actual decider's canonical automation-fixture identity is refused for this human-only action; do not infer that identity from an email or from the browser executor. An email, automation label, caller-provided role, approval identifier or a client assertion never supplies verified human authority.

The legacy persona predates fixture columns. `ensureAutomationPersona` identifies it through the reserved `AUTOMATION_PERSONA_EMAIL`; all fixture fields may be null. Extract that owning identity into a pure leaf, preserve sign-in exports, and make both approval verification and the existing upgrade requester classification use its exact predicate. This is canonical reserved-identity matching, not inference from arbitrary email text or display names. Revalidate the delegated owner's current action capability as well as the actual approver's.

Exception capture records the actual decision maker separately from the effective delegated owner. Consumption reuses the same resolver and checks that captured provenance still agrees. Legacy direct-owner exceptions may remain valid when the existing exact persisted approval proves them. Missing actual-decider provenance cannot make a previously invalid on-behalf record valid.

No migration, endpoint, installer change, new dependency or UI layout is required. Existing approval outcome surfaces must show the actual execution outcome. Installed assets and paired-peer records are outside this source correction.

## Research and rejected explanations

This defect repair reuses settled repository policy rather than selecting a new authorization architecture. Primary evidence is the live exact approval result, AC-OVERRIDE/W6/B8, the producer's on-behalf tests, and the named base's two consumers. The observed request was approved, so lack of a decision is not its failure. A failed delegate result is not a completed exception. The mismatched marker is established by source and the recorded actual/on-behalf identities; no caller-supplied envelope field will repair it.

Reject changing the marker to pretend the owner clicked: that loses the actual decider. Reject a DEV-wide bypass, manage_users standing in for action authority, duplicated consumer validation, mutation of the failed envelope, and treating source tests as served acceptance. A second issue in the original proposal's assessment shape was separately corrected by the actual reviewer; it does not erase the first execution failure.

## Verification and recovery

Add first-failing persisted-envelope tests and a capture/consume regression. Exercise malformed and changed bindings, direct-owner compatibility, actual approver capabilities and existing break-fix tests. Run both web TypeScript programs, style and module guards, then one governed merged-code integration run and protected CI. Native semantic review remains separately attributed; infrastructure uncertainty is never a pass.

The source rollback is a protected revert. It must not revive failed approval or exception records. A live refusal remains a recorded failure until a fresh valid request succeeds after deployment. Production and unknown installation behavior, DEV exception evidence and expiry requirements, and exact-head failed-review refusal remain in their existing owners.
