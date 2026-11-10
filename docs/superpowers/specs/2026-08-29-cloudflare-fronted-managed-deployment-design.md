---
status: active
---

# Cloudflare-fronted managed DPF deployment

| Field | Value |
| --- | --- |
| Status | Proposed planning baseline — implementation not authorized |
| Backlog item | `BI-D5228299` |
| Parent epic | `EP-MFG-DELIVER-INSTALL` |
| Workroom | `WC-064E8BEB` |
| Architecture decision | `DI-D5FF66D82B0C` — managed isolated cells |
| Edge-provider decision | `DI-B2E8C6583B58` — optional Cloudflare adapter |
| Extends | `2026-05-09-deployment-contracts.md`, `2026-05-09-cloud-deployment-design.md` |
| Plan | `docs/superpowers/plans/2026-08-29-cloudflare-fronted-managed-deployment.md` |

## 1. Decision

DPF may be delivered as a managed cloud service, but the first managed
offering remains **install-per-customer**. Each customer receives an isolated
DPF cell: its own application stack, persistent data, secret namespace,
backup/restore boundary, runtime identity, region choice, and failure domain.

Cloudflare is an optional edge and routing provider in front of those cells.
It supplies customer hostnames, DNS, TLS, WAF/rate limiting, optional Access,
and either authenticated public-origin routing or an outbound-only named
Tunnel. It does **not** own DPF authorization semantics, customer business
data, the canonical databases, or the lifecycle truth of an installation.

The origin remains provider-neutral. The first pilot may use one supported
cloud VM because that reuses the shipped Linux installer and Terraform
modules. Later origins may use a managed container or Kubernetes substrate
only after they satisfy the same deployment contracts and Build Execution
Provider requirements.

This is a cloud delivery option, not a new DPF product fork and not pooled
application tenancy.

Publishing this specification authorizes documentation, planning, backlog
decomposition, and estimation only. It does not authorize implementation,
provider spend, a design-partner pilot, production use, or promotion of any
implementation BI. Those remain separate future decisions.

## 2. Existing commitments and continuity

This design does not replace the existing cloud work:

- The public homepage labels native Linux and Cloud Single VM as early access
  and links to the operator guide.
- `README.md` presents customer cloud as one of the canonical deployment
  targets.
- `docs/install/cloud-single-vm.md`, the AWS/GCP/Azure modules under
  `infra/terraform/single-vm/`, and the verification runbook are the existing
  Phase 0 implementation.
- `2026-05-09-cloud-deployment-design.md` defines Single VM, managed-container,
  and managed-Kubernetes substrates and explicitly excludes pooled tenancy.
- `2026-05-09-deployment-contracts.md` owns the universal contracts that every
  wrapper must preserve.
- The MSP/federation design already distinguishes managed estates inside one
  organization from independent sovereign DPF installations.

The repository also cites historical cloud coordination anchors that are
absent from the current live backlog. This design preserves those citations in
their dated source documents as historical evidence and uses live umbrella
`BI-D5228299` under `EP-MFG-DELIVER-INSTALL` for current coordination. It does
not rewrite dated records to make old identifiers appear live.

## 3. Objectives and acceptance manifest

**OBJ-1:** Offer cloud convenience without weakening DPF's install-as-tenant,
customer-sovereignty, or canonical-identity contracts.

**OBJ-2:** Bound Cloudflare to a replaceable edge adapter whose failure or
removal does not strand customer data or create a second authority plane.

**OBJ-3:** Make a fleet of isolated cells operationally manageable through
repeatable provisioning, progressive upgrades, bounded support, observability,
backup, restore, and customer exit.

**OBJ-4:** Keep public claims and contributor instructions synchronized with
observed deployment maturity.

