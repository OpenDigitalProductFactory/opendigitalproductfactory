---
status: draft
---

# Trusted agent engineering: publisher review packet

This packet delivers the proposed book scope and two sample chapters for
**BI-6AC40460**, within **EP-B932453F**. It is informative editorial material.
It does not amend a standard, certify an implementation or authorize a business
action. Publisher outreach, a contract and a complete manuscript are outside this
delivery.

Read the [publisher proposal](publisher-proposal.md), then the two sample chapters:

1. [Engineering the working system](chapter-01-engineering-the-working-system.md)
2. [A synthetic expense control loop](chapter-02-synthetic-expense-control-loop.md)

The proposal asks a publisher to evaluate the audience, structure and sample
writing. Technical reviewers should challenge the separation of judgment,
qualification, permission and evidence. The finance example uses invented data
and explicitly illustrative policy. It is not an adopted organizational policy or a
demonstration of banking access, payment execution or regulatory compliance.

## Editorial delivery and acceptance

The delivery sequence is recorded in the live item: verify sources and comparable
books; write the proposal and samples; review claims, permissions and rights;
check links and generated documentation; publish a DCO pull request. This is a
documentation deliverable, not a software implementation plan or another
conformance baseline. Runtime control changes stay with their existing owners.

| Acceptance from the live item | Where to review it |
|---|---|
| A complete reviewable publisher proposal and two sample chapters exist with no unsupported safety or adoption claims. | Proposal, both chapters, and the claims boundary below. |
| Book narrative points to versioned canonical specifications rather than creating another normative source. | Source baseline below and the normative links in each chapter. |
| Publisher-facing claims, permissions and proposed rights are reviewed. | Proposal rights/permissions section; independent technical and editorial assessment remains distinct from author checks. |
| Full manuscript, publisher outreach and contract signing remain explicit follow-on scope. | Proposal scope and this introduction. |

The files are a reviewable draft. Source checks and independent client review
cannot stand in for the operator's rights decisions, a publisher's acceptance,
independent standards ratification or actual runtime assessment.

## Source baseline

The initial editorial baseline is repository commit
`d9c8ed1fc887527c2a8b893f9a8062519c5a4384`. The rows identify the exact bytes
used when drafting. The linked living documents may subsequently change;
references to a later revision require a fresh editorial check.

| Canonical owner | Git blob at the baseline |
|---|---|
| [Trusted AI Kernel](../../architecture/trusted-ai-kernel.md) | `2fc0b7ae2790a11193bfeba6d79765052abd4fb2` |
| [GAID](../../architecture/GAID.md) | `f0b60a4dfa7d3f18518c5c65d6e1d32291f6d536` |
| [TAK-JSI](../../architecture/job-specific-intelligence.md) | `c10f170920efb5f51c10959cbb375108ce7c5210` |
| [Gated Permissions Process](../../architecture/gated-permissions-process.md) | `b4d8752463c99a069518f575b097a70884c241cc` |
| [Standards family map](../../architecture/agent-standards-family.md) | `edd7fd734230eb65c02bf2c796f1bdb23881f375` |
| [Portable reference contract](../../architecture/trusted-agent-reference-contract.md) | `67e6713f5128073463139d9ff7093971f313d47d` |
| [Governance white paper](../../architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md) | `906c6d561dfb2494530e2337a2289b5fc8cb3f5f` |

Use the [MBSE programme baseline](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/d9c8ed1fc887527c2a8b893f9a8062519c5a4384/docs/superpowers/specs/2026-09-27-trusted-agent-mbse-baseline-design.md)
for the original composition proposal and the
[contribution roadmap](../../architecture/agent-standards-contribution-roadmap.md)
for maturity and external review. These are working drafts and programme
artifacts, not evidence of foundation adoption.

## Claims boundary

The repository contains normative drafts, portable reference functions and
implementation sources. A tested reference function establishes behavior only
within its stated test boundary. It does not establish complete DPF conformance,
complete mediation in another host, qualification of every coworker, universal
safety, measured financial benefit or legal compliance.

The executable conformance runner, complete DPF specimen, Hermes and Cursor
reproductions, and a genuinely external assessment remain separate deliveries.
The synthetic expense was selected by the operator as the second demonstration;
the sample chapter does not claim that assessment has run. Book examples explain
the intended controls and the observations needed to evaluate them.

## Withdrawal and correction

Corrections update this packet through the same reviewed source process. Revert
its documentation change to withdraw the proposed edition. This requires no
permission, qualification or runtime-state rollback because this packet changes
none of those owners. Keep historical editions attributable; do not silently
replace their declared source baseline.
