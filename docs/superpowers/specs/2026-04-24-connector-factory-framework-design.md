# Connector Factory Framework Design

| Field | Value |
|---|---|
| Date | 2026-04-24 |
| Status | Draft |
| Epic | `EP-INT-2E7C1A` Integration Harness Benchmarking |
| Related Backlog | `BI-INT-59E6B4`, `BI-INT-92C1F8`, `BI-LAB-72E4AB` |
| Primary Scope | Multi-vendor connector test harness, contract-driven mocking, shared connector runtime seams, and ADP retrofit path |

## Problem Statement

DPF now has one concrete enterprise connector implementation in [`services/adp/`](D:/DPF-connector-factory-spec/services/adp), plus earlier service-container precedent in [`2026-04-06-browser-use-integration-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-04-06-browser-use-integration-design.md:1). That ADP slice proves the platform can store encrypted customer-supplied credentials, run a dedicated connector service, and audit tool calls into shared tables. It also exposes the current pain:

- ADP was hand-rolled end to end, so the next enterprise connector starts from scratch instead of from a reusable connector framework.
- The Payroll Specialist coworker cannot be tested realistically without live ADP credentials because there is no vendor-faithful local harness.
- Shared primitives already duplicated between portal and service code, especially credential crypto, token exchange scaffolding, and redaction logic.
- Existing harness work in [`2026-03-17-agent-test-harness-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-03-17-agent-test-harness-design.md:1) validates model behavior, not third-party connector contracts or upstream API drift.

The platform needs a connector factory framework that lets DPF add vendor integrations by supplying a vendor contract and fixtures, not by re-inventing runtime, test, and certification infrastructure each time.

This must preserve the conduit principle captured in [`feedback_dpf_as_integration_conduit.md`](C:/Users/Mark%20Bodman/.claude/projects/d--DPF/memory/feedback_dpf_as_integration_conduit.md:1): DPF is a conduit, never a broker. Customers bring their own vendor relationships and credentials; DPF supplies connector code, local testing, and governance.

## Goals

- Standardize how enterprise connectors plug into DPF without collapsing all vendors into one monolith.
- Add a multi-vendor local test harness that validates requests against OpenAPI and returns scenario-controlled responses.
- Make local and sandbox testing possible without live ADP, QuickBooks, or other production credentials.
- Reuse the existing shared substrate in [`IntegrationCredential` and `IntegrationToolCallLog`](D:/DPF-connector-factory-spec/packages/db/prisma/schema.prisma:1) rather than inventing per-vendor storage.
- Define a clean retrofit path for the existing ADP connector and a proof path for the second vendor.
- Detect vendor contract drift early through a scheduled CI check against committed vendor contracts.

## Non-Goals

- Replacing the browser-use service pattern from [`2026-04-06-browser-use-integration-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-04-06-browser-use-integration-design.md:1). The connector harness is a sibling test/runtime utility, not a replacement for browser QA automation.
- Replacing the model/agent test harness from [`2026-03-17-agent-test-harness-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-03-17-agent-test-harness-design.md:1). The connector harness complements it.
- Bilateral Pact verification with vendors. Vendors do not run DPF’s pacts, so Pact-style consumer/provider choreography is the wrong fit.
- Turning DPF into an ADP, QuickBooks, or Workday partner-of-record. The conduit principle explicitly rejects that architecture.
- Making VCR-style record/replay the primary integration-testing pattern.
- Generalizing every connector into one mega-service before a second and third vendor prove that such a move is necessary.

## Research & Benchmarking

### Best-of-breed tools reviewed

