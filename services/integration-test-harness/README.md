# Integration Test Harness

Local contract and scenario harness for connector runtimes.

## Purpose

This service is test-only infrastructure for connector development. It provides:

- vendor discovery from `vendors/*`
- session-scoped scenario control via `POST /__control/scenario/{vendor}/{scenario}`
- harness-admin event logging outside `IntegrationToolCallLog`

This is not a production connector runtime.

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

## Admin event log

Scenario flips are written to `HARNESS_ADMIN_LOG_PATH`, defaulting to:

```text
/tmp/harness-admin-events.ndjson
```

These are harness-control events, not connector tool-call audit rows.
