---
status: active
---

# Cloudflare-fronted managed DPF deployment planning and estimate

**Umbrella BI:** `BI-D5228299`

**Parent epic:** `EP-MFG-DELIVER-INSTALL`

**Design:** `docs/superpowers/specs/2026-08-29-cloudflare-fronted-managed-deployment-design.md`

**Workroom:** `WC-064E8BEB`

**Documentation delivery BI:** `BI-705F481D`

**Authorization posture:** planning and estimation only. This document does not
authorize implementation, promotion into Build Studio, infrastructure spend, a
design-partner pilot, or a Cloudflare-specific fork.

> **For agentic workers:** execute this plan one independently reviewable
> backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for
> red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's
> completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

The execution preamble applies only if a future operator explicitly activates
one of D1-D5. Publishing this plan completes D0 only. The implementation and
pilot BIs remain open, unclaimed future options and may stay that way for months
or indefinitely.

## 1. Outcome

Plan a possible design-partner-ready, Cloudflare-fronted managed DPF option where
every customer receives one isolated canonical DPF cell. The implementation
reuses the shipped cloud Single VM path, adds a replaceable Cloudflare edge
adapter and provider-neutral fleet operations, proves restore/export and
cross-cell noninterference, and keeps public maturity claims evidence-based.

This delivery publishes architecture, backlog decomposition, dependencies, and
estimates. It does not implement the managed option, pooled tenancy,
pricing/billing, a production pilot, or a permanent Cloudflare fork.

## 2. Delivery graph

| Deliverable | Live BI | Estimate | Current posture | Independently shippable outcome | Depends on | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| D0 — canonical design and contributor contract | `BI-705F481D` | medium | Documentation delivery in this PR | Reviewed architecture, deployment-contract mapping, public maturity language, and governed implementation plan | none | Docs lint, link/anchor checks, architecture advisory, independent spec/plan review |
| D0A — Cloudflare provider evaluation | `BI-82773DA2` | medium | Open; evaluation not started | Governed vendor/tool evaluation and evidence-backed pilot reachability recommendation | D0 | Terms/security/region/quota/support/portability evaluation; public-origin versus named-Tunnel disposition |
| D1 — managed-cell provisioning | `BI-4D1880E4` | large | Open; implementation not authorized | Provider-neutral isolated-cell IaC/profile extending existing Single VM substrate | D0; `BI-48951394`; `BI-C5C7F1A5` | Two-cell idempotent provision/reconcile; digest/install identity; destructive refusal tests |
| D2 — Cloudflare edge adapter | `BI-5ABF833E` | medium | Open; implementation not authorized | Custom hostname/TLS/WAF/Access/Tunnel/origin adapter with teardown | D0A; D1 | Unknown/mismatched host fail-closed; origin-bypass; per-surface streaming/callback tests; provider removal |
| D3 — fleet lifecycle plane | `BI-E4E72580` | large | Open; implementation not authorized | Onboarding, bounded posture, deployment rings, governed upgrade, incident and support-lease orchestration | D1; `BI-705CA714`; `BI-48951394`; `BI-C5C7F1A5` | Management-plane-loss, ring-stop, support expiry/revocation, idempotent reconciliation |
| D4 — sovereignty and exit | `BI-B40BCE28` | large | Open; implementation not authorized | Cell-scoped backup/PITR, restore testing, portable export/transfer, retention/deletion evidence | D1; D3 | Restore into isolated target, corruption/failure injection, export checksum and customer-owned restore |
| D5 — design-partner pilot and maturity promotion | `BI-183095E2` | medium | Open; pilot not authorized | Synthetic two-cell Cloudflare-fronted pilot, evidence bundle, measured costs/effort, honest public status | D0A; D1-D4 | Full contract matrix, cross-cell noninterference, outage/upgrade/restore/exit drill, docs parity |

The future order is `D0 -> (D0A || D1) -> (D2 || D3) -> D4 -> D5`. D2 needs
both the provider disposition and cell contract; D3 may proceed from D1. No
production customer pilot starts before D0A and D4 pass with synthetic data.