| Acceptance | Objective | Testable statement |
| --- | --- | --- |
| AC-1 | OBJ-1 | Two synthetic customer cells have no shared application database, vector/graph state, file store, secret namespace, queue state, cache namespace, backup set, or runtime identity. |
| AC-2 | OBJ-1 | A customer cell uses the same canonical release images, runtime schema, authorization model, Edge contract, and lifecycle verbs as an on-premises install. |
| AC-3 | OBJ-2 | Every hostname routes to exactly one declared cell; requests with an unknown or mismatched hostname fail closed before reaching an origin. |
| AC-4 | OBJ-2 | Direct-origin access is blocked or authenticated and monitored; Cloudflare removal can be completed by changing the edge adapter and DNS without migrating DPF data. |
| AC-5 | OBJ-2 | Admin, storefront, customer portal, mobile, MCP, Edge ingestion, OAuth callback, well-known files, SSE, and WebSocket paths each have an explicit ingress policy and observed test. |
| AC-6 | OBJ-3 | Provision, reconcile, upgrade, backup, restore, export, transfer, and retire operations are idempotent or fail with a recoverable recorded state. |
| AC-7 | OBJ-3 | A failed upgrade or management-plane outage affects only the selected cell/ring; an unselected cell continues operating. |
| AC-8 | OBJ-3 | Support access is least-privilege, time-bounded, customer-visible, revocable, and durably audited with both human and service principals. |
| AC-9 | OBJ-3 | A restore test recreates a complete cell in an isolated target and verifies release identity, install identity, record counts/invariants, and application health before acceptance. |
| AC-10 | OBJ-3 | Customer exit produces portable artifacts, checksums, configuration/secret inventory, and a documented restore path into customer-owned cloud or on-premises infrastructure. |
| AC-11 | OBJ-4 | README, public homepage, install guide, and verification matrix use one of `research`, `design-partner pilot`, `early access`, or `generally available` from observed evidence rather than aspiration. |
| AC-12 | OBJ-4 | A contributor can implement the Cloudflare adapter upstream through the canonical deployment contracts without maintaining a Cloudflare product fork. |

## 4. Vocabulary and boundaries

- **Customer cloud** — a sovereign DPF install operated in the customer's own
  cloud account. This already exists as an early-access deployment option.
- **Managed DPF cell** — one sovereign DPF install operated for one customer by
  the service operator. In cloud-architecture literature this is a single-
  tenant deployment stamp or full-stack silo.
- **Fleet management plane** — operational metadata and commands needed to
  provision and maintain cells. It is not a shared customer-data plane.
- **Cloudflare edge adapter** — provider-specific implementation of hostname,
  TLS, WAF, Access, Tunnel/origin, and edge-log contracts.
- **Pooled tenancy** — multiple independent organizations sharing an
  application/database and relying on tenant keys or row policies. It remains
  outside this design.

Cloud delivery and application tenancy are independent axes. A service can be
managed and cloud-hosted while every customer still has isolated infrastructure.

## 5. Options considered

| Option | Adopted parts | Rejected parts | Disposition |
| --- | --- | --- | --- |
| Customer-owned cloud | Sovereign account, existing Single VM/managed-container/k8s shapes, portable IaC | Makes DPF operate nothing and does not answer customers asking for managed delivery | Continue as a peer option |
| Managed isolated cells | Same runtime per customer, automated stamp provisioning, unified but bounded operations | Higher per-customer infrastructure and fleet-automation cost | **Selected first managed option** |
| Pooled multi-tenant SaaS | Potential long-run density and unit-cost learning | Whole-schema/query/auth/job/storage/memory/audit rewrite; much larger cross-customer incident domain | Deferred until separately justified |
| Cloudflare-specific fork | Contributor energy and provider expertise | Split migrations, security fixes, release provenance, governance, and documentation | Reject fork; accept upstream adapter |

The kernel comparison `DI-D5FF66D82B0C` selected managed isolated cells
with high confidence and no commandment conflict. Customer-owned cloud remains
a close peer, not a superseded product.

## 6. Reference patterns and research

### 6.1 Industry architecture

