# WorkOS-Equivalence Scorecard and DPF Ownership Matrix

**Status:** living internal scorecard for company IAM foundation work  
**Backlog:** BI-E2A4F3AA / EP-COMPANY-IAM-FOUNDATION  
**Related:** BI-COP-005 (edge-adapter-to-native), BI-COP-006 (complexity shield), authentik/identity edge specs, MCP auth runbooks

## Purpose

Compare **DPF-native**, **authentik** (or equivalent open IdP), **WorkOS-class hosted acceleration**, and **customer-provided IdP** coverage across AuthKit-style login, SSO, SCIM, Directory Sync, RBAC/FGA, Admin Portal, Audit Logs, MCP Auth, Vault/token custody, MFA/passkeys, domain policies, and setup UX.

Use this matrix when deciding **build vs buy vs bridge** for identity work. It is not a public competitive claim sheet.

## Ownership classes (closed set)

Every capability row must use **exactly one** primary class:

| Class | Meaning |
| --- | --- |
| **DPF-owned core** | Canonical product behavior every install gets without a third-party commercial IdP |
| **Identity-edge adapter** | Bridge to external IdP / directory / SSO broker; DPF remains the company policy surface where possible |
| **Optional hosted acceleration** | Hosted vendor (e.g. WorkOS-class) may speed enterprise SSO/SCIM for some tenants; not required for core product |
| **Non-goal** | Explicitly out of DPF product scope for this horizon |

Secondary notes may list a **bridge path** without changing the primary class.

## Scorecard axes

Columns:

1. **DPF-native** — what ships in-repo / in-portal without WorkOS.
2. **Open IdP edge (authentik-class)** — self-hosted edge DPF can operate or document.
3. **Hosted acceleration (WorkOS-class)** — optional commercial acceleration.
4. **Customer-provided IdP** — customer brings Okta/Entra/etc.; DPF is SP / relying party.

Cell values: `own` | `adapter` | `optional` | `non-goal` | `partial` (with note).

## Capability matrix

| Capability | DPF-native | Open IdP edge | Hosted acceleration | Customer IdP | Primary class | Build / buy rationale |
| --- | --- | --- | --- | --- | --- | --- |
| AuthKit-style login UX (email/password + social entry) | own | adapter | optional | adapter | **DPF-owned core** | Owner and employee login must work offline from commercial IdP tax |
| Enterprise SSO (SAML/OIDC SP) | partial | adapter | optional | adapter | **Identity-edge adapter** | Protocol correctness lives at the edge; DPF owns session + org binding |
| SCIM inbound provisioning | partial | adapter | optional | adapter | **Identity-edge adapter** | Directory of record often external; DPF owns local principal projection |
| Directory Sync (HRIS/IdP groups → roles) | partial | adapter | optional | adapter | **Identity-edge adapter** | Mapping policy is DPF; transport is edge |
| RBAC / capability grants (portal) | own | non-goal | non-goal | non-goal | **DPF-owned core** | Authorization is product substrate, not outsourced to WorkOS FGA |
| Fine-grained authorization (resource ACL) | own / partial | non-goal | optional | non-goal | **DPF-owned core** | Keep decisioning in DPF policy spine; avoid second FGA SoR |
| Admin Portal (user/org admin UX) | own | partial | optional | partial | **DPF-owned core** | Complexity-shielded owner admin stays in DPF |
| Audit logs (auth + admin actions) | own | partial | optional | partial | **DPF-owned core** | Compliance evidence must not vanish if edge vendor changes |
| MCP Auth (token issue, scope, grants) | own | non-goal | non-goal | non-goal | **DPF-owned core** | `dpfmcp_*` and tool grants are DPF coordination-plane contracts |
| Vault / token custody (secrets, OAuth tokens) | own | adapter | optional | adapter | **DPF-owned core** | Secrets custody is platform trust boundary |
| MFA / passkeys | partial | adapter | optional | adapter | **Identity-edge adapter** + **DPF-owned core** UX | Factors may be verified at edge; enrollment UX stays complexity-shielded |
| Domain policies (allow/deny email domains) | own | partial | optional | partial | **DPF-owned core** | Org policy belongs on `Organization` and platform config |
| Setup UX (first admin, invite, recovery) | own | adapter | optional | adapter | **DPF-owned core** | First-run must not require a sales engineer |

## Decision rules

1. **Never make WorkOS (or peer) the only path** to login, RBAC, audit, or MCP auth.
2. Prefer **DPF-owned core** when the operator job is common and the model is stable (see BI-COP-005 graduation).
3. Prefer **identity-edge adapter** when the customer already has a system of record for identities.
4. Use **optional hosted acceleration** only when it shortens enterprise SSO/SCIM time-to-value **and** a non-hosted path remains.
5. Mark **non-goal** rather than half-shipping enterprise suite admin chrome (BI-COP-006).

## Links to live work

| Area | Typical home |
| --- | --- |
| Company IAM epic | EP-COMPANY-IAM-FOUNDATION |
| Edge vs native | BI-COP-005 / `edge-adapter-to-native-convergence.md` |
| Complexity shield | BI-COP-006 / `complexity-shield-acceptance-standard.md` |
| MCP tool auth | `mcp-tool-authorization-runbook.md` |
| Organization identity | Organization canonical identity principle |

## Maintenance

- Update a row when a PR changes ownership class or ships a previously `partial` cell.
- Do not paste vendor marketing feature lists into public docs; cite digests per external planning-reference boundary (BI-A72CE946).
- Scorecard changes that expand **Non-goal** require epic-owner acknowledgement in the PR body.
