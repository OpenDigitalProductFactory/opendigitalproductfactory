# Connector Benchmark: Canonical Coverage Matrix + Prioritization Baseline

**Date:** 2026-07-16
**Status:** Baseline for founder confirmation — not a ratified priority order
**Backlog item:** BI-INT-4E21A0 ("Make benchmark inventory: canonical coverage matrix and prioritization baseline")
**Sibling family items:** BI-INT-3DF4A2, BI-INT-8D4F72, BI-INT-E76A95, BI-INT-F23BC6, BI-INT-2CE9F1, BI-INT-C1D472, BI-INT-1AB7D8, BI-INT-47B8C3, BI-INT-A5B9E3, BI-INT-6C83D1
**Design-grounding:** grounded in the DPF codebase substrate listed in §2; where the code cannot answer, this doc flags "unknown from code" rather than inventing coverage.

---

## 1. Purpose and scope

BI-INT-4E21A0 is the foundational item of the `BI-INT-*` connector-family series. It exists to answer one
question before any connector build is sequenced: **for each connector family that Make.com covers, what does
DPF already have, what is partial, and what is absent — measured against the actual codebase, not against a
wishlist.** The prioritization baseline here is the input the founder uses to decide which family items
(BI-INT-8D4F72, -A5B9E3, -E76A95, …) get built first.

The benchmark reference is Make.com's public integration surface (~3,467 apps) as captured in the family
items. Make module counts (e.g. Slack 46, HubSpot 121, QuickBooks 93) are used only as a *breadth signal* for
sequencing — DPF's posture is read-first and evidence-governed, so parity is measured in entity/read coverage
and governed write-back, not raw module count.

**This is a docs-only planning baseline.** It changes no code. It satisfies the Spec/Plan/Doc gate by
construction.

---

## 2. What actually exists — the DPF integration substrate (evidence)

DPF's integration coverage is spread across four distinct layers. Reading only one of them (as the
`search_integrations` MCP tool does — see below) understates coverage.

| Layer | Where it lives (evidence) | What it represents |
| --- | --- | --- |
| **Native adapters** | `apps/web/lib/integrate/<vendor>/` (client + connect-action + preview per vendor) | First-class connectors DPF built and maintains. |
| **Native catalog projection** | `apps/web/lib/tools/native-integration-catalog.ts` (`NATIVE_INTEGRATIONS`, 13 entries) | The catalog view of the native adapters, with agent/grant wiring. |
| **Coverage matrix (in code)** | `apps/web/lib/tools/integration-coverage-matrix.ts` (`INTEGRATION_COVERAGE_MATRIX`, 14 native + 8 benchmark rows) | An existing per-product coverage/posture/maturity matrix, already keyed to the `BI-INT-*` items via `nextBacklogItemId`. |
| **Portfolio "can-turn-on" manifest** | `packages/db/src/portfolio-sources/supported-integrations-manifest.ts` (`SUPPORTED_INTEGRATIONS`, 12 entries) | Curated set surfaced as portfolio coverage; some entries are adapter-backed, some are credential-provider keys only (no adapter yet). |
| **Generic connector marketplace** | `McpIntegration` Prisma model (`schema.prisma:9021`), synced from an external MCP registry via `apps/web/lib/actions/mcp-catalog.ts` | Dynamic, unbounded connector list. **Empty on a fresh install** and empty in this survey environment. |
| **Estate discovery collectors** | `DiscoveryConnection` model (`schema.prisma:10549`) + `packages/db/src/discovery-collectors/unifi.ts` + device-fingerprint catalog (`packages/db/src/device-catalog.ts`) | DPF-native estate/device discovery (network gateways + passive fingerprinting), *not* vendor RMM connectors. |
| **Connector-factory framework** | `packages/integration-shared/src/` (credential-crypto, oauth-refresh, client-credentials, redact, tool-call-audit) + `services/adp/` + `services/integration-test-harness/` | Shared connector primitives + multi-vendor contract harness. v1 is **built** (ADP + QuickBooks fixtures present). |
| **Benchmark classifier** | `apps/web/lib/integrate/integration-benchmarking.ts` (`getIntegrationBenchmarkMetadata`) | Maps any provider record → one of the 10 canonical benchmark domains + treatment + priority tier. |

### 2.1 The 10 canonical benchmark domains (already codified)

The family taxonomy is **not** something this doc invents — it is already the closed enum
`INTEGRATION_BENCHMARK_DOMAINS` in `integration-benchmarking.ts`:

