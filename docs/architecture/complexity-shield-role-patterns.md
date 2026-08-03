# AI Complexity Shield Patterns by Role and Company Size

**Status:** binding companion patterns for BI-COP-006 acceptance standard  
**Backlog:** BI-ECO-007 / EP-ECOSYSTEM-ABSORPTION-ARCH  
**Related:** BI-COP-006 acceptance standard, BI-COP-005 edge-adapter doctrine, HCM/WFM self-service BIs, accounting bridge UX, authority decisions

## Purpose

Define **role- and company-size-specific** complexity-shield patterns so DPF can absorb enterprise-suite functionality without exposing enterprise-suite complexity.

BI-COP-006 is the **acceptance bar**. This document is the **pattern catalog**: how shielding looks for owner, manager, employee, accountant, admin, IT/MSP, sales/support, field/frontline, and AI coworkers across **micro**, **small**, and **scaling** companies.

## Size bands

| Band | Rough headcount | Complexity default |
| --- | --- | --- |
| **Micro** | 1–10 | Single owner cockpit; almost no admin roles; coworkers fill gaps |
| **Small** | 11–50 | Light manager layer; shared bookkeeping; still owner-first language |
| **Scaling** | 51–250 | Named roles appear; progressive disclosure of policy, not suite modules |

Above scaling, patterns still apply, but org-chart depth may justify optional advanced lanes — never as the default first viewport.

## Shared shield rules (all roles)

1. **Job language first** — screens and coworker prompts name the operator job, not the suite module.
2. **Happy path ≤7 steps** — extra enterprise steps are optional, progressive, or coworker-executed.
3. **Default is safe and reversible** — destructive or high-blast actions require explicit confirmation and an undo/hold path where feasible.
4. **AI coworker absorbs ceremony** — multi-system reconciliation, matrix setup, and jargon translation run in the coworker lane unless the human must decide.
5. **No second home for policy** — authority and org identity stay on canonical DPF models.

## Pattern matrix by role

### Owner / founder

| Band | Pattern | Avoid |
| --- | --- | --- |
| Micro | One “run the business” home: cash, people, customers, open risks | Separate admin console as daily home |
| Small | Same home + light “who covers when I’m out” | Full org-chart designer before first hire workflow |
| Scaling | Delegated lanes with plain-language authority (“can approve expenses under $X”) | Workday-style security groups as setup step 1 |

### Manager

| Band | Pattern | Avoid |
| --- | --- | --- |
| Micro | Often same person as owner; no manager chrome | Fake manager personas |
| Small | Team list, time-off, “who is on what,” approve/deny in place | Nested matrix orgs |
| Scaling | Team outcomes + exceptions; drill-down only when needed | Enterprise workforce planning suite as default |

### Employee / individual contributor

| Band | Pattern | Avoid |
| --- | --- | --- |
| All | Self-service for “my pay stub / my time / my request” in ≤3 taps | HRIS admin navigation |
| Scaling | Manager chain visible only when it affects the request | Full directory browser as self-service home |

### Accountant / bookkeeper

| Band | Pattern | Avoid |
| --- | --- | --- |
| Micro | Simple cash + invoices; export/bridge when needed | Full multi-entity GL on day one |
| Small | Bank match, AP/AR queues, tax-ready exports | Recreating desktop QuickBooks module tree |
| Scaling | Close checklist + exceptions; bridge remains for filing SoR | Dual SoR without authority map (BI-COP-005) |

### Admin (business admin, not platform SRE)

| Band | Pattern | Avoid |
| --- | --- | --- |
| Micro | Invite people, set hours, connect bank/email | Tenant-wide policy engines |
| Small | Roles as named jobs (“bookkeeper,” “store lead”) | Hundreds of capability checkboxes first |
| Scaling | Policy packs with progressive advanced settings | Empty “enterprise security” pages |

### IT / MSP

| Band | Pattern | Avoid |
| --- | --- | --- |
| Micro | Often absent; owner uses guided setup | Forcing IT persona |
| Small | SSO/SCIM optional; health of connections visible | Requiring IdP before first value |
| Scaling | Identity-edge adapter mode + audit export | Making WorkOS-class path mandatory (BI-E2A4F3AA) |

### Sales / support

| Band | Pattern | Avoid |
| --- | --- | --- |
| All | Customer and ticket context first; CRM depth progressive | Enterprise CRM admin as first screen |
| Scaling | Shared inbox + clear ownership; no suite pipeline theater by default | Mandatory 12-stage pipeline for micro shops |

### Field / frontline

| Band | Pattern | Avoid |
| --- | --- | --- |
| All | Mobile-first job: next task, navigate, complete, exception | Desktop ERP forms on phone |
| Scaling | Offline-tolerant captures; sync status plain language | Full desktop parity claim without UX proof |

### AI coworker interaction

| Band | Pattern | Avoid |
| --- | --- | --- |
| All | Coworker proposes; human confirms high-blast acts | Silent production changes without evidence |
| Micro | Coworker is default operator assistant | Requiring prompt-engineering skill |
| Scaling | Role-scoped tools and advice; no cross-tenant leakage | Dumping enterprise admin into chat |

## Cross-links to product work

| Concern | Pattern application |
| --- | --- |
| BI-COP-006 | Acceptance bar; fail if happy path violates role/size pattern |
| HCM / WFM self-service | Employee + manager rows |
| Accounting bridge UX | Accountant row + coexist authority map |
| Payroll outputs | Employee “my pay” + accountant filing bridge |
| Authority decisions | Owner/manager delegated lanes; never second policy home |
| Public narrative | Market vision may claim jobs done, not suite modules shipped |

## How to use this in a PR

1. Name the **primary role** and **size band** for the change.
2. Cite the matching pattern row (or add a row if a new role is truly required).
3. Show the happy path steps and which steps are coworker-executed.
4. If an enterprise control remains, justify progressive disclosure or optional advanced lane.

## Non-goals

- Not a pixel-level UI kit.
- Not a full competitive scorecard (BI-COP-001).
- Does not replace legal/compliance obligations; shields complexity of *interaction*, not accountability.
