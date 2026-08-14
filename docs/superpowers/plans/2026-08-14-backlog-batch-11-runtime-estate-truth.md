# Batch 11 — Runtime and Estate Truth

## Goal

Complete ten live BacklogItems as one operator-directed batch while keeping their dispositions truthful. The shared concern is trustworthy platform operation: the deployed source must be searchable, server/client rendering must agree, discovery must represent observed estate rather than phantom inventory, federation must distinguish provenance structurally, and governed worktrees must use one dependency policy.

This plan does not assume every intake hypothesis still requires new code. Each item first receives a source, test, live-state, and overlap audit. An item closes only after its acceptance criteria are implemented or fresh evidence proves the behavior already exists; superseded and overlapping work remains linked rather than reimplemented.

## Live backlog scope

1. `BI-872048AF` — deployed spec/plan source resolution
2. `BI-CEC0A528` — Estate Discovery hydration mismatch
3. `BI-B19C41B8` — evidence-based discovery and phantom-product cleanup
4. `BI-37718BE7` — scheduled connection collectors and health
5. `BI-B736382D` — consumer/IoT fingerprint coverage
6. `BI-57C27DE1` — privacy-filtered fingerprint commons loop
7. `BI-75712C2F` — structural federation origin-marker filtering
8. `BI-8A7E3E56` — bounded dead-letter re-healing
9. `BI-271222BD` — repository-pinned pnpm in governed runners
10. `BI-8F19A3E6` — coalesced dependency-policy readiness

## Validity and overlap baseline

| BacklogItem | Baseline disposition | Grounded evidence |
|---|---|---|
| BI-872048AF | implement | The live MCP search returns no result for Batch 10 although the deployed upgrade workspace contains the plan. `apps/web/lib/backlog/spec-plan-search.ts` currently resolves only from `process.cwd()` and a two-level climb. |
| BI-CEC0A528 | implement | `TopologyGraph` is a client component and `TopologyIntegritySummary` renders `toLocaleString()` during the first render, creating a server/browser text divergence. |
| BI-B19C41B8 | partially implemented; finish | ARP scanning now rejects saturated no-MAC output and excludes network/broadcast addresses, but reconciliation demotes only platform-internal infrastructure and can retain historical bare ARP products. |
| BI-37718BE7 | verify existing / overlap | The hourly full-discovery Inngest sweep already invokes the canonical bootstrap runner, including SNMP/ARP connection collectors and per-connection health writes. Direct UniFi portal polling was deliberately retired in favor of edge-node ownership. |
| BI-B736382D | valid | The shipped catalog still contains 13 estate rules and lacks several measured operator-estate consumer/IoT vendors. |
| BI-57C27DE1 | partially implemented; finish | The redaction, consent, contribution ledger, and inbound fixture gate exist, but the contribution entry point is not invoked by a confirmed-identification path. |
| BI-75712C2F | implement | Same-org reconciliation still uses a broad Prisma `contains` predicate for `[origin:federatedDemand:`. |
| BI-8A7E3E56 | verify existing | PR #4122 evidence says bounded dead-letter re-healing landed; fresh focused and canonical-runtime evidence is still required for closure. |
| BI-271222BD | absorbed by dependency-policy delivery | It is the concrete Codex/pnpm failure that the broader `BI-8F19A3E6` acceptance contract must prevent. |
| BI-8F19A3E6 | valid | The repository has managed worktree bootstrap and dependency policy primitives, but parity and exact-key coalescing must be checked and completed. |

## Phases

### 1. Deterministic runtime reads and rendering

- Add one deployed-source resolver for spec/plan filesystem reads. Prefer an explicitly configured source root; otherwise evaluate the governed upgrade workspace and normal checkout markers, rejecting a stale root when deployed identity points elsewhere.
- Expose the resolved source identity to tests/diagnostics and cover the stale-root plus `.upgrade-workspace` layout.
- Replace locale-sensitive first-render text in the Estate Discovery topology summary with the shared hydration-safe time primitive and add a focused server/client render regression.
- Verification: focused spec-plan and inventory component suites.

### 2. Evidence-based estate collection and deterministic identification

- Preserve the collector's existing saturated-scan quarantine and network/broadcast exclusion.
- Extend the canonical promotion/reconciliation policy so historical bare, observation-only LAN hosts cannot remain DigitalProducts, without demoting corroborated managed devices.
- Add the scheduled active-connection runner using the existing connection collector and job substrate; persist/surface last-run health through the canonical `DiscoveryConnection` record rather than a parallel scheduler store.
- Expand the catalog only with generalizable vendor/class signals mapped to existing taxonomy and covered by positive/negative fixtures.
- Wire confirmed generalizable rules through the existing `contributeDeviceFingerprint` boundary and preserve opt-in, redaction, draft/local inbound activation, and immutable contribution audit.
- Verification: focused database collector, promotion, reconciliation, catalog, contribution, runner, and web connection-health suites; migration apply if the canonical connection record needs additive fields.