```
hr_payroll · identity_directory · ticketing_service_desk · rmm_endpoint_device_management ·
documentation_knowledge_cmdb_assets · crm_sales · accounting_billing_payments ·
communications_email_chat · project_work_management · cloud_m365_google_security
```

Each maps 1:1 to a sibling `BI-INT-*` item (MSP is a cross-cutting overlay, not a domain — see §5). The
classifier also codifies three **DPF treatments** (`native_first_class`, `generic_connector`, `bundle_default`)
and three **priority tiers** (`p0_anchor`, `p1_expansion`, `p2_bundle`) — this doc's prioritization in §4
adopts that vocabulary rather than a parallel one.

### 2.2 Native adapters actually present in `apps/web/lib/integrate/`

Directories with a real client (most also have connect-action + preview):
`adp`, `quickbooks`, `stripe`, `microsoft365-communications`, `hubspot`, `google-marketing-intelligence`,
`google-business-profile`, `facebook-lead-ads`, `facebook-pages`, `mailchimp`, `whatsapp-business`,
`instagram-business`, `entra` (thin — `directory-client.ts` only, snapshot read; no connect/preview).

**Important truth-in-labeling:** `SUPPORTED_INTEGRATIONS` lists `xero`, `salesforce`, `slack`, `jira`,
`google-workspace`, `zendesk`, `ninjaone` with `credentialProvider` keys, **but none of these have an adapter
directory** under `apps/web/lib/integrate/`. They are catalog/portfolio placeholders, not built connectors.
The manifest's own header comment concedes this: the truthful "what can this business turn on" set is the
adapters DPF actually has.

### 2.3 Why `search_integrations` returned empty here

The `search_integrations` MCP tool queries the `McpIntegration` DB table (`discovery-pack.ts:163`), which is
the *external marketplace* layer and is unseeded on a fresh install. It does **not** read the native adapter
catalog or the in-code coverage matrix. So an empty result from that tool is **not** evidence of zero coverage —
it is evidence that this layer is unseeded. All coverage below is grounded in the static code layers instead.

---

## 3. Coverage matrix (per family)

Coverage % is a deliberate estimate against Make's read/entity breadth for the family's anchor apps, blending
adapter depth and posture maturity. It is a sequencing signal, **not** a precise parity measurement. Evidence
column cites the specific file / registry entry. "Benchmark-only" = a row exists in `INTEGRATION_COVERAGE_MATRIX`
with `kind: "benchmark"` (tracked, not built).

