# Workforce Portfolio: A Proposed Evolution of the IT4IT/DPPM Internal Portfolio

## Status

Working draft for discussion with The Open Group IT4IT Forum and Digital Portfolio Work Group.

## Executive Summary

The current Digital Product Portfolio Management (DPPM) model is built around four portfolio types: Provided Externally, Provided Internally, Foundational, and Manufacture and Delivery. In DPF, the Provided Internally concept has historically appeared as `For Employees`, with the stable platform slug `for_employees`.

This paper proposes that standards-facing language evolve from `For Employees` to **Workforce**. The change is intentionally small in structure and significant in meaning: it preserves the four-portfolio model while recognizing that modern work is performed by a mixed set of accountable actors, including employees, contractors, AI coworkers, robots, non-human identities, managed-service roles, and future actor classes not yet common.

The proposed label is:

> **Workforce Portfolio (Provided Internally)**

The objective is not to replace the DPPM portfolio shape. It is to make the internal portfolio fit the operating reality that IT4IT and DPPM increasingly need to govern: digital products are consumed by people, AI coworkers, autonomous systems, service accounts, robotic systems, and blended human/non-human teams. Portfolio management should be able to account for all of them without treating non-employee actors as exceptions.

## Why This Matters Now

The term `employee` is an employment classification. It is useful for HR, benefits, and legal treatment, but it is too narrow as a portfolio-management boundary.

Enterprises already depend on work actors that are not employees:

- contractors and consultants who use internal digital products
- outsourced and managed-service roles accountable for business outcomes
- AI coworkers and specialist agents with role-like responsibilities
- robotic process automation and physical robots that perform operational work
- non-human identities, service accounts, and automation principals that initiate or approve system actions
- partner or ecosystem actors who operate inside a governed internal workflow

In a product-managed digital enterprise, these actors create the same portfolio questions employees create:

- What internal digital products do they need?
- Which roles and responsibilities do they fulfill?
- What tools, credentials, skills, permissions, and budgets do they require?
- Which human approval, supervision, or escalation path governs their work?
- What gaps prevent them from contributing safely and effectively?
- What internal-product investment is justified by their work?

`Workforce` is a better portfolio word because it describes accountable work capacity rather than one legal employment status.

## The Four-Portfolio Model With Workforce

The proposal keeps the DPPM four-portfolio model intact.

| Current DPPM portfolio role | Proposed standards-facing label | Purpose |
| --- | --- | --- |
| Provided Externally | Goods and Services for Sale | Goods and services provided to customers, citizens, partners, or other external consumers. This is DPF's user-facing label for the source model's “Products and Services Sold” portfolio. |
| Provided Internally / For Employees | Workforce | Internal digital products and workforce actor support capabilities used by employees, contractors, AI coworkers, robots, non-human identities, and other accountable work actors. |
| Foundational | Foundational | Reusable technology building blocks, platforms, data, infrastructure, security, and shared services that enable the other portfolios. |
| Manufacture and Delivery | Manufacture and Delivery | The digital factory products and capabilities used to build, deploy, release, operate, and support digital products. |

The Workforce change is not a fifth portfolio. It is a terminology correction and scope clarification for the internal portfolio.

## What Changes Conceptually

### From internal user to accountable actor

The older mental model asks: "Which employee-facing digital products do we provide?"

The Workforce model asks: "Which accountable actors perform work for the enterprise, and what internal digital products do they need to do that work safely and effectively?"

That shift matters because AI coworkers and robotic systems are not merely tools used by employees. They are increasingly role-shaped operating participants with assigned responsibilities, tool grants, capacity constraints, decision limits, supervisors, and audit evidence.

### From consumer-only to consumer and contributor

The Provided Internally portfolio has traditionally focused on internal consumption: the tools and services internal users consume.

The Workforce portfolio adds a second lens:

- **Consumption lens:** internal products the workforce uses, such as HR, ITSM, finance, collaboration, knowledge, identity, access, and productivity products.
- **Contribution lens:** the workforce actors themselves, including their role, authority, capacity, tools, approvals, and unmet needs.

Both lenses are necessary. A missing internal tool and an unfilled workforce capability are both internal operating-model gaps.

### From employee count to workforce capacity

As employee count rises or falls, the AI coworker parity model becomes more specific. A business may add a human employee, assign an AI coworker to a parallel or supporting role, appoint a human approver, or replace manual work with a governed automation. Those changes are workforce-capacity decisions, not merely HR headcount decisions.

The portfolio should therefore track the relationship between:

- human roles
- AI coworker roles
- assigned human approval or interface owners
- skills and tool grants
- budget and capacity limits
- work outcomes and lifecycle stage

## Proposed Terminology

### Recommended standard wording

Use **Workforce Portfolio (Provided Internally)** as the standards-facing label.

Use **For Employees** only as a legacy alias during transition.

### Proposed glossary entry

**Workforce Portfolio:** The DPPM portfolio containing internally provided digital products, workforce actor support capabilities, and governance surfaces that enable accountable work actors to perform enterprise work. Workforce actors may include employees, contractors, AI coworkers, robotic systems, non-human identities, partner roles, and other approved human or non-human actors operating under enterprise authority.