- Microsoft Azure's Deployment Stamps pattern deploys independent copies of
  application components and data stores, supports one tenant per stamp, and
  requires repeatable infrastructure-as-code and fleet operations. DPF adopts
  single-tenant stamps and deployment rings.
- AWS SaaS Lens calls this full-stack or silo isolation. It treats separate
  stacks as a valid SaaS shape when unified onboarding, deployment, metrics,
  and operations surround them. DPF adopts the unified operational experience
  but rejects any implication that shared identity means shared customer
  authorization or data.
- PostgreSQL row-level security is useful defense-in-depth for genuinely
  shared tables, but owners and `BYPASSRLS` roles bypass it and referential
  checks are outside normal row filtering. It is not the primary boundary for
  the first managed DPF offering.

### 6.2 Cloudflare capabilities

| Capability | DPF use | Boundary |
| --- | --- | --- |
| Cloudflare for SaaS | Customer custom hostnames, certificate lifecycle, hostname metadata, per-customer origins | Hostname routing is not application tenancy |
| DNS and TLS | Stable cell and customer domains | DNS/export must remain transferable |
| WAF and rate limiting | Surface-specific managed rules and abuse controls | Authority Core still performs authentication/authorization |
| Access | Optional workforce/admin pre-authentication | Must not replace DPF principals, roles, or route capability checks |
| Named Tunnel | Outbound-only origin reachability for a private origin | Named production tunnel only; no Quick Tunnel; tunnel identity is a secret |
| Workers | Small edge routing/validation logic where configuration cannot express it | No customer business logic or canonical state |
| Workers for Platforms | Reference for isolated customer-authored edge code | Not DPF tenancy; DPF tenants do not supply Worker applications |
| Containers | Possible future edge-adjacent compute experiment | Ephemeral disk and current lifecycle/autoscaling limits make it unsuitable as the sole persistent Authority Core |
| R2 | Optional encrypted export/backup object target after compatibility tests | Not the canonical database; S3 feature gaps must be tested, especially lock/versioning expectations |
| Hyperdrive | Optional Postgres connection acceleration when topology benefits | Connection pooling, not tenancy or database authority |

Cloudflare adoption remains conditional on a tool evaluation covering terms,
data processing, region behavior, security controls, quotas, support, export,
and replacement. The DPF-specific `tool-evaluation` skill was not available
to this authoring session, so this design records the required evaluation as a
pre-pilot gate under `BI-82773DA2` rather than pretending the integration is
approved.

## 7. Logical architecture

```text
Customer browser / mobile / MCP / Edge Node
                     |
              customer hostname
                     v
    +------------------------------------------+
    | Cloudflare edge adapter                  |
    | DNS | TLS | hostname map | WAF | Access? |
    | authenticated origin route / named Tunnel|
    +--------------------+---------------------+
                         |
                  cell origin identity
                         v
    +------------------------------------------+
    | Managed DPF cell: exactly one customer   |
    | portal + workers + Build provider        |
    | Postgres + files/objects + secret store  |
    | install-state + RuntimeTarget projection |
    | backup/restore/export boundary            |
    +--------------------+---------------------+
                         |
              outbound Edge/federation links
                         v
            Customer-controlled environments

    +------------------------------------------+
    | Provider-neutral fleet management plane  |
    | provision | observe | ring upgrade        |
    | backup posture | incident | support lease |
    +------------------------------------------+
       operational metadata and bounded commands only
```

The management plane knows that a cell exists, which release it runs, its
health/backup/residency posture, and which bounded operation is authorized.
It does not contain the customer's CRM, HR, financial, clinical, knowledge,
prompt, or decision records.

## 8. Cell composition and isolation

The minimum cell boundary contains:

1. One DPF install identity and one owning `Organization`.
2. One versioned application/runtime deployment from canonical release bytes.
3. One Postgres database or database instance/cluster namespace whose
   credentials cannot reach another cell.