| # | Family (benchmark domain) | Sibling BI | Built (native adapter) | Partial / thin | Benchmark-only / missing | Coverage est. | Evidence basis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `accounting_billing_payments` | BI-INT-A5B9E3 | **QuickBooks** (deepest adapter: import-staging, readiness, connection-state), **Stripe** | — | Xero (catalog key only; benchmark row) | **~55%** | `integrate/quickbooks/*`, `integrate/stripe/*`; matrix rows `quickbooks-online-finance`, `stripe-payments`, `xero-accounting-benchmark` |
| 2 | `communications_email_chat` | BI-INT-8D4F72 (in-progress) | **Microsoft 365** (inbox/calendar/Teams/channels read), **WhatsApp Business**, **Instagram Business** | — | Slack (46, benchmark row), Gmail standalone, Outlook standalone (M365 covers the tenant axis) | **~40%** | `integrate/microsoft365-communications/*`, `integrate/whatsapp-business/*`, `integrate/instagram-business/*`; matrix `slack-communications-benchmark` |
| 3 | `crm_sales` | BI-INT-E76A95 (in-progress) | **HubSpot** (account/contacts/lead forms), lead-capture: **Facebook Lead Ads** | Marketing execution loop (Mailchimp, LinkedIn, Postmark, GBP) is adjacent revenue tooling, not core CRM | Salesforce (17, catalog key only; benchmark row) | **~40%** | `integrate/hubspot/*`, `integrate/facebook-lead-ads/*`; matrix `hubspot-crm-marketing`, `salesforce-crm-benchmark` |
| 4 | `hr_payroll` | BI-INT-F23BC6 | **ADP Workforce Now** (deepest *infra*: dedicated `services/adp/` runtime + harness fixtures) | — | BambooHR (20), Gusto — both benchmark/observe only | **~30%** | `integrate/adp/*`, `services/adp/`; matrix `adp-workforce-now`, `gusto-payroll-benchmark` |
| 5 | `identity_directory` | BI-INT-6C83D1 | — | **Entra ID** thin (`entra/directory-client.ts`: org/users/groups snapshot read only; no connect-action/preview; shares M365 auth) | Google Workspace Admin (23, catalog key only), SCIM/LDAP generic | **~20%** | `integrate/entra/directory-client.ts`; no matrix native row |
| 6 | `cloud_m365_google_security` | (no dedicated BI) | Partial via **M365** (comms + Entra) and **Google Marketing Intelligence** (GA4/Search Console) | — | Defender/security, Azure, Google Cloud, generic security posture | **~20%** | `integrate/microsoft365-communications/*`, `integrate/google-marketing-intelligence/*` |
| 7 | `rmm_endpoint_device_management` | BI-INT-3DF4A2 | — | **DPF-native estate discovery**: `DiscoveryConnection` + `discovery-collectors/unifi.ts` (1 collector; meraki/fortigate noted as future) + device-fingerprint catalog (Fingerbank-style placement) | Microsoft Intune (2, benchmark row), NinjaOne (catalog key only), Datto/ConnectWise RMM | **~15%** (native estate path; vendor RMM 0%) | `schema.prisma:10549`, `discovery-collectors/unifi.ts`, `device-catalog.ts`; matrix `microsoft-intune-benchmark` |
| 8 | `ticketing_service_desk` | BI-INT-C1D472 | — | DPF-native work-queue spine (`WorkQueue`, `/workspace/my-queue`) is the internal alternative, not a ticketing connector | Zendesk (55), Freshservice (47), Jira SM (40), Freshdesk (31), ServiceNow — all benchmark/observe | **~5%** (native queue only; external connectors 0%) | matrix `zendesk-support-benchmark`, `jira-service-management-benchmark`, `servicenow-service-management-benchmark`; no adapter dir |
| 9 | `project_work_management` | BI-INT-1AB7D8 | — | DPF-native work/backlog/build spine (`WorkQueue`, `/portfolio/backlog`, `/build`); posture is `native_dpf` per the BI | ClickUp (96), Asana (90), monday (54), Trello — no adapters | **~5%** (external connector; native spine strong) | BI-INT-1AB7D8 body ("native_dpf"); no adapter dir |
| 10 | `documentation_knowledge_cmdb_assets` | BI-INT-2CE9F1 | — | DPF-native wiki/docs substrate (`apps/web/lib/wiki/*`) | Notion (30), Confluence (15), Google Drive/Docs (13); IT Glue / Hudu (MSP CMDB) | **~5%** (native docs only; external connectors 0%) | `apps/web/lib/wiki/*`; no adapter dir |
| — | **MSP overlay** (cross-cut) | BI-INT-47B8C3 | — | Estate discovery (unifi collector) is the only MSP-adjacent built path | ConnectWise, Autotask, NinjaOne, IT Glue, Hudu, Datto RMM, HaloPSA — **all absent**; Halo is community-only on Make | **~5%** | classifier `MSP_RELEVANT_TOKENS`; BI-INT-47B8C3 body |

### 3.1 Headline read

- **Built, anchored families (finance, communications, CRM, HR):** each has ≥1 real native adapter and a
  founder-declared native-first anchor already shipped. These are *depth-completion* candidates, not
  greenfield.
- **Thin / one-foot-in families (identity, cloud/security):** an adapter exists but is a stub (Entra snapshot
  read) — cheap to finish, high cross-business leverage.
- **Zero-external-connector families (ticketing, project/work, documentation):** DPF deliberately runs a
  *native spine* here (work queue, backlog, wiki) and treats the external tools as benchmarks. The strategic
  question for these is **sync-vs-replace**, not "build a connector".
- **Framework-first families (RMM/endpoint, MSP stack):** the BIs themselves instruct framework-first / generic
  connector + estate discovery, *not* broad first-party coverage. Native estate discovery is the only built
  path; vendor RMM/PSA is intentionally deferred.

---

## 4. Prioritization baseline (RECOMMENDATION — founder confirms)

This is **not** a final order. It presents explicit criteria and the trade-offs, so the founder can set the
sequence. The criteria below are drawn from signals already in the codebase, not invented.

### 4.1 Scoring criteria (each family scored qualitatively)

