---
status: draft
---

# Chapter 6: A synthetic expense control loop

**Second sample chapter · informative editorial draft · 16 October 2026.**
Its filename identifies its place in this two-sample packet; Chapter 6 is its
place in the proposed book. The
[packet source baseline](README.md#source-baseline) identifies the canonical
drafts being explained.

The example in this chapter approves a synthetic expense record. It never
initiates a payment. Every identifier, person, amount, organization and rule
below belongs to a teaching fixture. The example does not establish a real
organization's policy, an agent's qualification or regulatory compliance.

The task is deliberately small. An employee submits a meal expense for
**USD 184.20**. The agent must determine the permitted next step, apply it to
a synthetic approval target and retain enough evidence for another person
to explain the result.

The interesting part is what happens when the ordinary path breaks.

## Freeze the teaching world

We begin with a fixture named expense-teaching-v1.

| Element | Fixture value |
|---|---|
| Organization | Example Services, a fictional organization. |
| Record | EXP-SYN-0042, revision 7. |
| Requester | person-requester-17. |
| Amount | USD 184.20, stored as 18,420 minor units. |
| Category | Business meal. |
| Evidence | Synthetic receipt, declared business purpose and duplicate-search result. |
| Ordinary ceiling | USD 200.00 for this fixture. |
| Additional condition | An approver cannot approve their own expense. |
| Target effect | Change this synthetic record from submitted to approved. |
| Excluded effects | Payment, banking, payroll, vendor changes and external messaging. |

These rules are invented for the exercise. In a deployment, the accountable
organization supplies its own versioned policy. Finance practice and applicable
legal requirements remain in their owning scope.

The frozen amount uses an integer representation to make the example's arithmetic
explicit. Currency interpretation, tax treatment and policy scope still require
a domain contract; choosing an integer does not resolve those questions.

The fixture also supplies a trusted test clock, versioned evidence and an explicit
expected result for every challenge. No input defaults to Public merely because
it is synthetic. Its processing and disclosure policy is declared.

The fixture and challenges below are editorial examples, not an executed
assessment. The operator's selection of financial operations for a second
demonstration does not establish an assessed specimen, frozen business policy
or passing result.

## Give the work stages

The work shape has five stages:

~~~text
intake → examine → decide → apply-approval → verify-outcome
~~~

Intake accepts a bounded record and its evidence references. Examination checks
completeness and records observations. Decision resolves the organization's
policy against the admissible choices. Apply-approval can request one exact
approval effect. Verify-outcome observes the target state and reconciles
uncertainty.

A held decision stays held. The coordinator does not jump to apply-approval
simply because a model says the record looks reasonable.

Stage boundaries also bound capabilities. Examination can read the synthetic
record, receipt and duplicate index. It cannot write approval state. Applying
approval cannot change the amount, create a vendor or initiate a payment.
Verification can observe the same effect even when new approval authority has
since been revoked.

That observation still needs its own current read and data-access authority.
Permission to reconcile a past effect does not confer a right to read records
that the observer is no longer entitled to access.

The work shape should expose these distinctions to a human looking at many
expenses. It should also identify an accountable resolver for missing evidence
and exceptional authority. A status with no resolver is a label for a future stall.

## Establish identity and job scope

The actor is the fictional expense-reviewer-01, using profile
expense-reviewer-profile-v1. Its profile identifies the instruction, tool,
model-routing, data and oversight revisions used in the fixture.

The qualification record in this example is simulated test input. It carries
no real JSI assessment claim. A deployment would need a scheme that establishes
which activities, amounts, evidence conditions and risk context the assessed
profile can handle.

This matters when roles divide. Receipt extraction, policy recommendation and
approval execution can be separate activities. Demonstrated competence at
extracting a total does not establish competence at deciding an exception.

The runtime also resolves the current delegating principal. The requester and
approver are separate fixture identities. The agent cannot use the fact that
it represents the requester as authority to approve that requester's expense.

The public [GAID](../../architecture/GAID.md) and
[TAK-JSI](../../architecture/job-specific-intelligence.md) drafts own these
identity and qualification concepts. No identity or qualification claim in
this example supplies runtime authority.

## Resolve the policy question

The decision belongs to the fictional organization's business scope. The
platform supplies the mechanism; it does not choose the organization's
meal policy.

The available outcomes are:

| Outcome | Meaning in this fixture |
|---|---|
| Recommend approval | Required evidence and ordinary-policy conditions are met. |
| Refuse ordinary approval | A known policy condition excludes the expense. |
| Hold for evidence | A material fact cannot yet be established. |
| Escalate for authority | A decision outside delegated ordinary authority needs its named resolver. |

The fixture first checks hard conditions. It verifies the receipt, purpose,
amount, category, duplicate status and separation of requester and approver.
Only then does it compare eligible next steps.

A model can help interpret a description or identify an ambiguous receipt field.
A typed classifier could also contribute a bounded judgment. For example,
TypeSafe documents typed choice and score primitives composed in code. That is
a possible implementation comparison, not an adopted provider or a permission
system. Its output would still need domain evaluation, source restrictions and
an authorized processing destination.
[TypeSafe introduction](https://docs.typesafe.ai/introduction).

For a deterministic fixture condition such as the minor-unit amount exceeding
its ceiling, use the declared rule directly. A model is not needed to reinterpret
an exact comparison.

A confidence score does not repair missing evidence. If the receipt total cannot
be established, the state is held for evidence even when the model strongly
prefers approval.

The [TAK principle-directed contract](../../architecture/trusted-ai-kernel.md#713-principle-directed-decision-contract)
owns the separation of evidence, hard constraints, recommendation and
authorization. The chapter adds no alternative decision engine.

## Resolve the gated permission

For apply-approval, the GPP binding names the work shape and stage, the actor
scope, the organization's gate decision, a bounded approval capability and the
conditions that keep the binding current.

The following is teaching notation, not an importable contract:

~~~text
binding: synthetic-expense-approval-v1
subject: expense-reviewer-01 / expense-reviewer-profile-v1
stage: synthetic-expense-v1 / apply-approval
gate: organization ordinary-expense decision
capability: approve this synthetic record
preconditions:
  exact record revision and argument digest
  required evidence remains current
  requester differs from accountable approver
  policy and binding revisions remain current
stops:
  cancellation, revocation, expiry, changed record, unknown prior effect
~~~

The binding does not create a credential or grant.
[TAK's execution boundary](../../architecture/trusted-ai-kernel.md#72-effective-permission-rule)
still intersects current principal authority, coworker grants, the work
envelope, data restrictions and the qualification or oversight ceiling.

A declaration in shadow mode is not an enforced permission. If the declared
adapter cannot make this effect unreachable when its binding fails, the report
cannot claim enforcement. The [GPP draft](../../architecture/gated-permissions-process.md)
owns binding semantics and the distinction between modeled, enforced and
evidenced profiles.

## Bind one exact effect

An approval request needs more than the verb approve.

It binds:

- The synthetic record identifier and expected revision.
- Target service and account.
- Operation identifier and revision.
- Canonical arguments or their canonical digest.
- Purpose and amount/currency context where material to the operation.
- Actor and operating-profile revision.
- Work and stage.
- Policy generation and GPP binding revision.
- Stable effect identity and a distinct attempt identity.

The effect identity describes the intended business change. The attempt
identity describes one submission attempt. A retry changes the latter; it
does not turn the intended approval into a different business effect.

A digest identifies canonical bytes. It does not authenticate who authorized
them. The host supplies the authenticated record and checks that the same
binding reaches the target.

## Put the durable boundary around dispatch

The portable reference loop requests decisions, authorization, reservation,
dispatch and observation. It does not supply a durable database transaction
or authenticate its own events. Those are host-adapter responsibilities.

A simplified host procedure is:

~~~text
advance(effect_id, expected_state_revision, event):
    authenticate event and load the retained work state
    compare expected revision with current state
    reject changed bindings or invalid event order

    if an earlier attempt may already have reached the target:
        emit reconciliation request only
    else:
        check current authority, data policy and exact proposal
        durably reserve effect and attempt
        persist new state and outgoing command together

dispatch(reserved_command):
    recheck current authority at actual use
    enforce the target/account/argument binding
    consume the reservation once
    submit through the declared mediated target
    record the target observation
~~~

This is informative pseudocode. A real adapter must state how it prevents or
contains the race between validation and use. Two separately successful
checks do not make a cross-system transaction atomic.

Where the target supports a verified idempotency contract, the adapter can
use it. Where it does not, the design needs an explicit uncertainty and
reconciliation procedure. The phrase “exactly once” is not an explanation
of that procedure.

The existing [portable reference contract](../../architecture/trusted-agent-reference-contract.md)
describes the requests, host responsibilities and limits. Its examples are
simulations with no conformance claim.

## Lose the response

The approval target receives the request and changes the record. The response
is lost.

From the caller's perspective, the effect is now **unknown**. The expense is
not proven unapproved. Repeating the write because a network request failed
could repeat an effect that already occurred.

On recovery, the host loads the retained effect and attempt. It asks the
target for the outcome associated with that effect. It does not dispatch
another approval merely because a process restarted.

There are several possible observations:

- Evidence establishes that the intended approval occurred.
- Target evidence establishes that no effect occurred.
- A trusted adapter can establish that submission never happened.
- The result remains unresolved.

Only the applicable reconciliation or verified idempotency contract can
justify a new attempt. A missing response is not evidence of no effect.

If the work was cancelled during the uncertainty, observation can still
resolve what already happened. Cancellation prevents the cancelled work
from retrying. It does not rewrite the historical target state.

## Revoke authority between recommendation and use

Now take a different challenge. The decision recommends approval, but the
responsible organization revokes authority before dispatch.

The previous recommendation remains a historical fact. New execution is
refused. An old authorization observation cannot authorize a request after
its conditions cease to hold.

This is one reason the model's reasoning trace should not be treated as a
permission token. A model can explain the facts it evaluated. The runtime
must still examine the facts and authority that govern actual use.

The same separation applies to material changes. If the expense revision
changes, a new target account is selected or the binding widens, the prior
exact-action authorization does not silently carry forward.

## Challenge the claim before reporting it

Freeze the expected results before running the assessment.

| Challenge | Required observation |
|---|---|
| Ordinary permitted expense | Exactly bound synthetic approval is observed with linked receipt. |
| Amount above the fixture ceiling | Ordinary approval does not occur; disposition identifies the policy limit. |
| Missing receipt | Approval does not occur; the evidence resolver is named. |
| Requester equals approver | Approval does not occur under ordinary authority. |
| Revocation before use | The effect boundary refuses dispatch. |
| Changed arguments or target account | The mismatched proposal is refused. |
| Lost response after submission | State becomes unknown; reconciliation precedes any retry. |
| Concurrent replay | Durable effect identity and revision control constrain dispatch under the declared contract. |
| Cancelled uncertain work | Observation may continue under current read authority; approval retry does not. |
| Shadow or unavailable control | Report discloses the limitation and makes no enforcement claim. |
| Unapproved model destination | No processing occurs at that destination. |
| Unsupported adapter behavior | Result is unsupported or unrun, never converted to a passing manual check. |

The report identifies how many assertions were applicable and attempted.
It preserves failed, inconclusive, not-run and unsupported results. It names
the profile, fixture, adapter, versions, environment, assessment time and
assessor.

Zero prohibited effects in a finite frozen scenario set is a useful result
when actually observed. It does not establish zero risk in every future input
or deployment.

## Show the operator what remains

A useful expense view can expose:

- The current stage and disposition.
- The governing policy and authority references.
- Which evidence is missing or stale.
- Whether an effect is permitted, dispatched, uncertain or observed.
- The resolver and next bounded action.
- The qualification and enforcement scope being claimed.

An uncertain expense should stay visible until its accountable recovery
path resolves it. The system should not congratulate the user on a completed
approval while the target result is still unknown.

This small example produces the same questions that appear in a larger agent
platform: who owns the decision, what the operating composition can do, why the
action is permitted and how the outcome is established. Once those answers have
durable identities and tested transitions, scale becomes an operational problem
that people can inspect. Without them, scale multiplies ambiguity.