4. One file/object namespace and one backup/restore chain.
5. One secret namespace and encryption context.
6. One queue/scheduler namespace and cache namespace.
7. One observability partition with bounded fleet-level projection.
8. One Cloudflare hostname/origin/tunnel mapping.
9. One declared region, subprocessor set, retention policy, and support mode.

Resource sharing below this boundary is limited to provider infrastructure
whose controls already enforce account/project/namespace isolation. DPF never
uses a shared application credential across cells. Caches, queues, object keys,
logs, traces, backup catalogs, and metrics must be treated as data boundaries,
not merely databases.

The first pilot uses two synthetic cells specifically to prove noninterference.

## 9. Canonical substrate reuse

No new general-purpose installation registry is introduced.

- `install-state.json` remains canonical for host/runtime facts and inherits
  Deployment Contract 12 precedence.
- `Organization` remains canonical for the customer business identity inside
  each cell.
- Existing `RuntimeTarget` and `RuntimeVerification` carry runtime status and
  evidence projections; any new closed values must use the existing typed
  registry/migration process.
- The R2D Deploy product fork in `BI-C5C7F1A5` represents this target as a
  deploy product rather than inventing a second delivery taxonomy.
- Canonical release-source identity work in `BI-48951394` supplies exact Git,
  image, manifest, and release provenance.
- `/ops/self-upgrade` remains the only install-advance path. Fleet automation
  requests that lifecycle; it does not hand-tag or directly replace images.
- Existing backup/restore, whole-account export, Edge Node, federation, MCP,
  and A2A contracts are extended, not cloned.

The fleet needs a durable mapping between provider cell identity and the
install's existing runtime/deployment identity. The implementation must first
prove whether `RuntimeTarget` metadata plus the purpose-aware install identity
and deployment-product substrate are sufficient. A new table is allowed only
after that schema audit documents the concrete missing invariant.

## 10. Deployment-contract conformance

| Contract | Managed-cell implementation |
| --- | --- |
| 1. Release artifacts | Consume the same signed/versioned multi-arch GHCR artifacts and release manifest; pin digest, never mutable tag alone. |
| 2. Runtime configuration | Inject the canonical env/config schema from the cell secret store; no Cloudflare-only application variables unless they are adapter configuration. |
| 3. Lifecycle | Expose install/start/stop/update/backup/restore/uninstall/transfer as idempotent cell operations; update delegates to governed self-upgrade. |
| 4. Identity | DPF retains principal, group, role, route, coworker, MCP, and Edge authority. Access is optional outer pre-auth only. |
| 5. Edge | Edge Nodes call the stable cell URL over outbound HTTPS and retain their existing enrollment/token/audit semantics. |
| 6. Build execution | Single VM may use local Docker initially; managed container/k8s cells require the corresponding provider abstraction and may truthfully disable Build Studio until it exists. |
| 7. Observability | Cell-local detailed telemetry; fleet receives only bounded operational posture with cell identity and cardinality limits. |
| 8. Secrets | Per-cell namespace, envelope/KMS encryption, rotation, no shared runtime credential, audited support access. |
| 9. LLM/agent routing | Same provider modes and data-governance checks; cloud hosting does not silently enable public model egress. |
| 10. Client/API surfaces | Per-surface Cloudflare route, caching, WAF, CORS, origin, streaming, callback, and well-known-file verification. |
| 11. A2A coordination | Existing delegation depth/fan-out and evidence contracts remain; management plane is not a new cross-cell coworker bus. |
| 12. Installer state | Installer state remains host fact authority; fleet metadata is a projection and never writes customer/org facts into install-state. |

## 11. Ingress and Cloudflare policy