The live T-shirt estimates are comparative backlog sizing, not delivery
commitments. Under the DPF sizing convention, medium is roughly 1-3 focused
working days and large is roughly 1-2 focused engineering weeks. D1-D5 therefore
represent approximately 4-8 focused engineering weeks if executed sequentially,
before provider/vendor review, queueing, procurement, soak time, and pilot
calendar. Confidence is low until D0A's provider evaluation and the D1 substrate audits
replace assumptions with measured constraints. No start date or budget is
approved by this estimate.

## 3. Backlog coverage

- Decision: `decomposed`
- Parent: `BI-D5228299`
- Receipt: `pending independent spec approval and immutable plan commit`
- Deliverable mappings: D0 → `BI-705F481D`; D0A → `BI-82773DA2`; D1 →
  `BI-4D1880E4`; D2 → `BI-5ABF833E`; D3 → `BI-E4E72580`; D4 →
  `BI-B40BCE28`; D5 → `BI-183095E2`.
- Dependencies: recorded in §2 and in each live BI body.

The receipt is deliberately not fabricated. Schema-v2 plan coverage requires
an independently approved scope baseline and an immutable repository artifact.
After the signed design/plan commit is pushed, an independent reviewer records
the spec approval, then `record_plan_backlog_coverage` replaces the pending
line above and `check_plan_backlog_coverage` revalidates it. Valid coverage is
not implementation authorization; a future operator decision must separately
activate the applicable BI.

## 4. Phase 0 — publish the architecture and roadmap

**Delivery boundary:** D0 (`BI-705F481D`), contributing to umbrella
`BI-D5228299`.

### Work

1. Review the design against all deployment contracts, the 2026-05-09 cloud
   design, install-as-tenant doctrine, MSP/federation, install state,
   RuntimeTarget/RuntimeVerification, release identity, self-upgrade,
   backup/restore, Edge, MCP, A2A, and public usability standards.
2. Record the incomplete Cloudflare vendor/tool evaluation as the independent
   future planning deliverable `BI-82773DA2`; do not imply provider approval.
3. Record independent research evidence, architecture advisory, spec approval,
   plan review, and schema-v2 backlog coverage.

### Files

- `docs/superpowers/specs/2026-08-29-cloudflare-fronted-managed-deployment-design.md`
- `docs/superpowers/plans/2026-08-29-cloudflare-fronted-managed-deployment.md`
- Existing deployment/cloud specs receive pointers, not duplicated doctrine.

### Verification

- `pnpm docs:lint` or the repository's current docs-only lint target.
- `node scripts/check-doc-anchor-existence.mjs`.
- Link checking for every external primary source.
- Independent architecture/design and plan review receipts.
- `check_plan_backlog_coverage` returns valid for this exact path and receipt.

### Rollback

Revert the documentation PR and retain the live BIs as researched/deferred
work. No runtime or customer state exists in this phase.

## 4A. Future planning — Cloudflare provider evaluation

**Delivery boundary:** D0A (`BI-82773DA2`). This work is not started by this
documentation PR.

### Work

1. Evaluate license/terms, DPA and subprocessors, regional behavior, security
   posture, incident/support model, pricing/quotas, portability, deletion, and
   provider failure modes for the exact proposed Cloudflare services.
2. Resolve authenticated public origin versus named Tunnel as the recommended
   pilot default. Retain both only if both have complete failure and
   direct-origin controls.
3. Reconcile any evidence-driven scope, dependency, or estimate change into
   this roadmap before an implementation BI may be activated.

### Files

- `docs/security/tool-evaluations/<date>-cloudflare.md`
- This plan and design only when the evidence changes a recorded assumption.

### Verification

- The governed tool/vendor-evaluation procedure passes with dated sources.
- Security, sovereignty, portability, support, quota, and failure findings all
  have an accountable disposition.
- The recommended reachability mode has explicit adopt/reject reasoning.

### Rollback

Reject or defer Cloudflare without affecting the provider-neutral managed-cell
design. No provider resource or customer state exists in this planning phase.

## 5. Phase 1 — implement the managed-cell substrate

**Delivery boundary:** D1 (`BI-4D1880E4`).

### Work

1. Audit `infra/terraform/single-vm/{aws,gcp,azure}`, install-state v2,
   `RuntimeTarget`, deployment-product modelling, and release manifests.
2. Define a versioned managed-cell input/output contract: customer/install
   identity, target provider/account/project, region, networking, release
   digest, secret/KMS references, backup policy, support mode, edge mode, and
   declared capabilities.