### Proposed note for standards text

The Workforce Portfolio extends the traditional employee-facing interpretation of Provided Internally. It includes internal digital products consumed by workforce actors and the support capabilities required to govern, equip, supervise, and improve those actors.

## Implications for IT4IT and DPPM

### Portfolio taxonomy

The portfolio taxonomy should continue to classify internal digital products, but examples should be updated so the internal portfolio does not imply employee-only scope.

Examples that belong under Workforce include:

- HR and people operations
- contractor onboarding and offboarding
- AI coworker registry and lifecycle management
- tool grants, skills, and authority for AI coworkers
- robotics operations and supervision
- internal finance, time, payroll, and tax-remittance work surfaces
- collaboration, knowledge, ticketing, ITSM, and employee-service products
- non-human identity governance and service-account lifecycle

### Value-stream line of sight

Workforce actors participate across IT4IT value streams. They help evaluate demand, explore options, integrate solutions, deploy changes, release value, operate products, and support consumption. Treating AI coworkers and non-human actors as workforce members lets the model express who or what is doing the work at each stage.

### Governance and accountability

The change improves governance clarity. A robot, automation, service account, or AI coworker can be represented as a workforce actor only when the organization can identify:

- accountable owner or supervisor
- permitted work and tool scope
- approval and escalation pattern
- audit evidence
- lifecycle status
- capability needs and constraints

That is stronger than treating non-human participants as invisible implementation detail.

### Financial management

Employee-only language hides important cost drivers. Workforce management needs to account for:

- salary and contractor cost
- AI provider and token cost
- model hosting cost
- robot/automation asset cost
- license and seat cost
- approval and supervision effort
- opportunity cost of constrained workforce capacity

The Workforce portfolio gives financial managers a more complete view of internal operating spend and capacity.

## DPF Platform Recognition

DPF now treats this as a platform terminology and architecture direction:

- The canonical portfolio slug remains `for_employees` for compatibility.
- The operator-facing portfolio label is **Workforce**.
- `For Employees` is retained as a legacy alias and standards cross-reference.
- AI coworkers are associated structurally to the Workforce portfolio through Digital Product, taxonomy, coworker capability need, and epic fallback paths.
- The AI Workforce surface is treated as an internal Workforce digital product, not a detached platform administration page.
- Tax remittance and other internal operating surfaces remain under Workforce when they are internal capabilities used by the business to perform work.

This avoids breaking existing data while moving the human-facing model forward.

## Adoption Path

1. Use **Workforce Portfolio (Provided Internally)** in new standards text and discussion material.
2. Add `For Employees` as a transition alias in glossaries and diagrams.
3. Update examples to include employees, contractors, AI coworkers, robots, and non-human identities.
4. Keep the four-portfolio structure unchanged.
5. Encourage tools and platforms to keep stable machine identifiers where needed, while updating display labels and descriptions.
6. Add conformance guidance that workforce actors require accountable ownership, authorization, and auditability.

## Open Questions for the Forum

1. Should the standard prefer **Workforce Portfolio** or **Workforce and Internal Enablement** as the human-facing label?
2. Should `Provided Internally` remain the formal architecture term, with `Workforce` as the business-facing portfolio name?
3. Should AI coworkers and robots be modeled as workforce actors directly, or as a subcategory of non-human identity?
4. What minimum attributes should a non-human workforce actor carry for portfolio governance: owner, purpose, scope, grants, budget, lifecycle, evidence, or all of these?
5. How should workforce-capacity accounting align to financial views across salary, contract, license, token, model-hosting, and automation costs?

## Recommendation

Adopt **Workforce Portfolio (Provided Internally)** as the next standards-facing label for the internal DPPM portfolio. Preserve the existing four-portfolio model and use the change to clarify that the internal portfolio now covers both:

- the internal digital products consumed by the workforce
- the accountable human and non-human actors that perform enterprise work

This is a small terminology change with a large architectural benefit. It lets IT4IT and DPPM recognize the parity between employees and AI coworkers without creating a new portfolio type or destabilizing existing implementations.

## References

- The Open Group, [IT4IT](https://www.opengroup.org/it4it)
- The Open Group, [IT4IT Standard Version 3.0 licensed downloads](https://www.opengroup.org/IT4IT/downloads)
- The Open Group, [Digital Portfolio Work Group](https://www.opengroup.org/forum/digital-practitioners-work-group)
- The Open Group, [Digital Portfolio of Open Standards](https://www.opengroup.org/digitalportfolio)
- The Open Group Guide, `Digital Product Portfolio Management in the Digital Enterprise`, Document Number `G252`, March 2025, local reference: [`docs/Reference/digital_product_portfolio_mgmt.txt`](../Reference/digital_product_portfolio_mgmt.txt)
- DPF, [`Business Operating Model - Portfolio Wiring Design`](../superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md)
- DPF, [`IT4IT` entity reference](../founder-kernel/wiki/entities/it4it.md)