| Surface | Default edge posture | Cache | Special verification |
| --- | --- | --- | --- |
| Workforce/admin | Cloudflare Access optional; DPF session required | Bypass | Direct-origin denial; trusted proxy headers |
| Storefront | Public WAF/rate limit; custom hostname | Explicit public assets only | Hostname-to-cell binding; purge isolation |
| Customer portal | Public WAF; DPF customer session | Bypass private responses | Credentialed CORS and cookie domain |
| Mobile API | Public API rate limits; bearer/device auth | Bypass unless endpoint declares otherwise | App links and mobile CORS |
| MCP | Prefer Access/service token or private route plus DPF token | Never | `MCP_PUBLIC_URL`, allowed origins, SSE/stream duration |
| Edge ingestion | Public authenticated machine endpoint or private route | Never | Reject browser preflight; body/timeout limits |
| OAuth callback | Public stable hostname | Never | State validation and trusted forwarded scheme/host |
| Well-known files | Public, no redirect | Short controlled cache | Exact content type and domain |
| WebSocket/SSE | Supported proxy path | Never | Reconnect, deployment, and provider-maintenance behavior |

The adapter strips untrusted forwarding headers and writes the canonical host,
scheme, and cell identity before the origin receives a request. Hostname
metadata is routing input, not authorization evidence.

## 12. Provisioning and lifecycle state machine

```text
requested -> policy-checked -> provisioning -> origin-ready
         -> edge-binding -> verification -> active
active -> upgrading -> verifying -> active
active -> degraded -> recovering -> active
active -> exit-requested -> export-verified -> transferred|retired
```

Each transition has a stable operation id and may be retried. State is advanced
only after observed evidence; a Terraform/API success response alone is not
functional acceptance. Destructive retirement requires explicit approval and
a verified recovery/export disposition.

Deployment rings are `internal`, `pilot`, and `managed-general` initially.
The same release bytes progress through rings. Cell-specific hotfix forks are
not permitted; an emergency fix still lands upstream and produces canonical
artifacts.

## 13. Management-plane authority

The fleet plane may:

- create/reconcile infrastructure from reviewed templates;
- read cell version, health, backup freshness, declared region, and incident
  state through an install-owned operational projection;
- request a governed upgrade, backup, restore test, or export;
- route a time-bounded support request for explicit approval.

It may not:

- query arbitrary customer application tables;
- mint customer users, roles, MCP tokens, Edge tokens, or coworker authority;
- run arbitrary shell/SQL inside a cell under standing credentials;
- move a cell across regions or providers without the customer's recorded
  change/consent path;
- bypass `/ops/self-upgrade`, backup, restore, or teardown gates.

Cell operation during management-plane loss is a requirement. Reconciliation
after recovery uses operation ids and observed cell generation to avoid replay.

## 14. Data protection, sovereignty, and exit

Before provisioning, the customer/operator selects:

- region and availability posture;
- public-origin or named-Tunnel reachability;
- subprocessor/provider set;
- encryption/key-ownership mode;
- backup frequency, retention, and restore-test cadence;
- public or local LLM/provider posture;
- support-access policy;
- exit target and maximum export/recovery objectives.

Backups are cell-scoped and encrypted. An accepted restore proves more than
database import: install identity, release compatibility, migrations, required
record invariants, files/objects, secrets re-binding, and application health.
Fleet dashboards may show backup age and last restore-test result, never backup
contents.

Exit supports transfer to customer-owned cloud or on-premises DPF. The package
contains portable data, file/object content, configuration inventory, release
identity, checksums, and restore instructions. Provider-specific IaC state is
either transferred or translated by a documented replacement path. Final
deletion produces evidence after retention and legal-hold obligations resolve.

## 15. Reliability and failure domains

| Failure | Expected containment and response |
| --- | --- |
| One cell origin fails | Only that customer is affected; health route and incident projection identify the cell; restore/failover follows its policy. |
| Cloudflare edge disruption | Origin remains administratively reachable through the declared break-glass/private path; DNS/provider replacement runbook is tested. |
| Tunnel loss | Cell stays running; connector reconnects; alerts distinguish edge reachability from application failure. |
| Management plane loss | Cells keep operating and upgrading only through already-authorized local schedules; later reconciliation is idempotent. |
| Upgrade failure | Existing self-upgrade recovery restores the prior accepted release; rollout ring pauses. |
| Backup/restore failure | Cell is not retired or promoted to stronger maturity; failure is customer-visible. |
| Provider credential compromise | Per-cell/per-function credentials bound blast radius; rotate and revoke without touching application identity. |
| Misrouting/cache contamination | Fail closed, purge only the affected hostname/namespace, retain request/cell evidence, run cross-cell incident review. |