### 3. Federation provenance and re-healing

- Extract one structural parser for the canonical standalone federation origin-marker line and reuse it for outbound eligibility and summary scrubbing.
- Re-run bounded dead-letter re-heal regressions and exercise the canonical runtime path with a controlled peer-missing record if the live fixture supports it.
- Verification: focused federation reconciliation, delivery queue, and digest suites.

### 4. Governed dependency readiness

- Ensure managed bootstrap and local-CI entry points resolve the repository `packageManager` pin before invoking pnpm, including Codex-provided PATHs.
- Reuse existing dependency-status and ignored-build classification; add exact-key coalescing by base SHA, package/version, and policy/error code only if no canonical incident/finding key already provides it.
- Preserve distinct events and immutable occurrence audit; keep raw package-manager details behind operator-appropriate summary copy.
- Verification: bootstrap, local-CI, dependency-policy, and cross-platform script tests.

### 5. Merge and canonical-runtime acceptance

- Run affected unit suites, production web build, migration gate when applicable, policy/doc-impact checks, and the governed merged-code local CI gate.
- Obtain the required semantic review receipt, push, open a ready PR, pass `pnpm pr:health`, and merge through the queue.
- Deploy only through `/ops/self-upgrade`; prove served SHA identity.
- Re-drive `/platform/tools/discovery`, query the live spec/plan search, inspect discovery/federation health, and record server-resolved evidence for each item before status transitions.

## Implementation outcome before promotion

- Implemented deployed-source resolution, hydration-safe topology evidence,
  conservative ARP-only product demotion, expanded fixture-gated fingerprint
  coverage, fingerprint contribution coalescing, structural federation marker
  parsing, and repository-pinned dependency readiness.
- Verified the existing hourly collector cadence and health projection for
  `BI-37718BE7`; no second scheduler or retired UniFi portal poller was added.
- Verified the bounded dead-letter re-heal suite for `BI-8A7E3E56`, which was
  already delivered by PR #4122; this batch adds no duplicate implementation.
- Treated `BI-271222BD` as the concrete failure case absorbed by
  `BI-8F19A3E6`, preserving one dependency-policy implementation and exact
  base/package/reason review identities.

## Risks and rollback

- Discovery cleanup can remove legitimate product links if evidence classes are too broad. Keep the decision pure and fixture-heavy, and make cleanup idempotent and conservative.
- Scheduled collection can increase network or portal load. Reuse bounded collectors, per-connection cadence, and the existing job/lease substrate; do not add an in-process unbounded timer.
- Source-root selection can expose stale or arbitrary host files. Require known repository markers and deployed-identity agreement; keep paths read-only.
- Dependency bootstrap changes affect every contributor surface. Fail source-only with an explicit reason rather than mutating dependencies with an unpinned runtime.
- The PR is rolled back as one squash commit through the normal release path; data changes, if any, are forward-only and must remain safe when the feature code is rolled back.

## Documentation impact

Update operator/contributor documentation for any changed discovery cadence, fingerprint contribution behavior, or managed-worktree readiness contract. The plan itself is the durable validity ledger; no public route or API claim is considered complete while its docs remain stale.

## UX fit review — device catalog progressive disclosure

- **Decision:** fits-with-guardrails
- **Owning area:** Platform
- **Route family:** `/platform/device-catalog`
- **Primary persona:** MSP/platform operator identifying estate devices without reading the complete fingerprint corpus on arrival
- **Navigation layer touched:** local disclosure only
- **Reuse/convergence:** native `details`/`summary` preserves the existing server component and catalog table; no new client state or duplicate catalog read model
- **Source truth:** `buildPublicDeviceCatalog` remains the sole projection over active global `DiscoveryFingerprintRule` records
- **Empty/failure behavior:** the existing honest empty state is unchanged; the disclosure appears only when more than 8 entries exist
- **AI boundary:** no prompt or coworker action
- **Guardrails:** closed by default; count-labelled summary; theme-token focus indicator; full tail remains keyboard reachable
- **Evidence before merge:** red-green server-render regression, arrival-content assertion, web typecheck, exact-tree local CI, GitHub route-budget sweep, and canonical-runtime keyboard/viewport verification
- **Captured in:** `docs/ux-fit/2026-08-14-device-catalog-progressive-disclosure.ux-fit.json` and kernel decision `DI-DD4FD7B9FF43`

## Backlog coverage

Coverage receipt `cmstje3gy00iv01nzkhpe2xw2` records a decomposed mapping from umbrella `BI-B19C41B8` to all ten live items in this batch. `collector-cadence` and `fingerprint-catalog` depend on `evidence-discovery`; `fingerprint-commons` depends on `fingerprint-catalog`; `dead-letter-reheal` depends on `origin-marker`; and `dependency-policy` depends on `pinned-pnpm`.

The operator explicitly requested ten BIs per PR for this campaign. That batching direction governs the integration shape while each independently shippable disposition remains mapped to its own live BacklogItem and receives item-specific completion evidence.
