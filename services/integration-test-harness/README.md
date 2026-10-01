# Integration Test Harness

Local contract and scenario harness for connector runtimes.

## Purpose

This service is test-only infrastructure for connector development. It provides:

- vendor discovery from `vendors/*`
- session-scoped scenario control via `POST /__control/scenario/{vendor}/{scenario}`
- vendor fixture responses for contract-shaped routes such as `/oauth/token` and `/hr/v2/workers`
- harness-admin event logging outside `IntegrationToolCallLog`

This is not a production connector runtime.

## Contract validation

Each vendor's `vendors/<vendor>/openapi.yaml` is loaded by `src/openapi-contract.ts`, the harness's own OpenAPI 3.0 runtime (it replaced Stoplight Prism in 2026-09; see [the design](../../docs/superpowers/specs/2026-09-25-harness-owned-contract-validator-design.md)). Every request is checked against its operation's path, query and header parameters and its request body. The response is the operation's `example` from its lowest `2xx` response, validated against its schema. A contract failure returns `422` with the diagnostics.

The runtime supports a closed subset: schema keywords `type`, `properties`, `required`, `items`, `enum`, `nullable` and local `$ref`; `GET` and `POST`; JSON and form-encoded bodies. A spec that uses anything else fails when the harness starts, naming the keyword and where it is. Extend the subset deliberately, with a test, when a vendor spec needs more.

## Key environment variables

- `PORT`
- `HARNESS_TEST_MODE=1`
- `HARNESS_CONTROL_TOKEN`
- `HARNESS_ADMIN_LOG_PATH`

## Scenario control

Requests must provide:

- `X-DPF-Control-Token`
- JSON body with `sessionId`

Connector requests against the harness should provide:

- `X-DPF-Harness-Session`

Scenario state is scoped by vendor plus session ID.
If no scenario has been flipped for a given vendor/session pair, the harness serves `happy-path` by default.

## Admin event log

Scenario flips are written to `HARNESS_ADMIN_LOG_PATH`, defaulting to:

```text
/tmp/harness-admin-events.ndjson
```

These are harness-control events, not connector tool-call audit rows.

## Local compose example

```powershell
$env:ADP_API_BASE_URL = "http://integration-test-harness:8700"
$env:ADP_TOKEN_ENDPOINT_URL = "http://integration-test-harness:8700/oauth/token"
$env:DPF_INTEGRATION_TEST_SESSION_ID = "local-compose-run"
$env:HARNESS_CONTROL_TOKEN = "integration-test-token"
docker compose --profile integration-test up -d integration-test-harness adp
```