## 16. Security and compliance gates

Before a design-partner pilot:

1. Complete the Cloudflare tool/vendor evaluation and data-flow/subprocessor
   review.
2. Threat-model hostname takeover, origin bypass, confused deputy, cache bleed,
   log leakage, support escalation, backup mix-up, and cross-cell automation.
3. Prove least-privilege provider credentials and per-cell secret separation.
4. Verify Cloudflare and origin audit export, clock alignment, retention, and
   incident correlation without collecting customer business payloads.
5. Verify data residency and cross-border behavior for the selected services;
   marketing labels are not evidence.
6. Run two-cell noninterference tests and restore into a third isolated target.
7. Record customer-visible shared-responsibility and exit terms.

No certification or compliance claim follows from using Cloudflare or a named
cloud service. Each deployment is assessed against the customer's actual
configuration, contracts, jurisdiction, and evidence.

## 17. Cost and scale gates

Isolated cells trade infrastructure density for security and architectural
reuse. The pilot records:

- recurring infrastructure per dormant, normal, and busy cell;
- provision/reconcile/upgrade/backup/restore/export minutes;
- operator/support minutes per cell per month;
- shared management/edge cost allocated per cell;
- minimum sustainable price without assuming pooled tenancy savings;
- provider quotas and the tested fleet ceiling.

Pooled tenancy is reconsidered only when measured demand cannot be served by
cell economics and when a separately approved design funds the full tenant-
binding rewrite and cross-tenant assurance program. It is not an optimization
hidden inside this roadmap.

## 18. Contributor contract

The proposed Cloudflare contributor works upstream on `BI-5ABF833E` or a
reviewed child slice. Contributions must:

- use the canonical repository, release artifacts, deployment contracts, and
  DCO/PR process;
- keep Cloudflare code behind the provider adapter boundary;
- include teardown/export and failure tests, not only happy-path provisioning;
- avoid adding Cloudflare state to customer business models;
- avoid provider-specific branches of application authorization or data logic;
- report unsupported Cloudflare features honestly instead of emulating them
  with an ungoverned side channel.

A demonstration fork may be used as disposable exploration, but no fork is a
supported product line or source of canonical migrations.

## 19. Public maturity language

The public surfaces distinguish:

- **Cloud Single VM — Early access:** current AWS/GCP/Azure customer-owned
  path; real-cloud reports still requested.
- **Cloudflare-fronted managed DPF — Research/design:** architecture and
  backlog are published; no production service is claimed.
- **Design-partner pilot:** begins only after the security/vendor evaluation
  and pilot infrastructure are approved.
- **Generally available:** requires repeatable multi-cell evidence, restore/
  exit proof, operating/support ownership, documented SLOs, and a commercial
  decision outside this architecture spec.

## 20. Open commercial decisions outside this spec

Architecture does not decide pricing, launch, staffing, terms, or which
customer receives a pilot. Those are organization-level business decisions
and require the organization's WWWD process with observed demand and cost
evidence.

## 21. Sources

- [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/)
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/)
- [Cloudflare Containers platform details](https://developers.cloudflare.com/containers/platform-details/)
- [R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Hyperdrive architecture](https://developers.cloudflare.com/hyperdrive/concepts/how-hyperdrive-works/)
- [Azure Deployment Stamps pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/deployment-stamp)
- [AWS SaaS Lens — silo isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-isolation.html)
- [AWS SaaS Lens — full-stack isolation](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/full-stack-isolation.html)
- [PostgreSQL row security policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