3. Refactor shared Single VM Terraform logic only where evidence shows safe
   reuse. Provider modules remain wrappers around one contract.
4. Implement idempotent provision, inspect, reconcile, and guarded retire
   operations. Retire fails closed until D4 provides an accepted exit/restore
   disposition.
5. Project cell runtime identity and verification through existing substrate;
   do not create a fleet table until the schema audit proves a missing invariant.

### Likely files after substrate audit

- `infra/terraform/single-vm/{aws,gcp,azure}/`
- `scripts/installer/` and install-state schemas only for universal host facts
- `packages/db/prisma/schema/build-delivery.prisma` only if existing
  `RuntimeTarget` cannot carry the required canonical relation
- deployment provider/registry modules located by code graph at pickup
- contract tests adjacent to every wrapper

### Verification

- Terraform format/validate and policy/security scans for every supported module.
- Provision two synthetic cells from the same release, then reapply with no
  unintended change.
- Assert distinct network, secret, database, queue/cache, object, backup, and
  runtime identities.
- Inject partial provision and reconcile to the declared state.
- Prove release tag, image digest, Git/source identity, and install identity
  bind before activation.

### Rollback

Destroy only synthetic cells after verified export. IaC state and evidence are
retained. Failed production-like cells are quarantined, not force-destroyed.

## 6. Phase 2 — implement the Cloudflare edge adapter

**Delivery boundary:** D2 (`BI-5ABF833E`).

### Work

1. Create one adapter contract for hostname claim/validation, certificate
   state, origin binding, WAF/rate-limit policy, optional Access policy,
   reachability mode, observability, and teardown.
2. Implement Cloudflare for SaaS custom hostnames and per-cell metadata using
   least-privilege API tokens. Store provider identifiers as adapter metadata,
   never customer identity authority.
3. Implement authenticated public-origin and/or named-Tunnel routing according
   to the Phase 0 decision. Block direct-origin bypass.
4. Define surface policies from Design §11, including cache bypass and trusted
   proxy/header sanitation.
5. Export edge events and configuration evidence into the existing operational
   evidence path without request bodies or customer business payloads.
6. Implement provider teardown: export configuration, remove hostname/tunnel/
   certificates safely, rotate origin credentials, and document DNS cutover.

### Verification

- Unit/contract tests with recorded API fixtures; no live credential in tests.
- Two cells plus unknown hostname: correct route, wrong route denied, unknown
  denied, no shared cache response.
- Direct-origin, forged forwarded headers, hostname takeover, stale metadata,
  expired certificate, revoked token, tunnel disconnect, and Cloudflare API
  outage tests.
- MCP SSE, WebSocket, OAuth callback, well-known files, Edge ingestion,
  storefront assets, and private response behavior observed through the edge.
- Teardown/replacement route proves DPF data is untouched.

### Rollback

Repoint DNS through the documented alternate ingress, revoke Cloudflare API and
origin credentials, then remove adapter resources. Cell origins and data remain.

## 7. Phase 3 — implement bounded fleet operations

**Delivery boundary:** D3 (`BI-E4E72580`).

### Work

1. Define onboarding and operation state machines with stable operation ids,
   generation checks, and idempotent retries.
2. Expose an install-owned operational posture projection: version/release,
   health, backup freshness/restore result, residency declaration, incident,
   and support-lease state.
3. Add deployment rings that request the canonical self-upgrade lifecycle and
   halt on failed acceptance; do not manipulate image tags directly.
4. Add management-plane outage/reconnect semantics. Cells remain independently
   operable and reconcile without replaying accepted operations.
5. Add customer-approved support leases with human/service principal identity,
   scope, expiry, reason, revocation, and evidence.
6. Present customer-visible maintenance/incident/support status using the
   existing operations and attention surfaces, with progressive disclosure.

### Verification

- State-machine unit/property tests for duplicate/out-of-order operations.
- Management-plane disconnect during provision, backup, upgrade, and support.
- Deployment-ring failure halts later cells and leaves prior/unselected cells
  healthy.
- Support lease cannot exceed scope/expiry, and revoke prevents subsequent use.
- Fleet telemetry contains no sampled customer records or secrets.

### Rollback

Disable fleet dispatch while leaving local cell lifecycle intact. Expire all
support leases, preserve evidence, and return operation ownership to each cell.

