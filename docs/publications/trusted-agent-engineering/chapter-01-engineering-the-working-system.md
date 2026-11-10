---
status: draft
---

# Chapter 1: Engineering the working system

**Sample chapter · informative editorial draft · 16 October 2026.**
This chapter explains the canonical drafts identified in the
[packet source baseline](README.md#source-baseline). It adds no normative
requirements and makes no implementation conformance claim.

A finance manager asks an agent to review an expense. The receipt is legible,
the total is correct and the category is plausible. The agent writes, “Approved.”

What happened?

It may have drafted a recommendation. It may have changed a record. It may have
told a human that another system had approved the expense. It may even have
called a payment tool. The sentence does not tell us which.

An engineering design has to answer that question before the agent receives
consequential tools. It also has to answer several others. Which organization
owns the policy? Which principal delegated the action? Which version of the agent
was assessed for the job? What data could it use? Which account processed that
data? What happens if a request succeeds but its response disappears?

These questions define the system around the model.

## Begin with the operating composition

The model is one component of an agent that performs work. The complete operating
composition also includes instructions, retrieved doctrine, memory, tools, runtime
code, credentials, provider routing, data constraints, oversight and recovery
behavior.

Change one of those components and the relevant claim may change. A model that
extracts invoice fields well has not thereby demonstrated that it can approve
expenses. An agent assessed against one tool's behavior has not automatically
retained its qualification after that tool gains a new effect. The same named
model can operate inside two very different authority boundaries.

In the DPF-originated standards family, an operating profile is the versioned
description of that composition. Qualification belongs to the identified profile
in a job and context. Authorization is checked for a particular action. These are
related facts with different owners.

That distinction keeps us from asking a single benchmark to answer five
different questions.

| Question | Kind of answer |
|---|---|
| Who is acting? | Identity and operating-profile resolution. |
| Is this composition fit for this work? | Job-specific qualification evidence. |
| Is this action a good choice? | Scoped judgment against evidence and principles. |
| May it happen now? | Current authorization for the exact action. |
| What actually happened? | Execution receipt and subsequent observation. |

An agent can pass one check and fail another. It can be competent but unauthorized,
authorized but out of qualification scope, or correctly authorized for an effect
whose outcome remains uncertain.

The harness should preserve those distinctions in both its records and its
user interface.

## Five statements that should not collapse into “done”

Consider these statements about the expense:

1. “The agent recommends approval.”
2. “The agent is qualified to perform this approval activity.”
3. “The organization authorizes this specific approval.”
4. “The approval tool accepted the request.”
5. “The expense record now reflects the intended approved state.”

The first statement describes judgment. The second is a claim about assessed
capability. The third records an authorization decision whose conditions must
still hold at execution. The fourth describes an execution
observation. The fifth is an outcome observation.

None implies all the others.

A tool receipt may establish that a target accepted a request without proving
that every downstream business step completed. A timeout may leave the effect
unknown. Conversely, loss of the credential used for a request does not make a
genuine historical receipt disappear. A recovery process may need to observe and
reconcile existing evidence while refusing any new effect.

This is why a workflow status named completed is not enough to assess the business
result. The record needs to say what completed and which evidence supports it.

## Principles direct; policies constrain; grants authorize

A principle explains what direction a decision should take. A policy converts
some of that direction into applicable conditions. A grant contributes delegated
authority; effective permission still depends on the current intersection of
the applicable principal, coworker, work, data and execution constraints.

For the synthetic expense, an organization might value prompt reimbursement,
require documentary evidence and authorize a particular role to approve expenses
within a defined scope. These statements play different parts.

“Resolve expenses promptly” cannot compensate for a missing approval grant.
A persuasive explanation cannot override a prohibited category. A model's
confidence that a receipt is valid cannot decide which organization owns
the budget.

DPF names three doctrine scopes:

- **WWMD** resolves platform direction.
- **WWWD** resolves the organization's business decisions.
- **WSID** resolves profession and craft judgment.

Other implementations can use different names. The engineering requirement is
to identify the owning scope and avoid quietly converting neighboring advice
into authority. The public draft
[TAK §7.13](../../architecture/trusted-ai-kernel.md#713-principle-directed-decision-contract)
owns this proposed principle-directed decision contract.

For example, the platform may define how an authorization decision is recorded
and enforced. The customer organization decides its expense policy. Finance
practice informs the evidence needed to evaluate a receipt. Combining their
advice does not mean averaging three scores into a universal permission.

A decision record should explain which scope resolved which question.

## Use hard constraints before preferences

Suppose the agent has three possible next steps:

- Approve the expense.
- Request a missing receipt.
- Refer the expense to an authorized exception reviewer.

Ranking them for speed, employee experience and operator effort can be useful.
It becomes misleading if an ineligible option remains in the ranking.

If the policy requires a receipt and there is no receipt, ordinary approval is
excluded before preference scoring. If no one has delegated the exception
decision, the agent cannot manufacture that authority by assigning escalation
a high cost.

A vector system needs defined axes, directions, scales and versioned weights.
It also needs an eligibility filter. A weighted preference is not a permission
check.

The practical result is a smaller decision problem. The model spends its judgment
on admissible alternatives rather than rationalizing prohibited ones.

## Four standards around one effect

The DPF family separates the responsibilities of the surrounding system.

**GAID** concerns agent identity, operating profiles, claims and receipt binding.
A relying party can ask which subject a claim concerns and whether its status is
current. Identity does not grant permission.

**TAK-JSI** concerns job-specific qualification. It connects the operating profile
to a job, activity, data scope, assessment and revalidation conditions. Qualification
does not authorize a live action.

**GPP** describes the gated permission binding: a named authority decision admits
a bounded capability set for a subject at a stage of a work shape, under stated
validity and stop conditions. GPP supplies the model. It does not enforce the call.

**TAK** concerns runtime mediation. It checks the principal, coworker grants, work
envelope, data constraints and qualification or oversight ceiling at the
execution boundary.

The useful unit is one governed effect, with the applicable facts joined by
versioned references. The family is designed to compose around that effect;
it is not a claim that any named implementation has already passed every profile.

The canonical ownership map is the
[standards-family document](../../architecture/agent-standards-family.md).
The requirements themselves remain in
[TAK](../../architecture/trusted-ai-kernel.md),
[GAID](../../architecture/GAID.md),
[TAK-JSI](../../architecture/job-specific-intelligence.md) and
[GPP](../../architecture/gated-permissions-process.md).

## A kernel metaphor with an explicit boundary

The Trusted AI Kernel borrows a useful design ambition from a kernel:
consequential operations should cross a boundary that applies the current rules.

It is an ambition that requires evidence. Naming a component “kernel” does not
show that it controls every reachable effect. A tool named write-file may reach
one controlled directory. A shell tool may reach programs, network clients and
credentials. A browser can create an effect without calling the application API
that the designer expected.

The implementation statement therefore has to name the boundary:

- Which effects are mediated?
- Through which entry points?
- What can escape through delegated execution, browser use or code execution?
- Which failures are contained?
- What remains outside the assessed host boundary?

A prompt telling the model to obey policy is useful instruction. It does not
establish that an unauthorized request cannot cross a separate execution path.

Nor is stopping always a complete recovery response. If an external request may
already have succeeded, stopping new work leaves an obligation to reconcile it.
Containment and recovery belong in the same design.

## Model the relationships, then prove their realization

A systems model makes the relationships inspectable. It can connect a requirement
to a work stage, decision, interface, control and verification case.

Established approaches cover much of this terrain. SysML supplies a
systems-modeling foundation; BPMN and DMN provide process and decision
specifications; PROV-O provides a provenance vocabulary. The proposed composition
uses these strengths with explicit mappings and limitations. Putting their names
in one diagram does not establish semantic equivalence or interchange conformance.
[SysML 2.0](https://www.omg.org/spec/SysML/2.0),
[BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2),
[DMN 1.5](https://www.omg.org/spec/DMN/1.5),
[PROV-O](https://www.w3.org/TR/prov-o/).

Keep three facts separate:

| Fact | Example |
|---|---|
| Intended model | The approval stage declares a current gated permission. |
| Deployed control | The active tool boundary checks that binding before dispatch. |
| Observed behavior | A challenge with a revoked binding produced no approval effect. |

The first supports design review. The second requires implementation and
configuration evidence. The third requires an actual observation. A complete
drawing does not substitute for the latter two.

The [external-alignment companion](../../architecture/agent-standards-external-alignment.md)
owns the informative crosswalk. The book adds no modeling-language conformance claim.

## Make the human decision useful

Human involvement should resolve a real question: a policy exception, an authority
boundary or a material uncertainty. Repeatedly asking whether the agent may make
the next ordinary call spends attention without improving the underlying decision.

GPP places an attributable decision around a bounded class of work. The runtime
then checks each call against that envelope. Valid authority can cover several
deterministic steps; it cannot silently cover changed parameters, a new destination
or a broader effect.

The right recovery message might be:

> The receipt is missing. This expense is held for documentary evidence.
> The agent may continue checking the synthetic record, but approval is not permitted.

That message explains the state, the dependent effect and the resolver.
“Waiting for approval” would conceal whether evidence or authority is
actually missing.

## A small design exercise

Take one action your agent can perform and write five separate records:

- The proposed action and its exact target.
- The evidence and scoped judgment supporting it.
- The current authority that would permit it.
- The observation returned by the execution boundary.
- The evidence of the resulting target state.

Now remove the response after dispatch. If the design immediately retries, it has
skipped an uncertainty problem. Revoke authority before dispatch. If the old
recommendation still executes, it has confused judgment with permission. Import
the definition into a different harness. If the old qualification automatically
becomes a claim about the new composition, it has skipped target evidence.

These exercises expose the seams where the harness must carry the system's
meaning. Later chapters turn those seams into contracts, tests and operating
procedures. The second supplied sample,
[Chapter 6](chapter-02-synthetic-expense-control-loop.md), follows one synthetic
expense through those boundaries.
