---
status: draft
---

# Typed asynchronous provider-operation handle repair

**Backlog item:** BI-2B619BC9
**Parent contract:** BI-801313EB
**Profile:** fix

## Problem and reproduced cause

At commit `0c09a6ad697b97a7bf16ed64e3f6b8b139c76e21`, the async adapter placed the provider operation ID only in `AdapterResult.raw`. `callProvider` and `callWithFallbackChain` intentionally did not expose raw provider data, while `routeAndCall` inspected `(result as any).raw?.operationId`. A provider could therefore accept a long-running request without the platform creating its existing `AsyncInferenceOp` tracking row.

The red tests prove the handle is lost at each typed boundary and that `createAsyncOperation` is never called. They also ruled out database persistence as the initiating cause because the persistence mock was not reached. Independent review then exposed two adjacent causes that become material once the path is reachable: the async return hard-coded false fallback provenance, and the old Gemini request/poll code described a `startInteraction` Google-LRO protocol that the current provider API does not expose. The current provider contract is `POST /v1beta/interactions` with `background: true`, an interaction `id`, and `GET /v1beta/interactions/{id}` for reconciliation.

## Objectives and acceptance criteria

- **OBJ-ASYNC-HANDLE-01:** **Typed authority:** preserve one validated provider-owned operation handle through the adapter, inference, fallback, and routed-persistence boundaries without treating raw provider metadata as authority.
- **OBJ-ASYNC-HANDLE-02:** **Real provider protocol:** start and reconcile only a provider protocol whose current request, response, and status contract is explicit; refuse unsupported providers before dispatch.
- **OBJ-ASYNC-HANDLE-03:** **Truthful routing provenance:** retain fallback downgrade evidence when a fallback provider accepts the asynchronous operation, while synchronous result shapes remain unchanged.
- **OBJ-ASYNC-HANDLE-04:** **Dispatch audit:** persist an accepted background start as a routed usage/audit row even when the provider has not yet reported completion tokens.

| ID | Objective | Acceptance criterion | Evidence |
| --- | --- | --- | --- |
| AC-ASYNC-HANDLE-01 | OBJ-ASYNC-HANDLE-01 | A valid async start carries a non-empty string provider handle through `AdapterResult`, `InferenceResult`, and `FallbackResult`, and `routeAndCall` passes that exact handle to `createAsyncOperation`. | Focused propagation tests |
| AC-ASYNC-HANDLE-02 | OBJ-ASYNC-HANDLE-02 | Gemini uses the current background Interactions create/get contract; malformed IDs and providers without an explicit long-running interaction contract fail before durable tracking can claim success. Polling treats the provider ID as opaque and never as an arbitrary URL. | Start/poll protocol tests |
| AC-ASYNC-HANDLE-03 | OBJ-ASYNC-HANDLE-03 | An accepted fallback start returns the real downgrade flag/message/reason; sync calls have no async handle and retain their existing result shape. | Fallback and routing regression tests |
| AC-ASYNC-HANDLE-04 | OBJ-ASYNC-HANDLE-04 | The accepted start writes one zero-token routed audit row before returning the platform operation ID; ordinary failed/stub zero-token results remain suppressed. | Routed metering regression test |

## Ordered fix sequence

1. Introduce `AsyncOperationStartResult` with distinct `providerOperationId` naming and propagate it through adapter, inference, and fallback result types.
2. Replace the obsolete Gemini start endpoint/body/response parser with the current background Interactions contract, validate the interaction ID, and reject unsupported providers before dispatch.
3. Update Gemini polling to retrieve the interaction by ID and map explicit provider terminal/running states, output steps, errors, and usage without inferring completion.
4. Persist the accepted-start audit row and platform `AsyncInferenceOp` only from the typed provider handle, then propagate fallback provenance into the routed result.
5. Prove red then green across adapter, polling, inference, fallback, and routed-persistence tests; run the adjacent graph and web typecheck. If the heavyweight local gate has no slot, record it as inconclusive and require every protected PR check.

## Boundaries

This fix restores an existing tracking path. It does not add request-digest idempotency, CAS leases, a durable worker, cursor reconciliation, cancellation dispatch, or completion UX; those remain in BI-801313EB and BI-05D7A0DC. Raw provider responses remain diagnostic data only. A normal chat-completion `id` is never accepted as a pollable operation handle.

The Gemini request and response shapes are bound to the current official [Interactions API](https://ai.google.dev/api/interactions-api-v1): `POST /v1beta/interactions` with `background: true`, then `GET /v1beta/interactions/{id}`. The provider ID is stored as opaque data and URL-encoded beneath the configured Gemini base URL.

## Rollback

Revert this slice to disable typed persistence and the current Interactions adapter together. Existing `AsyncInferenceOp` rows remain readable; no schema change is introduced by this fix.