| Tool | What it does well | Why DPF is or is not adopting it |
|---|---|---|
| [Prism](https://docs.stoplight.io/docs/prism/674b27b261c3c-openapi-support) / [Stoplight Prism GitHub](https://github.com/stoplightio/prism) | Mocks from OpenAPI and validates incoming requests and outgoing examples against the contract. Strong fit for contract-first API simulation. | **Adopted as the core mock/validation engine.** It matches DPF’s need to treat each vendor OpenAPI as the living connector contract and to fail early when connector requests drift. |
| [WireMock](https://wiremock.org/docs/) | Very mature HTTP stubbing, request matching, and fault simulation. Good when teams want explicit stub definitions and proxy/record workflows. | Not the core choice. It is strong for stub matching, but DPF wants OpenAPI to be the primary contract artifact rather than handwritten stub rules. Scenario overrides can be layered separately without making WireMock the center of the design. |
| [Mountebank](https://www.mbtest.org/docs/api/overview) | Multi-protocol test doubles and flexible imposters. Good when teams need HTTP plus other protocols in one mocking runtime. | Not adopted. DPF’s immediate connector need is HTTP API contracts, especially OAuth/token plus JSON resource APIs. The extra protocol breadth is not the primary bottleneck. |
| [Hoverfly](https://docs.hoverfly.io/en/latest/) | Strong proxy simulation, traffic virtualization, and middleware. Useful for API simulation and traffic capture. | Not adopted as the primary pattern because DPF does not want capture/replay to become the source of truth; contracts must stay explicit and reviewable. |
| [Pact](https://docs.pact.io/) | Excellent when both consumer and provider participate in consumer-driven contract workflows. | Explicitly rejected for vendor integrations because third-party vendors do not run DPF’s consumer contracts. This is the wrong operational model for public SaaS APIs. |
| [MSW](https://mswjs.io/docs/) | Excellent browser/node interception for frontend or unit/integration tests inside an app process. | Not adopted for harness e2e. MSW is great for app-local tests, but DPF needs an out-of-process service harness that connector containers and sandbox environments can talk to over the network. |
| [nock](https://github.com/nock/nock) | Lightweight Node HTTP interception for unit tests. | Useful for small vendor unit tests, but insufficient for sandbox/e2e because it is in-process and invisible to service containers. |
| [Polly.js](https://netflix.github.io/pollyjs/#/) | Record/replay plus API interception and persistence. | Explicitly not the primary approach. It risks silent contract drift, overfits recorded responses, and weakens the “living contract” discipline DPF wants. |
| [Postman Mock Servers](https://learning.postman.com/docs/designing-and-developing-your-api/mocking-data/setting-up-mock/) | Easy hosted mocking from saved examples and useful for collaboration during API design. | Useful as a commercial comparator, but not the right center for DPF because DPF wants self-hosted, git-committed, on-prem/private contract mocks rather than cloud-hosted mock state. |

### Patterns adopted

- **OpenAPI as the committed contract artifact** from Prism’s model: each vendor contributes an OpenAPI document that becomes the harness contract.
- **Scenario-based response overrides** on top of the contract mock, rather than replacing the contract mock with bespoke vendor code.
- **Out-of-process networked harness** instead of in-process mocking, so connector containers, browser-use flows, and sandbox tests all hit the same test surface.
- **Vendor-local fixture directories** so adding a new vendor is additive, not a framework rewrite.

### Patterns rejected

- **Snapshot-only record/replay** as the primary source of truth.
- **In-process mocks for end-to-end connector verification** because they do not exercise real network, auth, and container wiring.
- **Per-integration bespoke harness code** as the default. Vendor-specific code should be the thin exception layer, not the framework.

### Anti-patterns this design avoids

- Silently drifting mocks that no longer match vendor contracts.
- Test-only credential paths that bypass `IntegrationCredential`.
- Connector services with duplicated crypto/redaction/token scaffolding.
- Partner-of-record assumptions that break the conduit architecture.

## Existing DPF Baseline

### Shared substrate already in the repo

- [`IntegrationCredential`](D:/DPF-connector-factory-spec/packages/db/prisma/schema.prisma:1) is already the canonical encrypted credential store for enterprise connectors.
- [`IntegrationToolCallLog`](D:/DPF-connector-factory-spec/packages/db/prisma/schema.prisma:1) already captures connector tool audit trails.
- [`services/adp/src/lib/db.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/db.ts:1) proves a standalone service can read/write those tables without bundling Prisma into the service container.

### ADP is the current concrete connector

The existing ADP runtime in [`services/adp/`](D:/DPF-connector-factory-spec/services/adp) is the first connector consumer of the framework this spec defines, not a throwaway prototype. It already has:

- connector-local token exchange and API clients
- credential refresh logic
- response redaction and suspicious-content scrubbing
- audited MCP tools for workers, pay statements, time cards, and deductions

It also has explicit TODOs to deduplicate [`crypto.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/crypto.ts:1), [`redact.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/redact.ts:1), and [`token-client.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/token-client.ts:1) with app-side equivalents.

### Earlier harness/service work

- [`2026-04-06-browser-use-integration-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-04-06-browser-use-integration-design.md:1) establishes the compose/service-container precedent for an opt-in supporting service.
- [`2026-03-17-agent-test-harness-design.md`](D:/DPF-connector-factory-spec/docs/superpowers/specs/2026-03-17-agent-test-harness-design.md:1) remains the model/agent evidence harness and should not be superseded by this design.

## Design

### 1. Service topology

DPF keeps vendor connector runtimes separate from the test harness:

```text
portal / coworker runtime
        |
        | MCP / app actions
        v
services/<vendor>/        -> real vendor runtime using customer BYO credentials
        |
        | test mode via env overrides
        v
services/integration-test-harness/  -> contract mock + scenarios + control API
```

This preserves a clean boundary:

- `services/<vendor>/` remains the production connector runtime.
- `services/integration-test-harness/` is a test-only utility container.
- The framework does **not** absorb ADP into a monolithic `services/connectors` runtime in v1.

### 2. Harness directory layout

```text
services/integration-test-harness/
├── vendors/
│   ├── adp/
│   │   ├── openapi.yaml
│   │   ├── scenarios/
│   │   │   ├── happy-path.json
│   │   │   ├── rate-limited.json
│   │   │   ├── auth-failure.json
│   │   │   ├── token-expired.json
│   │   │   ├── empty-list.json
│   │   │   ├── malformed-response.json
│   │   │   └── jailbreak-content.json
│   │   └── routes.ts
│   ├── quickbooks/
│   │   ├── openapi.yaml
│   │   ├── scenarios/
│   │   └── routes.ts
│   ├── ...
│   └── ...
├── control-api.ts
└── harness.ts
```

Adding a vendor means dropping in a contract and scenario fixtures. The framework should not need to change.

### 3. OpenAPI-driven contract mocking

Each vendor directory supplies a committed OpenAPI/Swagger spec:

- If the vendor publishes a public OpenAPI, DPF commits a pinned copy into `vendors/<vendor>/openapi.yaml`.
- If the vendor does not publish a freely accessible OpenAPI, DPF authors a contract from the vendor’s public API docs and commits that authored OpenAPI as the living contract.
- Prism is the contract engine. The harness uses it to:
  - validate incoming requests against the vendor contract
  - generate schema-valid mock responses
  - flag request/response drift when connector code no longer matches the committed contract

This keeps the contract explicit and reviewable in git instead of buried in recorded traffic.

### 4. Scenario-override fixtures

Prism supplies the contract-valid baseline. A thin scenario layer sits on top to force test states that matter to DPF:

- `happy-path`
- `rate-limited`
- `auth-failure`
- `token-expired`
- `empty-list`
- `malformed-response`
- `jailbreak-content`

`routes.ts` in each vendor directory declares how fixtures attach to concrete endpoints and when the harness should return a scenario file instead of the default Prism-generated response.

The override layer must stay thin:

- it can force a specific status/body/header set
- it can inject malformed or adversarial payloads for resilience tests
- it must not replace the underlying contract validation step

The `jailbreak-content` scenario is specifically for end-to-end verification that redaction and suspicious-content scrubbing work under realistic connector responses.

### 5. Control API

The harness exposes:

```text
POST /__control/scenario/{vendor}/{scenario}
```

Behavior:

- flips the active vendor scenario for a specific harness test namespace rather than the whole process
- supports test sequencing within one e2e run
- returns current scenario state and last change metadata

Isolation model:

- control requests must include a `sessionId`
- connector requests to the harness must include the same session identifier, for example via `X-DPF-Harness-Session`
- scenario state is scoped per vendor + session ID
- the process-global default namespace is allowed only for explicit single-user local development and must not be used in CI

The control API is only available in the test profile and must reject activation in production compose.

### 6. Compose and environment wiring

The harness only runs when the compose test profile is active.

Connector runtimes support vendor-specific overrides:

- `<VENDOR>_API_BASE_URL`
- `<VENDOR>_TOKEN_ENDPOINT_URL`

In test mode, the service points those values at the harness container instead of the real vendor endpoints. For ADP, this means the existing real endpoints in [`token-client.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/token-client.ts:1) and [`adp-client.ts`](D:/DPF-connector-factory-spec/services/adp/src/lib/adp-client.ts:1) become defaults rather than hardcoded absolutes.

Test-mode requirements:

- plain HTTP to the harness is allowed
- mTLS validation is relaxed or bypassed when the base URL points at the harness
- certificate correctness remains a separate live-smoke concern, not a harness concern

### 7. Shared library strategy

The current duplication between app and connector runtime should be extracted into a workspace package, using the name already hinted by the ADP TODOs:

```text
packages/integration-shared/
```

Initial scope:

- credential envelope crypto primitives
- suspicious-content and redaction primitives
- connector audit helpers for `IntegrationToolCallLog`
- shared HTTP/auth helper interfaces where vendor-agnostic

Not everything should move:

- vendor-specific token endpoints stay vendor-specific
- vendor-specific response mapping stays in `services/<vendor>/`
- vendor-specific MCP tools stay vendor-specific

The purpose of the shared package is to deduplicate cross-cutting connector runtime code, not to erase vendor boundaries.

### 8. Credential and audit integration

The framework extends existing models rather than duplicating them:

- `IntegrationCredential` remains the canonical connector credential record.
- `IntegrationToolCallLog` remains the canonical connector audit table.
- The harness may seed test-only credentials for local test flows, but production connector code always reads from the same shared substrate.

This keeps local test mode and production mode aligned on storage, encryption, and audit conventions.

### 9. Contract-drift CI

A scheduled weekly CI job checks each vendor contract:

1. fetch the latest vendor OpenAPI when a public source exists
2. diff it against the committed copy
3. fail on breaking changes such as deleted fields, changed types, or new required fields
4. open backlog/workflow noise early, before production connectors break

For vendors without public OpenAPI:

- the authored contract in git is still the source of truth
- the CI job records that the vendor is on manual-contract maintenance
- follow-up review is required when public docs change or live smoke detects mismatch

The CI job is part of the connector framework because contract drift is a framework problem, not a vendor one-off.

## Integration With Existing Work

### ADP retrofit path

ADP stays in [`services/adp/`](D:/DPF-connector-factory-spec/services/adp) as a connector consumer.

That is the recommended retrofit because:

- ADP already has working production-oriented tool code
- keeping it as a standalone service preserves a clear vendor boundary
- the harness can prove the framework without forcing a runtime re-platform at the same time

What changes for ADP:

- adopt `ADP_API_BASE_URL` and `ADP_TOKEN_ENDPOINT_URL`
- add ADP vendor fixtures under `services/integration-test-harness/vendors/adp/`
- move shared crypto/redaction/audit primitives into `packages/integration-shared/`
- keep ADP-specific request mapping, tool schemas, and payroll semantics inside `services/adp/`

### Relationship to browser-use

The browser-use service remains the QA/browser automation layer. It can later drive connector setup or e2e verification flows against UI surfaces, but it does not replace the connector harness.

### Relationship to the agent test harness

The earlier agent harness keeps owning model/coworker evaluation. The connector harness owns upstream API simulation and connector contract verification. A later plan can let a coworker e2e test orchestrate both in one workflow, but they remain separate systems.

## Phased Implementation

### v1: ADP-only harness foundation

- create `services/integration-test-harness/`
- add ADP vendor directory
- commit an initial `vendors/adp/openapi.yaml` in this phase, even if some responses are still hand-authored before full Prism enforcement lands
- wire compose test profile
- add `ADP_API_BASE_URL` and `ADP_TOKEN_ENDPOINT_URL` overrides
- land initial scenario fixtures, even if some are hand-authored before Prism is fully integrated
- extract the first shared primitives into `packages/integration-shared/`

### v2: Prism-backed ADP contract

- integrate Prism as the harness contract engine
- replace hand-rolled baseline ADP mocks with Prism + ADP `openapi.yaml`
- keep scenario overrides as the thin exception layer
- add contract-validation checks in connector test runs

### v3: Second-vendor proof with QuickBooks

- add `vendors/quickbooks/`
- prove zero framework changes beyond vendor files
- validate the shared-library boundary against a materially different OAuth/API shape

### v4: Contract-drift CI

- add weekly contract-drift workflow
- alert on breaking vendor contract changes
- wire drift detection into backlog/review operations

### Current plan scope

The immediate implementation plan should cover **v1 plus the structural seams needed for v2**, not all four phases at once. That means the current plan should land:

- the harness container and vendor directory contract
- ADP env override support
- ADP retrofit path
- shared-library extraction seam
- fixture/scenario control model

Prism-backed validation should follow immediately after the harness skeleton exists, but the first plan should not block on every vendor’s public OpenAPI availability.

## Security

### Test-mode mTLS handling

- mTLS is disabled or bypassed only when a connector explicitly targets the local harness via test-mode override URLs.
- Real vendor endpoints continue to require their normal transport security.
- Live cert correctness remains verified in live-smoke or tenant-backed tests, not in the local harness.

### Control API exposure

- the control API is not published in normal compose or production profiles
- in test profile it should require a local shared secret or network-local access only
- production attempts should fail closed

### Scenario injection surface

Because the harness intentionally injects malformed and adversarial payloads:

- scenario changes must be explicit and observable
- the control API must log scenario flips as harness-admin events, not as `IntegrationToolCallLog` rows
- adversarial scenarios must stay test-profile only
- connector code must continue to redact, scrub, and audit even under scenario overrides

### Credential handling

The harness does not change the conduit model:

- customers still supply their own credentials
- credentials remain encrypted locally
- DPF never becomes the customer-of-record with the vendor

## CoSAI Summary: Prism Adoption

Prism is the only new tool adoption introduced by this spec.

### Why it is acceptable

- open source and widely used for OpenAPI mocking and validation
- directly aligned with DPF’s contract-first connector-testing need
- runs as a local/dev/test component, not a customer-facing production dependency

### Constraints on adoption

- pin the Prism version in the harness image
- keep it inside the test harness service boundary
- do not let Prism-generated mocks become the sole source of fixture truth for adversarial scenarios
- require committed vendor contracts in git so review happens on the contract, not just on generated behavior

### Operational posture

- profile-gated, not always-on in production compose
- no change to customer credential custody
- no change to DPF’s conduit architecture

## Open Questions

- Does ADP expose a publicly accessible OpenAPI suitable for committed use, or will DPF need to author and maintain the initial ADP contract from docs?
- Does QuickBooks expose a public OpenAPI for the relevant APIs, or will its first contract also need to be authored from official docs?
- Are Workday and Plaid candidates likely to have public OpenAPI artifacts, or should DPF assume authored contracts for those classes of vendor?
- After two or three vendors, does `services/<vendor>/` still look right, or does evidence justify a future `services/connectors/` runtime? This spec intentionally defers that generalization.

## Recommendation

Adopt a **multi-vendor, Prism-centered connector harness** as a sibling test service while keeping vendor runtimes separate. Retrofit ADP onto it first, prove the architecture with QuickBooks second, and only then decide whether any deeper runtime consolidation is warranted.

That path subsumes the useful parts of the current ADP implementation, preserves the conduit architecture, and gives DPF a credible route to Make-style connector breadth without rebuilding the same scaffolding per vendor.
