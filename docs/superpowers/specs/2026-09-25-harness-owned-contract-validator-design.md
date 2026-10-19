---
status: active
---

# Integration-test harness: own the contract validator, retire Prism

**Plan:** [dependency diet, move M4](../plans/2026-09-08-dependency-diet-and-vertical-integration-plan.md) · **Epic:** `EP-8DC217EB` · **Backlog:** `BI-BB1D8453` · **Doctrine:** `absorb-dont-adopt` (commandment)
**Decision:** founder, 2026-09-25 ("yes" to M4 in the dependency-architecture thread). The DPF MCP server was unreachable from that session, so the `principle_decide` record is still to be filed. §6 has the inputs for it.

## 1. Problem

`services/integration-test-harness` serves vendor fixtures (ADP, QuickBooks) to connector runtimes under test. It used Stoplight Prism (`@stoplight/prism-http` and `prism-cli` 5.16.0) for one job: check each request against the vendor's `openapi.yaml`, then answer with that spec's example.

Measured on the lockfile on 2026-09-25, Prism was:

- 110 resolved packages, the fourth-largest root in the workspace;
- 31 of the 195 duplicated package names, including three `@stoplight/types` majors, `pino@6`, `yaml@1` and old `whatwg-*` lines;
- the only reason `@faker-js/faker@5.5.3` was in the tree, carrying an accepted high-severity advisory (GHSA-qxc2-j82w-r537) that could not be floored;
- the only consumer of `@scarf/scarf`, an install-time telemetry package.

The harness itself is 1,360 lines. Prism was wired in through a 151-line adapter, including a logger shim to satisfy Prism's `pino` interface.

## 2. What the harness actually needs

Inventory of both committed specs (560 lines): the schema keywords are `type`, `properties`, `required`, `items`, `enum` and local `$ref`. Parameters are path and query. Request bodies are `application/x-www-form-urlencoded` or JSON. Every operation serves a single `example` from one `2xx` response. The harness only uses `GET` and `POST`.

## 3. Design

`src/openapi-contract.ts` (about 400 lines, no dependency except a YAML parser) replaces the adapter and keeps its interface (`createVendorContract`, `VendorContract.mock`, `ContractValidationError`), so `harness.ts` changes by one import.

- **Load:** parse `openapi.yaml`, then walk every schema, parameter, request body and response once. Anything outside the subset (an unknown schema keyword, a combinator, a remote or dangling `$ref`, a method other than GET/POST, an unsupported body type, OpenAPI 3.1, a missing `example`) throws `UnsupportedContractError` naming the keyword and its location. A newly pinned upstream vendor spec cannot be half-validated silently. The subset grows by a deliberate edit when a spec needs more.
- **Request:** match the path template, then check path, query and header parameters, coercing strings to their declared scalar type as Prism did. Check the body against the schema for its declared content type.
- **Response:** serve a copy of the example from the lowest `2xx` response, after validating it against its own schema. A spec whose example contradicts its schema fails the request, the same as Prism's output validation.

Annotation keywords (`description`, `title`, `example`, `default`, `format`) are accepted and not enforced. `format` is annotation-only by default in current JSON Schema, and the committed specs use it only for documentation.

## 4. Research and benchmarking

| Candidate | Verdict |
|---|---|
| **Stoplight Prism** 5.16.0 (current) | **Retired.** It is a full mock server with dynamic fake data, proxying and a CLI. The harness used static examples and validation only. It brought 110 packages, an unfixable high advisory through `faker` 5, and install telemetry. |
| **openapi-backend** 5.21 (MIT) | **Rejected.** Ten direct dependencies, including `ajv`, `lodash`, `qs` and `@apidevtools/json-schema-ref-parser`. It is broader than the need, and adds a second schema engine beside `zod`. |
| **express-openapi-validator** 5.6 (MIT) | **Rejected.** Fourteen direct dependencies (ajv, multer, lodash helpers) and an Express middleware shape. The harness is a plain `node:http` server. |
| **@readme/openapi-parser** + ajv | **Rejected** for the same reason: a general-purpose parser and validator stack to cover six keywords. |
| **WireMock / Microcks** (mock servers as services) | **Rejected.** They are always-on JVM or containerized services beside the platform. That is adopting, not absorbing. |
| **Owned subset validator** + `yaml` (ISC, zero dependencies) | **Adopted.** It covers exactly what the committed specs use, fails closed on everything else, and adds no package: `yaml@2.9.0` was already resolved in the lockfile. |

What DPF gives up: dynamic fake data (the harness never used it) and Prism's broader OpenAPI coverage. The fail-closed loader makes the second loss visible the day a spec needs it.

## 5. Security

The validator reads only repo-committed vendor specs, never input from the network. Request validation is a test-fidelity check, not a security boundary: the harness runs only under the `integration-test` compose profile, never on an install's request path. `yaml` parses only those committed files.

## 6. Decision inputs for the `principle_decide` record

Options: `own_subset_validator` vs `keep_prism` vs `rent_ajv_stack`. Cost axes, with higher meaning worse: owning scores low on `vendor_lock_in` and `blast_radius` (one test-only service, same interface), and moderate on `operator_effort` (the subset must grow deliberately). Keeping Prism scores high on `vendor_lock_in` and carries the unfixable high advisory. Renting an ajv stack adds a second schema engine and 10 to 14 direct dependencies.

## 7. Acceptance

- The two pre-existing contract tests pass unchanged (happy path, and rejection of a non-integer `$top`).
- Every route in both committed vendor specs is served (`openapi-contract.test.ts`).
- Load-time refusal is covered for each unsupported construct listed in §3.
- `@stoplight/*`, `@faker-js/faker`, `@scarf/scarf` and `pino@6` are gone from the lockfile, and the harness no longer declares `pino` (`pino@10` stays as a transitive of `imapflow` in `apps/web`). `@stoplight/prism-cli` and `@stoplight/prism-http` are on the dependency allowlist's `retired` list, which the New Dependency Gate refuses. The accepted `faker` advisory leaves `sbom/vuln-baseline.json`.