## 8. Phase 4 — prove sovereignty, recovery, and exit

**Delivery boundary:** D4 (`BI-B40BCE28`).

### Work

1. Inventory every durable data class and its current backup/restore owner.
   Extend the existing managed backup substrate; do not build a second engine.
2. Bind backups, object/file content, encryption, retention, and catalogs to
   one cell identity. Fleet projections expose posture only.
3. Automate isolated restore tests and validate release/install/data invariants
   before recording success.
4. Produce the portable exit package and customer-owned restore procedure.
5. Implement transfer of DNS/edge, IaC/state, secrets/keys where allowed,
   release manifest, data, and operational evidence.
6. Gate retirement on accepted export/restore, retention/legal hold, customer
   approval, and deletion evidence.

### Verification

- Restore each synthetic cell into a third isolated target; deliberately swap
  backup identifiers and prove rejection.
- Corrupt/incomplete backup and lost-key exercises fail without destroying the
  source cell.
- Restore verifies database, files/objects, migrations, install/release
  identity, representative business invariants, and portal health.
- Transfer one pilot cell to a customer-owned Single VM path and remove the
  Cloudflare adapter without changing DPF data.

### Rollback

Exit/retirement is reversible until the final deletion hold. A failed transfer
leaves the source cell active or recoverable and preserves the last accepted
backup plus all evidence.

## 9. Phase 5 — run the design-partner pilot

**Delivery boundary:** D5 (`BI-183095E2`).

### Work

1. Use synthetic data and two cells in a nonproduction provider account.
2. Execute the full deployment-contract matrix and the cross-cell security
   matrix.
3. Run Cloudflare edge outage, origin outage, management-plane loss, failed
   upgrade, failed backup, failed restore, provider-token compromise, and exit.
4. Measure infrastructure cost, provider quotas, provision/upgrade/restore/
   export time, and human operating/support effort.
5. Publish a redacted evidence report and update public maturity language.
6. Route the commercial pilot/GA decision through the organization WWWD process
   using actual demand and pilot economics.

### Verification

- Every Design AC-1 through AC-12 has an evidence locator and verdict.
- No test requires production customer data or standing support credentials.
- Public homepage, README, cloud guide, verification matrix, and backlog status
  agree on the observed maturity.
- A failed mandatory gate leaves the option at research or design-partner pilot.

### Rollback

Terminate the synthetic pilot through the governed exit path, preserve the
redacted evidence/cost record, revoke provider credentials, and keep the
customer-owned cloud option unchanged.

## 10. Completion gate

The managed option is design-partner-ready only when:

1. D0, D0A, and D1-D4 are merged through separate DCO-signed PRs and their live BIs carry
   accepted delivery evidence.
2. Plan coverage is live and revalidates for the immutable plan artifact.
3. Every canonical deployment contract has observed evidence.
4. Two-cell noninterference and isolated restore pass.
5. Cloudflare removal/edge replacement and customer-owned exit pass.
6. Security/vendor evaluation has no unresolved critical finding.
7. Costs and operator effort are measured rather than estimated.
8. Documentation impact is reconciled across all public/operator surfaces.

GA additionally requires a separate commercial decision, support/SLO ownership,
and production design-partner evidence. This plan cannot declare GA by itself.

## 11. Principal risks

| Risk | Mitigation | Stop condition |
| --- | --- | --- |
| Hidden pooled state in cache/queue/log/backup | Treat every stateful namespace as a cell boundary; two-cell adversarial tests | Any unexplained cross-cell observation |
| Cloudflare becomes a core dependency | Adapter boundary, alternate ingress, teardown/exit test | DPF data or authorization moves into provider-only state |
| Fleet plane gains standing customer authority | Posture-only projection, bounded commands, approved expiring support leases | Arbitrary DB/shell or identity minting required |
| Per-cell economics do not work | Measure dormant/normal/busy cells and support minutes before launch | Sustainable price requires unapproved pooled rewrite |
| Provider limits break streams/callbacks | Test every Contract 10 path through real edge configuration | Required surface cannot meet functional/SLO needs |
| Fork drifts from upstream | All supported work lands upstream under canonical contracts | Contributor requires permanent provider branch |
| Public promise outruns evidence | Central maturity vocabulary and documentation reconciliation | Any surface says GA without completion evidence |
