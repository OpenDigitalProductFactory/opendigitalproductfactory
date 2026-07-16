# Connector Family Benchmark Scorecards (per-family, module-by-module)

**Date:** 2026-07-16
**Status:** Benchmark artifact (analysis only) — build-ready spec, not a build
**Backlog items (family series):** BI-INT-6C83D1, BI-INT-E76A95, BI-INT-8D4F72, BI-INT-F23BC6,
BI-INT-A5B9E3, BI-INT-C1D472, BI-INT-1AB7D8, BI-INT-2CE9F1, BI-INT-3DF4A2, BI-INT-47B8C3
**Builds on:** [`2026-07-16-connector-benchmark-coverage-matrix.md`](./2026-07-16-connector-benchmark-coverage-matrix.md)
(BI-INT-4E21A0, PR #3098 — the family-level coverage matrix + prioritization + canonical method).
**Design-grounding:** every DPF-coverage claim is grounded in the code cited in the Evidence column. Where the
code cannot answer, the cell says **"unknown from code"**; where the Make baseline is not verifiable from the
repo, the row says **"baseline unverified (Make external)"**. Invented coverage is worse than an honest gap.

---

## 0. What this is (and is not) — read first

This document is the **benchmark artifact**: the decision-light, credentials-free analysis layer that turns
the "benchmark" half of each `BI-INT-*` connector-family item into a concrete, module-by-module scorecard.
It is the *next level of detail* below the #3098 coverage matrix — that doc answered "per family, how much does
DPF have?"; this doc answers "per family, **which specific capability** is built / partial / missing, with the
file that proves it, and what is the cheapest next slice."

**This is NOT the build.** Three things are explicitly out of scope and gate any actual connector work:

1. **Building the connectors is separate work.** A scorecard row marked "missing → build X" is a spec, not an
   implementation. None of these rows change code.
2. **Functional verification needs live provider credentials.** Every "built" claim here is grounded in
   *source code presence* (adapter dir, client, matrix row), not in a live round-trip against the provider.
   Proving a connector actually reads Entra groups or Zendesk tickets requires real tenant credentials, which
   this analysis layer deliberately does not touch.
3. **Sequencing is the founder's A-vs-B call.** #3098 §4 offers Ordering A (breadth-of-SMB-parity) vs.
   Ordering B (MSP-wedge-depth). This doc does **not** re-litigate that; it spec's each family so that whichever
   family the founder picks first is build-ready.

The `integration-coverage-matrix.ts` file remains the machine-readable single source of truth; each family's
benchmarked rows should ultimately land there (with `nextBacklogItemId` → the family BI). This doc is the
narrative scorecard that precedes that landing.

### 0.1 Coverage vocabulary (used in every scorecard)

- **built** — a real native adapter directory exists under `apps/web/lib/integrate/<vendor>/` (client +
  usually connect-action + preview), OR a first-class native runtime (`services/adp/`), OR a DPF-native
  substrate that fully owns the capability.
- **partial / thin** — an adapter exists but is a stub (e.g. Entra snapshot read only), OR a DPF-native spine
  covers the capability internally but there is no external connector, OR only a read slice of a broader
  capability is present.
- **missing** — no adapter, no native substrate for this capability; at most a benchmark row
  (`kind: "benchmark"`) or a `credentialProvider` catalog key with no adapter behind it.

### 0.2 Correction to #3098's substrate counts (grounded re-count)

Two counts in #3098 §2 are refined here from a direct re-read of the code, in the honesty spirit of that doc:

- **`INTEGRATION_COVERAGE_MATRIX` is 13 native + 9 benchmark = 22 rows** (not "14 native + 8 benchmark").
  Native rows: quickbooks, stripe, adp, microsoft365, hubspot, google-marketing, google-business-profile,
  facebook-lead-ads, facebook-pages, mailchimp, linkedin-personal-social, linkedin-ads, email-postmark.
  Benchmark rows: xero, gusto, salesforce, slack, zendesk, shopify, servicenow, jira-service-management,
  microsoft-intune. (`integration-coverage-matrix.ts:106-608`.)
- **Estate discovery is 8 collectors, not "unifi + 1 future".** `packages/db/src/discovery-collectors/`
  ships `arp-scan`, `docker`, `host`, `kubernetes`, `network`, `prometheus`, `snmp`, `unifi` — a materially
  deeper native estate path than #3098's RMM row credited. This raises the honest floor of the RMM/endpoint
  family (see §9).
- **Adapter-dir vs. catalog divergence:** `entra`, `whatsapp-business`, and `instagram-business` have real
  adapter directories under `apps/web/lib/integrate/` but are **not** in `NATIVE_INTEGRATIONS`
  (`native-integration-catalog.ts:37-268`, 13 entries). So the "13 native catalog entries" and the "adapter
  directories on disk" are two different sets — a truth-in-labeling nuance that matters when counting coverage.

---

## 1. Family scorecards

Each scorecard's "Make baseline capability/module" column is stated at the **capability granularity the BI body
actually provides** (the module *counts* are external Make signals; the capability *areas* — user/group
lifecycle, ticket lifecycle, etc. — come from the BI bodies). Per-module name lists are **not** invented; where
Make's exact module inventory is not in the item body or the repo, the row is flagged
"baseline unverified (Make external)".

---

### 1.1 Identity & directory — BI-INT-6C83D1

**Make baseline (from BI body):** Microsoft Entra ID (12 modules, Enterprise app), Google Workspace Admin
(23 modules). BI focus: user/group lifecycle, onboarding/offboarding, membership lookup, admin consent,
generic API fallback. Exact per-module lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Tenant / organization read | **built (thin)** | `apps/web/lib/integrate/entra/directory-client.ts` — `GET /v1.0/organization?$select=id,displayName,verifiedDomains` | Only snapshot read; no connect-action/preview/grant wiring. Promote to a first-class adapter + `NATIVE_INTEGRATIONS` entry. |
| User list / read | **partial** | `entra/directory-client.ts` — `GET /v1.0/users?$top=25&$select=id,displayName,userPrincipalName,accountEnabled` | Capped at top-25 snapshot; no paging, no per-user detail, no `$filter`. Add paging + single-user lookup. |
| Group list / read | **partial** | `entra/directory-client.ts` — `GET /v1.0/groups?$top=25&$select=id,displayName,mailEnabled,securityEnabled` | Top-25 snapshot only. Add paging + group detail. |
| Membership lookup (user↔group) | **missing** | none (client fetches users and groups separately, never `/members` or `/memberOf`) | Add `GET /groups/{id}/members` + `/users/{id}/memberOf`. This is the BI's named focus and is absent. |
| User lifecycle write (create/enable/disable) — onboarding/offboarding | **missing** | none (client is read-only; no connect-action) | Governed write-back path (create user, disable on offboard); replacement-gated. |
| Group membership write (add/remove) | **missing** | none | Governed write; the operate half of onboarding/offboarding. |
| Admin consent / app-role assignment | **missing** | none | Admin-consent flow + scope wiring (shares M365 auth per #3098). |
| Google Workspace Admin (users/groups/OUs) | **missing** | `supported-integrations-manifest.ts:102-109` — `google-workspace` is a `credentialProvider` key only, no adapter dir | Greenfield adapter; the second Make identity anchor is entirely unbuilt. |
| Generic API fallback (SCIM/LDAP) | **missing** | none (`integration-shared` has OAuth/credential primitives but no SCIM/LDAP client) | Framework-first generic identity connector; leans on `packages/integration-shared`. |

**Coverage:** built 1 · partial 2 · missing 6 (of 9 capability rows). Basis: Entra snapshot adapter is real
but stub-grade; Google Workspace Admin and all write/membership/consent capability is absent.

**Target-parity definition:** Identity is benchmarked-complete when DPF can, for **both** Entra ID and Google
Workspace Admin, read the full user and group directory (paged, not a top-25 snapshot), resolve
user↔group membership in both directions, and drive governed onboarding/offboarding as named Actions (create /
enable / disable user, add / remove group membership) behind the family replacement gate — with a generic
SCIM/LDAP fallback for tenants on neither anchor. Read-first; every write is an approval-governed Action.

**Minimal first connector slice:** Add **membership lookup on the existing Entra client** —
`GET /groups/{id}/members` and `GET /users/{id}/memberOf` on top of `entra/directory-client.ts`. It is the
cheapest module (reuses the built Graph auth + fetch), directly closes the BI's named "membership lookup" gap,
and unlocks onboarding/offboarding reasoning without any write scope.

---

### 1.2 CRM & sales — BI-INT-E76A95 (in-progress)

**Make baseline (from BI body):** HubSpot CRM (121 modules), Salesforce (17). Anchors named: HubSpot,
Salesforce, Facebook Lead Ads, Google Business Profile, Mailchimp. Posture hybrid; maturity target read. Module
lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| HubSpot account / company read | **built** | `apps/web/lib/integrate/hubspot/*`; `native-integration-catalog.ts:125-138` ("Account context") | Deepen entity families below. |
| HubSpot contacts read | **built** | `integrate/hubspot/*` ("Contact context") | — |
| HubSpot lead-capture forms | **built** | `integrate/hubspot/*` ("Lead form context") | — |
| Lead capture (Facebook Lead Ads) | **built** | `apps/web/lib/integrate/facebook-lead-ads/*`; matrix `facebook-lead-ads` | Lead triage/routing into CRM workflow (matrix note). |
| Deals / opportunities / pipeline | **missing** | none (HubSpot adapter is account/contact/form; no deals object) | Add pipeline/opportunity read — the BI acceptance names opportunities/quotes/sales-orders. |
| Quotes / sales orders | **partial** | DPF-native surfaces `/customer/quotes`, `/customer/sales-orders` exist (BI body) but not sourced from HubSpot | Map native quote/order objects to HubSpot deals; governed sync. |
| Campaign / marketing touchpoints | **built (adjacent)** | Mailchimp `integrate/mailchimp/*`, GBP `integrate/google-business-profile/*`, Postmark/LinkedIn matrix rows | Adjacent revenue tooling; already read-covered, not core CRM entity. |
| Salesforce (accounts/contacts/opportunities) | **missing** | `supported-integrations-manifest.ts:69-75` (`salesforce` credentialProvider key only); matrix `salesforce-crm-benchmark` (benchmark) | Benchmark-only; greenfield adapter for the second anchor. |
| CRM write-back (create/update contact, log activity) | **missing** | none (all CRM rows are `maturity: read`) | Approval-governed write behind the replacement gate. |

**Coverage:** built 4 · partial 1 · missing 4 (of 9). Basis: HubSpot anchor real (account/contact/form),
Salesforce and pipeline/deal objects absent.

**Target-parity definition:** CRM is benchmarked-complete when the HubSpot anchor reads the full deal/pipeline
object graph (not just account + contact + form) and maps leads → contacts → opportunities → quotes →
sales-orders → campaign touchpoints onto DPF's `/customer` surfaces, with Salesforce reaching read-parity as
the second anchor and every write (create contact, log activity, advance stage) governed as an Action. Per the
BI, DPF orchestrates pipeline/customer context before claiming CRM system-of-record ownership beyond proven
entity families.

**Minimal first connector slice:** Add **HubSpot deals/pipeline read** to the existing HubSpot adapter. It is
incremental on a built connector (reuses the HubSpot OAuth + client), and closes the single biggest CRM entity
gap (opportunities) that the BI acceptance explicitly requires.

---

### 1.3 Communications — BI-INT-8D4F72 (in-progress)

**Make baseline (from BI body):** Microsoft 365 Email / Outlook (15 modules), Microsoft Teams (26), Slack (46),
Gmail (10). Anchors named incl. WhatsApp Business. Posture integration-led; maturity target read. Module lists =
baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| M365 mailbox / inbox read | **built** | `apps/web/lib/integrate/microsoft365-communications/communications-client.ts` — `/users/{id}/mailFolders/Inbox/messages?$top=5` | Paging beyond top-5; folder coverage beyond Inbox. |
| M365 calendar read | **built** | same client — `/users/{id}/calendar/events?$top=5` | Paging; event detail. |
| Teams (joined teams + channels) read | **built** | same client — `/users/{id}/joinedTeams`, `/teams/{id}/channels`, channel messages | Broaden beyond first-team/first-channel snapshot. |
| WhatsApp Business messaging | **built** | `apps/web/lib/integrate/whatsapp-business/*` (client + connect-action + preview) | Present on disk; not in `NATIVE_INTEGRATIONS` catalog — wire it in. |
| Instagram Business messaging | **built** | `apps/web/lib/integrate/instagram-business/*` | Same catalog-wiring gap. |
| Slack (channels/messages/users) | **missing** | `supported-integrations-manifest.ts:77-84` (`slack` key only); matrix `slack-communications-benchmark` (benchmark) | Slack is Make's broadest comms app (46); greenfield adapter. |
| Gmail standalone read | **missing** | none (M365 covers the tenant mail axis; Gmail not adapter-backed) | Greenfield or fold into Google Workspace identity adapter. |
| Outlook standalone (non-M365-tenant) | **partial** | M365 client covers the tenant axis; no standalone Outlook | Likely subsumed by M365; confirm with founder. |
| Send / write-back (mail, chat message) | **missing** | none (comms rows are `maturity: read`; Postmark send is marketing-scoped) | Governed send behind dual-run + compliance boundary (BI replacement gate). |
| Polling / webhook readiness | **unknown from code** | preview/connect exist but webhook-subscription wiring not confirmed in this pass | Confirm Graph change-notification subscriptions; add if absent. |

**Coverage:** built 5 · partial 1 · missing 3 · unknown 1 (of 10). Basis: M365 (mail/calendar/Teams) +
WhatsApp + Instagram are real adapters; Slack and Gmail absent; webhook readiness unverified.

**Target-parity definition:** Communications is benchmarked-complete when DPF reads messages/calendar/channels
across the M365 tenant axis **and** Slack + Gmail (paged, not top-5 snapshots), with WhatsApp/Instagram wired
into the native catalog, polling/webhook change-notification readiness proven, and any send/write governed
behind the BI's dual-run + compliance boundary. Tenant mail/calendar/chat stay external systems of record.

**Minimal first connector slice:** **Wire WhatsApp Business + Instagram Business into `NATIVE_INTEGRATIONS`**
(and matrix rows). Both adapters already exist on disk with connect-action + preview; the only gap is catalog
registration — near-zero build cost that immediately converts two "built-but-invisible" adapters into counted
coverage.

---

### 1.4 HR & payroll — BI-INT-F23BC6

**Make baseline (from BI body):** BambooHR (20 modules), ADP Workforce Now (9). Gusto named as later. Posture
integration-led; maturity target read. Module lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| ADP worker lookup / profile | **built** | `apps/web/lib/integrate/adp/*` + dedicated runtime `services/adp/`; `native-integration-catalog.ts:38-52` ("Worker lookup") | Deepest *infra* of any family (own service + harness fixtures). |
| ADP pay statement context | **built** | `native-integration-catalog.ts:49` ("Pay statement context") | — |
| ADP time card context | **built** | `native-integration-catalog.ts:49` ("Time card context") | — |
| ADP deduction / payroll guidance | **built** | `native-integration-catalog.ts:49` ("Deduction questions", "Payroll guidance") | Read-first; write stays provider-led. |
| Onboarding / offboarding (worker create/terminate) | **missing** | none (ADP catalog is read context; no write) | Governed lifecycle Action; ties to identity family (§1.1). |
| Time off / leave requests | **missing** | none | Read then governed request; BI acceptance names time/leave. |
| Requisition / hiring | **missing** | none | Greenfield. |
| BambooHR (worker/HRIS) | **missing** | none (no adapter, no catalog key) | Make's larger HR anchor (20) is entirely unbuilt. |
| Gusto (payroll) | **missing** | matrix `gusto-payroll-benchmark` (benchmark) | Benchmark-only; deferred per BI ("Gusto later"). |
| Payroll execution write-back | **missing** | none; matrix `adp-workforce-now` posture `integration-led`, replacement note keeps payroll provider-led | Stays provider-led until compliance/tax/payroll-control evidence (BI gate). |

**Coverage:** built 4 · partial 0 · missing 6 (of 10). Basis: ADP read anchor is real and infra-deep;
BambooHR/Gusto and all lifecycle/leave/write capability absent.

**Target-parity definition:** HR/payroll is benchmarked-complete when the ADP anchor exposes worker + payroll +
time/leave read context mapped into the employee-work taxonomy, BambooHR reaches read-parity as the second
anchor, onboarding/offboarding and leave requests exist as governed Actions (shared with identity lifecycle),
and payroll execution stays explicitly provider-led until compliance/tax/payroll-control evidence is modeled.

**Minimal first connector slice:** Add **ADP time-off / leave read** to the existing ADP runtime. It reuses the
built `services/adp/` credential custody + harness, and is the cheapest capability the BI acceptance names
("time/leave") that is not yet present.

---

### 1.5 Finance / billing / payments — BI-INT-A5B9E3 (in-progress)

**Make baseline (from BI body):** QuickBooks (93 modules), Xero (96), Stripe (42). QuickBooks + Stripe earliest
native-first; Xero close behind. Posture hybrid; maturity target read; writes approval-governed. Module lists =
baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| QuickBooks company / customers / invoices | **built** | `apps/web/lib/integrate/quickbooks/*`; readiness entity families `company, customers, invoices` (`quickbooks/readiness.ts:22-35`) | Deepest adapter (12 entity families, import-staging). |
| QuickBooks vendors / bills / expenses / payments | **built** | `quickbooks/readiness.ts:22-35` (`vendors, bills, expenses, payments`) | — |
| QuickBooks accounts / bank transactions / reports | **built** | `quickbooks/readiness.ts:22-35` (`accounts, bank_transactions, reports`) | — |
| QuickBooks tax / accountant workflow | **built (staged)** | `quickbooks/readiness.ts:22-35` (`tax, accountant_workflow`) | Gated capabilities in readiness template. |
| Stripe balance / customers / invoices / payment-intents | **built** | `apps/web/lib/integrate/stripe/*`; `native-integration-catalog.ts:95-108` | Read anchor; reconciliation dependency (matrix note). |
| Xero (accounting read breadth) | **missing** | `supported-integrations-manifest.ts:34-41` (`xero` key only); matrix `xero-accounting-benchmark` (benchmark) | Benchmark-only; Make's largest finance app (96). Third anchor unbuilt. |
| Reconciliation (payments ↔ invoices) | **partial** | matrix `stripe-payments` replacement note requires reconcile before local billing becomes primary; not a built reconcile engine | Build the reconcile evidence path (BI gate for write). |
| Import staging / non-editable posture | **built** | `quickbooks/import-staging.ts`; readiness `importReview` families | Extend staging to Stripe/Xero. |
| Write-back (create invoice, record payment) | **missing** | none (QB `maturity: stage`, Stripe `read`) | Approval-governed write behind reconciliation + rollback/export evidence (BI gate). |

**Coverage:** built 6 · partial 1 · missing 2 (of 9). Basis: QuickBooks (12 entity families) + Stripe are the
deepest built pair in any family; Xero and reconciliation/write-back are the remaining gaps.

**Target-parity definition:** Finance is benchmarked-complete when QuickBooks + Stripe read coverage is
matched by Xero as the third anchor, reconciliation (payments↔invoices) produces auditable evidence, import
staging spans all three providers, and write-back (invoice, payment) is promotable only after read + import
staging + reconciliation + rollback/export evidence clears the BI's approval gate.

**Minimal first connector slice:** Add a **Xero read adapter scoped to the QuickBooks entity families**
(company, customers, invoices). It reuses the proven QuickBooks import-staging/readiness pattern and the
`integration-shared` OAuth primitives, converting the largest benchmark-only finance app into a built anchor
cheaply.

---

### 1.6 Service desk & support — BI-INT-C1D472

**Make baseline (from BI body):** Jira Cloud Platform (40 modules), Freshservice (47), Zendesk (55),
Freshdesk (31). Focus: ITSM/ticket lifecycle, requesters/users, comments, attachments, workflow states,
webhook/polling. Module lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Ticket lifecycle (create/read/update/close) | **partial** | DPF-native `WorkQueue` + `/workspace/my-queue` is the internal alternative (matrix `zendesk-support-benchmark` surfaces) | Native queue ≠ external ticket connector. Decide sync-vs-replace. |
| Requesters / users | **missing** | none (no Zendesk/Freshservice/Jira SM adapter dir) | Greenfield; map to DPF customer/employee records. |
| Comments / conversation | **partial** | native queue has activity; no external comment sync | Add comment read from chosen anchor. |
| Attachments | **missing** | none | Greenfield. |
| Workflow states / SLA | **partial** | native queue has states; SLA modeling not connector-sourced | Map external states → native queue states. |
| Zendesk (support) | **missing** | `supported-integrations-manifest.ts:111-118` (`zendesk` key only); matrix `zendesk-support-benchmark` (benchmark, posture `replacement-candidate`) | Make's broadest support app (55); greenfield. |
| Jira Service Management | **missing** | matrix `jira-service-management-benchmark` (benchmark) | Greenfield. |
| Freshservice / Freshdesk | **missing** | none | Greenfield. |
| ServiceNow (ITSM reference) | **missing** | matrix `servicenow-service-management-benchmark` (benchmark, `replacement-candidate`) | CSDM reference, not a verbatim build target (matrix note). |
| Webhook / polling readiness | **missing** | none | Framework-first ingestion. |

**Coverage:** built 0 · partial 3 · missing 7 (of 10). Basis: DPF runs a native work-queue spine but has
**zero external service-desk connectors**; all named Make anchors are benchmark/catalog-key only.

**Target-parity definition:** Service desk is benchmarked-complete when DPF can ingest the ticket lifecycle
(tickets, requesters, comments, attachments, workflow states, SLA) from at least one external anchor
(Zendesk or Jira SM) into the native `WorkQueue` spine via webhook/polling, with the sync-vs-replace boundary
made explicit per install — and lightweight native support becomes primary only after intake/SLA/assignment/
knowledge/customer-portal coverage is native (matrix `zendesk` replacement gate).

**Minimal first connector slice:** **Zendesk ticket read → `WorkQueue` ingestion** (tickets + requesters +
status, no write). Zendesk is the broadest Make support app and the matrix already carries it as the support
anchor; read-into-queue is the cheapest slice that proves the sync path without touching write.

---

### 1.7 Project & work management — BI-INT-1AB7D8

**Make baseline (from BI body):** ClickUp (96 modules), Asana (90), monday.com (54), Trello (109 visible).
Posture `native_dpf`; maturity target **operate**. Module lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Tasks (create/read/update) | **built (native)** | DPF-native spine: `WorkQueue`, `/portfolio/backlog`, `/build` (BI body; posture `native_dpf`) | Native is the system of record; external is sync, not source. |
| Projects | **built (native)** | `/portfolio/backlog`, Build Studio spine | — |
| Dependencies | **partial** | native backlog/build has dependency modeling; not external-sourced | Import external dependency edges on sync. |
| Comments | **partial** | native queue/backlog activity; no external comment sync | Add on sync. |
| Status sync | **missing** | none (no ClickUp/Asana/monday/Trello adapter dir) | Bidirectional status sync — the BI's `operate` maturity target. |
| ClickUp / Asana / monday / Trello connectors | **missing** | none; not in `SUPPORTED_INTEGRATIONS` or matrix (except ServiceNow as CSDM ref) | Greenfield sync connectors, framework-first. |
| Governed write-back to external tool | **missing** | none | Per BI: external stays integration-led until DPF proves import/mapping/sync. |

**Coverage:** built 2 (native) · partial 2 · missing 3 (of 7). Basis: DPF's own work/backlog/build spine is
strong and is the declared system of record; **no external project connectors exist** — deliberately low
priority per `native_dpf` posture.

**Target-parity definition:** Project/work management is benchmarked-complete when DPF can import external
tasks/projects/dependencies/comments/statuses from at least one anchor (ClickUp or Asana) into the native
queue/backlog spine and sync status bidirectionally (the `operate` target), with a clear per-row statement of
which work is native-DPF, which external tools are synchronized, and which fields allow governed write-back —
the native spine staying system of record.

**Minimal first connector slice:** **Asana task read → `/portfolio/backlog` mapping** (tasks + status, one
direction). It exercises the import/mapping semantics the BI names as the prerequisite before sync, on the
strong native spine, without committing to write-back.

---

### 1.8 Documentation & knowledge — BI-INT-2CE9F1

**Make baseline (from BI body):** Notion (30 modules), Confluence (15), Google Drive, Google Docs (13), and
adjacent Google Workspace surfaces. Focus: durable document/page/file object-level sync. Module lists =
baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Pages / documents (read) | **partial (native)** | DPF-native wiki/docs substrate `apps/web/lib/wiki/*` (internal knowledge) | Native covers internal need; no external doc connector. |
| Notion (pages/databases) | **missing** | none (no adapter, no catalog key) | Make's broadest docs app (30); greenfield object-level sync. |
| Confluence (spaces/pages) | **missing** | none | Greenfield. |
| Google Drive / Docs (files) | **missing** | none; `google-workspace` credentialProvider key only (`supported-integrations-manifest.ts:102-109`) | Greenfield; fold into Google Workspace adapter. |
| CMDB / assets (IT Glue / Hudu) | **missing** | none | MSP-CMDB overlap (§1.10); framework-first. |
| Object-level page/file sync | **missing** | none | The BI's explicit ask (object-level, not file movement). |
| Governed write-back (publish/update page) | **missing** | none | Behind replacement gate. |

**Coverage:** built 0 · partial 1 (native) · missing 6 (of 7). Basis: DPF-native wiki covers the internal docs
need; **no external documentation connectors** exist.

**Target-parity definition:** Documentation is benchmarked-complete when DPF can sync durable
document/page/file objects (not just move files) from at least one anchor (Notion or Google Drive/Docs) into a
knowledge index alongside the native wiki, with object-level identity preserved and governed write-back
(publish/update) gated — best served by the generic-connector factory once the marketplace layer is seeded
(#3098 unknown #4).

**Minimal first connector slice:** **Notion page read → knowledge index** (pages + basic properties, no
write). Notion is the broadest Make docs app; a read-only object-level pull proves the durable-sync semantics
the BI requires and rides the `integration-shared` OAuth primitives.

---

### 1.9 Device / endpoint / RMM — BI-INT-3DF4A2

**Make baseline (from BI body):** Microsoft Intune (2 modules, partner-supported) — explicitly flagged as a
thin ecosystem; BI directs **framework-first + generic API fallback**, not broad first-party coverage. Module
lists = baseline unverified (Make external).

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Network / gateway estate discovery | **built (native)** | `packages/db/src/discovery-collectors/unifi.ts`, `network.ts`, `arp-scan.ts`, `snmp.ts` | 8-collector estate path (see §0.2), deeper than #3098 credited. |
| Host / container / orchestration discovery | **built (native)** | `discovery-collectors/host.ts`, `docker.ts`, `kubernetes.ts` | Native estate, not a vendor RMM connector. |
| Metrics / telemetry ingest | **built (native)** | `discovery-collectors/prometheus.ts` | — |
| Device fingerprinting / classification | **built (native)** | `packages/db/src/device-catalog.ts` (Fingerbank-style placement); `DiscoveryConnection` model (`schema.prisma`) | Quantify device-class/rule count (#3098 unknown #6). |
| Microsoft Intune (device posture) | **missing** | matrix `microsoft-intune-benchmark` (benchmark, `provider-led`) | Consume posture/evidence signals, not manage (matrix note). |
| Vendor RMM (NinjaOne / Datto / ConnectWise RMM) | **missing** | `supported-integrations-manifest.ts:119-126` (`ninjaone` key only); no adapter | Framework-first generic connector; intentionally deferred. |
| Endpoint action / remediation write | **missing** | none | Provider-led; DPF consumes signals. |

**Coverage:** built 4 (native estate) · partial 0 · missing 3 (of 7). Basis: DPF's **native estate-discovery
path is materially built** (8 collectors + fingerprint catalog); vendor RMM is 0% and deliberately framework-
deferred per the BI.

**Target-parity definition:** Device/endpoint is benchmarked-complete when the native estate-discovery path
(network + host + container + fingerprint) is complemented by a generic RMM/endpoint connector that *consumes*
device-posture and evidence signals from Intune / NinjaOne-class providers (read/observe), with remediation
actions staying provider-led. Broad first-party RMM coverage is explicitly a non-goal (thin Make ecosystem).

**Minimal first connector slice:** **Extend estate discovery with one more collector (Meraki or FortiGate)**
following the `unifi.ts` collector pattern. It is the cheapest capability-adding module (proven collector shape,
no new framework) and matches #3098's Ordering-A rank-6 recommendation to grow estate discovery over vendor RMM.

---

### 1.10 MSP-specific overlay — BI-INT-47B8C3

**Make baseline (from BI body):** Halo appears as a **community** app on Make; ConnectWise, Autotask, NinjaOne,
IT Glue, Hudu, Datto RMM were **not verified from official/public Make pages** in the source pass →
**baseline unverified (Make external)** for the whole vendor stack. BI directs framework-first, evidence-driven,
no overfitting to one vendor. MSP is a cross-cutting overlay, not one of the 10 codified domains.

| Make baseline capability/module | DPF current coverage | Evidence (file path or "none") | Gap → work to reach parity |
| --- | --- | --- | --- |
| Estate / device discovery (MSP-adjacent) | **built (native)** | `discovery-collectors/*` (8 collectors), `device-catalog.ts` | Only built MSP-adjacent path; shared with §1.9. |
| PSA — ConnectWise / Autotask / HaloPSA | **missing** | none; classifier `MSP_RELEVANT_TOKENS` recognizes the tokens (`integration-benchmarking.ts:180-199`) but no adapter | Framework-first generic connector via `integration-shared`; ride the factory. |
| RMM — NinjaOne / Datto RMM | **missing** | `ninjaone` credentialProvider key only; no adapter | Shared with §1.9; deferred. |
| CMDB / documentation — IT Glue / Hudu | **missing** | none | Shared with §1.8 docs family; framework-first. |
| Ticketing (MSP helpdesk) | **missing** | none; native `WorkQueue` is the internal alternative | Shared with §1.6 service-desk. |
| Generic MSP connector framework | **partial** | `packages/integration-shared/*` (credential-crypto, oauth-refresh, client-credentials, tool-call-audit) + `services/integration-test-harness/` (vendors: adp, quickbooks) | Framework primitives built; no MSP vendor wired through them yet. |

**Coverage:** built 1 (native estate) · partial 1 (framework) · missing 4 (of 6). Basis: MSP is intentionally
last / evidence-driven; only estate discovery + the shared connector framework exist. Make baseline for the PSA/
RMM/CMDB vendors is **unverifiable from code** (and was unverified from Make in the source pass).

**Target-parity definition:** MSP is benchmarked-complete when the generic-connector factory
(`integration-shared` + test harness) has proven at least one PSA (ConnectWise or HaloPSA) and one CMDB
(IT Glue or Hudu) as *evidence-driven* read connectors reusing the same primitives — not a bespoke stack per
vendor — layered on the built native estate-discovery path, with the MSP overlay flagging cross-cut coverage
rather than owning a domain. Deliberately sequenced last (#3098 Ordering A rank —).

**Minimal first connector slice:** **Run one MSP vendor (HaloPSA read) through the existing
`services/integration-test-harness/` vendor-contract pattern** (which today carries only adp + quickbooks
fixtures). It proves the framework-first thesis with the least new surface and produces the evidence the BI
demands before any broader MSP investment.

---

## 2. Per-family coverage summary (one line each)

Counts are of the capability rows defined in each scorecard (built / partial / missing). "Native" = DPF-native
substrate counted as built/partial where it owns the capability. Basis is source-code presence, not live
verification.

| Family | BI | built | partial | missing | unknown | Basis |
| --- | --- | --- | --- | --- | --- | --- |
| Identity & directory | BI-INT-6C83D1 | 1 | 2 | 6 | 0 | Entra snapshot stub real; membership/write/Google-WS absent |
| CRM & sales | BI-INT-E76A95 | 4 | 1 | 4 | 0 | HubSpot anchor real; deals/Salesforce absent |
| Communications | BI-INT-8D4F72 | 5 | 1 | 3 | 1 | M365+WhatsApp+Instagram built; Slack/Gmail absent; webhook unknown |
| HR & payroll | BI-INT-F23BC6 | 4 | 0 | 6 | 0 | ADP read anchor deep; BambooHR/lifecycle absent |
| Finance/billing/payments | BI-INT-A5B9E3 | 6 | 1 | 2 | 0 | QuickBooks(12 families)+Stripe deep; Xero/write absent |
| Service desk & support | BI-INT-C1D472 | 0 | 3 | 7 | 0 | Native queue only; zero external connectors |
| Project & work management | BI-INT-1AB7D8 | 2 | 2 | 3 | 0 | Native spine strong; zero external connectors |
| Documentation & knowledge | BI-INT-2CE9F1 | 0 | 1 | 6 | 0 | Native wiki only; zero external connectors |
| Device/endpoint/RMM | BI-INT-3DF4A2 | 4 | 0 | 3 | 0 | Native estate (8 collectors) built; vendor RMM absent |
| MSP overlay | BI-INT-47B8C3 | 1 | 1 | 4 | 0 | Estate + framework only; vendor stack absent |

**Families where the Make baseline was unverifiable from code (module lists external to the repo):** **all
ten.** Every Make module count originates from the BI bodies / external Make pages, not from anything in the
codebase — consistent with #3098 unknown #1. The MSP family (BI-INT-47B8C3) is doubly unverified: its vendor
stack was **not even confirmed from Make** in the source pass.

**Minimal-first-slice per family (build-ready, cheapest module that moves coverage):**

1. **Identity** — Entra membership lookup (`/groups/{id}/members`, `/users/{id}/memberOf`) on the existing client.
2. **CRM** — HubSpot deals/pipeline read on the existing HubSpot adapter.
3. **Communications** — wire the already-built WhatsApp + Instagram adapters into `NATIVE_INTEGRATIONS`.
4. **HR/payroll** — ADP time-off / leave read on the existing ADP runtime.
5. **Finance** — Xero read adapter scoped to the QuickBooks entity families (company/customers/invoices).
6. **Service desk** — Zendesk ticket read → `WorkQueue` ingestion.
7. **Project/work** — Asana task read → `/portfolio/backlog` mapping.
8. **Documentation** — Notion page read → knowledge index.
9. **Device/RMM** — one more estate collector (Meraki/FortiGate) on the `unifi.ts` pattern.
10. **MSP** — HaloPSA read through the existing `integration-test-harness` vendor-contract pattern.

---

## 3. Carried-forward unknowns (from #3098 §6 — not resolved here)

These are #3098's seven open unknowns, carried verbatim in intent; this scorecard pass did **not** silently
resolve any of them, and several are reconfirmed by the module-by-module read above.

1. **Make module counts unverified from code** — reconfirmed; all ten families flagged
   "baseline unverified (Make external)" (§2).
2. **`cloud_m365_google_security` has no dedicated family BI** — still open; it is a codified benchmark domain
   with no `BI-INT-*` sibling (identity §1.1 + communications §1.3 cover fragments of it).
3. **A/B prioritization is a business-strategy call** — untouched; this doc spec's every family so either
   ordering is build-ready, but does not choose.
4. **Marketplace layer unseeded** — still open; whether generic-connector availability counts as coverage
   gates the documentation (§1.8) and MSP (§1.10) families most.
5. **`SUPPORTED_INTEGRATIONS` credential-key-only entries are ambiguous** — reconfirmed at row granularity:
   salesforce (§1.2), slack (§1.3), xero (§1.5), zendesk (§1.6), ninjaone (§1.9/§1.10), google-workspace
   (§1.1/§1.8) are all "key only, no adapter" — counted as **missing**, not partial, pending the founder call.
6. **RMM/endpoint depth beyond UniFi unverified** — partially advanced (§0.2 found 8 collectors, not 1) but
   the device-class / fingerprint-rule count in `device-catalog.ts` is still unquantified.
7. **Coverage % are estimates, not measured parity** — still true; the built/partial/missing counts here are a
   capability-row census, not a live parity harness. No automated Make-vs-DPF parity harness exists.

---

## 4. Next step

Each family scorecard is now build-ready at the module level. The recommended sequence-independent next action
is: on the founder's §4 (of #3098) A-vs-B ordering decision, take the chosen rank-1 family's **minimal first
slice** (§2 list above), file/land it as rows in `integration-coverage-matrix.ts` (with the family BI as
`nextBacklogItemId`), and only then begin the connector build — which needs live provider credentials to
functionally verify and is out of scope for this analysis layer.

---

*Generated with Claude Code.*