1. **MSP relevance** — is the family flagged MSP-relevant by the classifier (`MSP_RELEVANT_TOKENS`,
   `inferMspRelevant`)? DPF's stated wedge is MSP-adjacent estate work.
2. **Breadth of estate impact / cross-business** — `crossBusiness` flag; families every business needs
   (identity, comms, finance) beat niche ones.
3. **Cheap-to-finish partial coverage** — is there already an adapter or shared-framework seam to complete,
   vs. a greenfield build? (Entra stub, connector-factory `integration-shared` primitives.)
4. **Founder-declared anchor status** — the family items already name native-first anchors (QuickBooks,
   Stripe, HubSpot, M365, ADP). Anchors that are *already shipped* score lower for *new* work.
5. **Substrate dependency** — does the family need shared substrate first (e.g. generic-connector factory,
   marketplace seeding) before its connectors are cheap?

### 4.2 Candidate ordering A — "finish the cheap high-leverage stubs first" (recommended default)

| Rank | Family | Rationale (criteria) |
| --- | --- | --- |
| 1 | **Identity / directory** (BI-INT-6C83D1) | Cheap-to-finish (Entra stub → full connect/preview), cross-business, MSP-relevant, gates onboarding/offboarding for every other family. Highest leverage per unit effort. |
| 2 | **Service desk / support** (BI-INT-C1D472) | P1 user-request, high MSP + estate relevance, 0% built today — biggest *unbuilt* gap with clear ticket-lifecycle scope. Trade-off: greenfield, so more expensive than #1. |
| 3 | **Communications depth** (BI-INT-8D4F72, in-progress) | Already in-progress; finish Slack/Gmail breadth on top of the built M365 anchor. |
| 4 | **Finance / billing** (BI-INT-A5B9E3, in-progress) | Add Xero to the built QuickBooks+Stripe anchors; strong existing base, incremental. |
| 5 | **CRM / sales** (BI-INT-E76A95, in-progress) | Salesforce breadth on the built HubSpot anchor. |
| 6 | **RMM / endpoint** (BI-INT-3DF4A2) | Framework-first: extend estate discovery collectors (meraki/fortigate) rather than vendor RMM. |
| 7 | **HR / payroll** (BI-INT-F23BC6) | ADP anchor shipped; BambooHR/Gusto are expansion, lower urgency. |
| 8 | **Documentation / knowledge** (BI-INT-2CE9F1) | Best served by generic-connector factory once seeded; native wiki covers the internal need now. |
| 9 | **Project / work management** (BI-INT-1AB7D8) | `native_dpf` posture — sync connectors are low priority while the native spine is the system of record. |
| — | **MSP vendor stack** (BI-INT-47B8C3) | Deliberately last / evidence-driven per its own body; ride the generic-connector factory, don't overfit to one vendor. |

### 4.3 Candidate ordering B — "MSP-wedge first" (if MSP go-to-market leads)

Reorders A to front-load the MSP overlay: **Identity → Service desk → RMM/estate discovery → Documentation/CMDB
(IT Glue/Hudu) → MSP PSA stack (ConnectWise/Autotask via generic factory)**, deferring the already-anchored
finance/CRM/comms depth work. Trade-off: chases the highest-differentiation wedge but leaves in-progress
family items (A5B9E3, E76A95, 8D4F72) parked mid-stream.

### 4.4 The core trade-off for the founder

Ordering A maximizes *shipped value per unit effort* by finishing what is already partly built and what is
in-progress. Ordering B maximizes *strategic differentiation* (MSP estate management) but pays a greenfield
cost up front and stalls three in-progress items. **The decision hinges on whether the near-term goal is
breadth-of-SMB-parity (A) or depth-of-MSP-wedge (B).** That is a WWWD/business-strategy call, not one the code
can make — see §6.

---

## 5. Canonical benchmark shape (the repeatable per-family method)

So that every `BI-INT-*` family item is benchmarked the same way, "benchmarking a family" means producing, for
that family, the following artifact. This is derived from the field shape already present in
`INTEGRATION_COVERAGE_MATRIX` rows and the family-item bodies.

**Per family, produce a table of rows where each row is one candidate app, with columns:**

1. **App + provider** — the vendor product (e.g. Zendesk / Zendesk).
2. **Make breadth signal** — Make's verified module count + tier (verified / community / partner). Breadth
   signal only.
