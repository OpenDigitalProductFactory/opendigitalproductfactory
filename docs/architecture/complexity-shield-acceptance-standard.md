# Small-Company Complexity Shield — Acceptance Standard

**Status:** binding acceptance standard for company-ops parity work  
**Backlog:** BI-COP-006 / EP-COMPANY-OPS-PARITY  
**Related:** [DPF Market Vision](../marketing/dpf-market-vision.md), [Company-running MVP profile](../superpowers/specs/2026-07-24-company-running-mvp-profile-design.md), BI-COP-001 parity scorecard, BI-COP-005 edge-adapter doctrine, BI-ECO-007 role/size patterns

## Purpose

Small and mid-sized companies need enterprise-grade *function*, not enterprise-suite *form*. This standard is the acceptance bar for every Workday / QuickBooks / WorkOS (and similar) parity feature: the operator gets the job done without the scale, vocabulary, implementation burden, or integration complexity of the enterprise product being benchmarked.

If a PR or design only ports an enterprise control surface into DPF, it fails this standard even when the underlying capability is correct.

## Thesis (one sentence)

**Ship the simplified operator-facing workflow; let AI coworkers and the platform absorb the enterprise complexity.**

## Non-goals

- This is not a competitive parity scorecard (that is BI-COP-001).
- This is not the edge-adapter vs native absorb doctrine (that is BI-COP-005).
- This does not size or sequence backlog items.
- This does not authorize overclaiming against [market vision](../marketing/dpf-market-vision.md) — incomplete parity remains incomplete.

## Who must apply it

| Audience | When |
| --- | --- |
| Spec authors | Before finalizing company-ops, HCM, finance, identity, or workforce UX |
| Implementers | Before claiming a parity BI is done |
| Reviewers / PR readiness | When the diff touches owner-operator workflows for parity features |
| UX audits | When scoring owner cockpit, setup, and employee self-service |

## Acceptance checklist (every parity feature)

A feature that claims Workday / QuickBooks / WorkOS / suite parity **must** document and ship all five of the following. Missing any item is a fail.

### 1. Operator job, not suite module

State the **one operator job** in plain business language (e.g. "who can approve this expense", not "configure multi-level approval matrices").

- [ ] Job named in owner vocabulary for the archetype
- [ ] Success outcome is observable without reading admin matrices
- [ ] First viewport answers: what is this, what next, what if I do nothing, is it reversible

### 2. Simplified operator-facing workflow

Describe the **happy path in ≤7 operator steps**. Enterprise intermediate steps may exist only if they are optional, progressive, or coworker-executed.

- [ ] Happy path documented and exercised
- [ ] Default path needs no consultant vocabulary
- [ ] Advanced / rare controls are behind an explicit Advanced disclosure, not the default form

### 3. What AI / coworkers absorb

Name what the platform or coworkers do **on behalf of** the employee or owner so humans do not become the integration layer.

Examples: draft reconciliations, propose staffing, prepare approval packets, normalize imported books, surface exceptions only.

- [ ] At least one absorbed complexity is named
- [ ] Human retains authority on consequential actions
- [ ] Failure mode is a plain exception, not a silent wrong write

### 4. What enterprise complexity is hidden, automated, or omitted

Explicitly classify each enterprise concept the benchmark product exposes:

| Treatment | Meaning |
| --- | --- |
| **Hidden** | Exists in the model / adapter but not in the default operator UI |
| **Automated** | System or coworker maintains it without operator setup |
| **Omitted** | Intentionally out of scope for this slice (must not be implied in marketing or acceptance) |

- [ ] Table or bullet list present in the PR / spec
- [ ] No omitted capability is advertised as shipped
- [ ] Hidden capability has a recovery path if an operator truly needs it (docs, advanced, or coworker)

### 5. Proof without enterprise burden

Evidence of done is an owner-operator completing the job, not a screenshot of an admin matrix that looks like the competitor.

- [ ] UX verification uses a seeded non-admin persona at real privilege when the job is employee/manager self-service
- [ ] Setup cost is measured in minutes for a small company, not project phases
- [ ] No second parallel store for org identity, people, or money facts (platform single source of truth)

## Worked micro-examples

| Parity area | Pass shape | Fail shape |
| --- | --- | --- |
| Approvals (relationship engine) | Owner sees "who can approve this" with a short list and consequence copy | Permissions-matrix admin screen as the only path |
| QuickBooks import review | Review exceptions and accept a proposed book of record | Force full chart-of-accounts redesign before any import |
| Employee self-service | Employee changes availability or views pay summary in their words | HRIS configuration wizard dumped on the employee |
| Staffing / solver | Manager gets a proposed schedule with conflicts named | Raw solver parameters and constraint DSL as default UI |
| Identity / SSO | Connect IdP and map roles with three plain steps | Full federation topology diagram as day-one setup |

## Required PR / spec section template

Copy into company-ops parity specs and PRs:

```markdown
## Complexity shield (BI-COP-006)

- **Operator job:** …
- **Happy path (≤7 steps):** …
- **Coworker / platform absorbs:** …
- **Enterprise complexity treatment:**
  - Hidden: …
  - Automated: …
  - Omitted: …
- **Proof persona:** …
```

## Cross-references (apply, do not re-litigate)

- BI-HCM-002 — manager / employee self-service
- BI-WFM-003 / BI-WFM-004 — staffing and solver UX
- BI-QB-001 / BI-QB-002 — QuickBooks connection and import review
- BI-COP-001 — durable parity scorecard
- BI-ECO-007 — role and company-size complexity-shield patterns
- External promise boundary: `docs/marketing/dpf-market-vision.md` (do not overclaim)

## Change control

This file is the single source of truth for the complexity-shield acceptance bar. Point to it; do not fork a second checklist inside feature specs. Feature specs may only *apply* the template section above.