3. **DPF coverage kind** — `native` | `benchmark` (matches `IntegrationCoverageKind`).
4. **DPF adapter state** — built (adapter dir present) | thin/stub | catalog-key-only | absent (cite the path).
5. **Recommended treatment** — `native_first_class` | `generic_connector` | `bundle_default` (from the
   classifier).
6. **Posture** — `native-dpf` | `integration-led` | `hybrid` | `provider-led` | `replacement-candidate`
   (`IntegrationCoveragePosture`).
7. **Maturity target** — `observe` | `read` | `stage` | `operate` | `write-back`
   (`IntegrationCoverageMaturity`).
8. **Entity families** — the object families to cover (e.g. tickets, requesters, comments, attachments,
   SLA/states), read-first.
9. **Employee roles + DPF surfaces + coworker** — who uses it and where (matrix already carries these).
10. **Replacement gate** — the explicit evidence bar before any write-back / system-of-record promotion (the
    family bodies all state one).
11. **Priority tier** — `p0_anchor` | `p1_expansion` | `p2_bundle`.

**Method to fill it (repeatable):**

1. Pull the Make anchor apps + module counts from the family BI body (already captured).
2. Grep `apps/web/lib/integrate/<vendor>/` and `INTEGRATION_COVERAGE_MATRIX` for existing coverage — classify
   built / thin / absent from the *code*, not assumption.
3. Run each app name through `getIntegrationBenchmarkMetadata` to get treatment + tier + MSP/cross-business
   flags consistently.
4. Set maturity target = read-first unless the family body states otherwise; capture the replacement gate
   verbatim from the BI body.
5. Record unknowns explicitly (see §6) rather than guessing depth.

The `integration-coverage-matrix.ts` file **is** the machine-readable home for this artifact; each family
benchmark should land as additional rows there (with `nextBacklogItemId` pointing at the family BI), so the
matrix stays the single source of truth and this doc stays the narrative baseline.

---

## 6. Gaps / unknowns needing founder or domain input

These could **not** be resolved from the code and are flagged rather than invented:

1. **Make module counts are unverified from code.** All Make breadth numbers (Slack 46, HubSpot 121, etc.)
   come from the BI bodies / external Make pages, not from anything in the repo. They should be treated as a
   point-in-time external signal; nobody has re-verified them this pass. Founder/domain input: confirm whether
   a periodic re-scrape of Make is in scope, or whether these stay as a frozen baseline.
2. **`cloud_m365_google_security` has no dedicated family BI.** It is a codified benchmark domain (#6 above)
   but no `BI-INT-*` sibling was enumerated for it. Founder input: file one, or fold it into identity (6C83D1)
   + communications (8D4F72)?
3. **A/B prioritization is a business-strategy call.** Breadth-of-SMB-parity (Ordering A) vs. MSP-wedge-depth
   (Ordering B) cannot be decided from the code — it depends on go-to-market intent (WWWD). Needs founder
   confirmation of the sequence in §4.
4. **Marketplace layer is unseeded.** The `McpIntegration` generic-connector table (what `search_integrations`
   reads) is empty here. Whether generic-connector coverage counts toward a family's coverage % depends on the
   marketplace-seeding decision, which is not yet made. Domain input: is generic-connector availability
   "coverage" or only native adapters?
5. **`SUPPORTED_INTEGRATIONS` credential-key-only entries are ambiguous.** salesforce/slack/jira/zendesk/
   ninjaone/xero/google-workspace have provider keys but no adapters. Are these committed roadmap (imminent
   adapters) or aspirational placeholders? This changes whether they count as "partial" or "absent".
6. **RMM/endpoint depth beyond UniFi is unverified.** Only `unifi.ts` exists as a collector; meraki/fortigate
   are named as future in the schema comment but not built. The real coverage of the estate-discovery path
   (device classes, fingerprint rule count) needs a domain read of the fingerprint catalog to quantify beyond
   the ~15% estimate here.
7. **Coverage % are estimates, not measured parity.** No automated parity harness compares DPF entity coverage
   to Make's per-app modules. If precise parity numbers are needed for reporting, that harness is itself a
   backlog item (not built).

---

## 7. Next step

Recommended: founder confirms (a) the §4 prioritization ordering (A, B, or an edit), and (b) the §6 unknowns
that gate it — especially #2 (missing cloud/security BI) and #5 (credential-key-only status). On confirmation,
each family item (starting with the chosen rank-1 family) follows the §5 canonical shape, landing its rows in
`integration-coverage-matrix.ts` with the family BI as `nextBacklogItemId`.
