---
status: active
---

# ChatGPT endpoints honour strict-schema requests (BI-B76DC66C)

Design note and research for BI-B76DC66C, a delivery-medium fix. Shape decision:
DI-5890F6001F82, where the kernel was uncertain between large and medium at low
margin. The change fits the medium definition: one domain (routing), no new
substrate, no contract other domains depend on.

## Problem

Every semantic review asks for a JSON response. `routed-semantic-review.ts` sets
`activityContract.successShape: "json"`, so `buildEffectiveRequestContract`
passes an output schema and the contract has `requiresStrictSchema: true`.
Routing then excludes every endpoint whose `capabilities.structuredOutput` is not
`true` (`pipeline-v2.ts`, `Missing required capability: structuredOutput`).

On 2026-11-04 the only provider cleared for these reviews was `chatgpt`. Local
was paused by an operator, and anthropic-sub and codex were unconfigured. All
eight ChatGPT endpoints carried `structuredOutput: null`, so every review
outside the local provider was ineligible by construction: TR-GATE-6B2A28B9
(#6883) and TR-GATE-719602D0 (#6884), both `review-endpoint-ineligible`.

Two defects combine:

1. **The ChatGPT request never asks for structure.** In `chat-adapter.ts`, the
   `chatgpt` branch (Responses API at `chatgpt.com/backend-api/codex/responses`)
   ignores `plan.responsePolicy.strictSchema`. BI-5C48438C taught the
   OpenAI-compatible branch to send `response_format: {type: "json_object"}`,
   but the Responses branch was never updated.
2. **Discovery never records the capability.** `adapter-openai.ts` builds
   ChatGPT-backend cards from `EMPTY_CAPABILITIES`. It sets streaming, image
   input and (for the subscription) `toolUse: false`, but never
   `structuredOutput`. Only the curated `gpt-5.4` catalog entry says `true`, and
   that model is retired.

Declaring the capability alone would be a relaxed check: the router would
choose an endpoint that is never asked for structured output. Both halves must
change together.

## Research

A live probe on 2026-11-04 sent the same prompt to
`chatgpt.com/backend-api/codex/responses` (model `gpt-6.1-terra`) twice:

| `text.format` | HTTP | Output |
|---|---|---|
| `{type: "json_object"}` | 200 | a single JSON object |
| `{type: "json_schema", strict: true, schema}` | 200 | JSON matching the schema (the enum was respected) |

So the backend supports constrained decoding through the Responses API
`text.format` field. The Codex CLI's `--output-schema` relies on the same field,
and `probe-http-openai.ts` already records `supportsOutputSchema: true` for this
API family.

## Design

- **D1.** When `plan.responsePolicy.strictSchema` is true, the `chatgpt` branch
  of `chat-adapter.ts` sends `text: { format: { type: "json_object" } }`. This
  matches the OpenAI-compatible branch: the contract carries no concrete schema
  (`inferContract` receives `{}`), so a constrained JSON object is the strongest
  honest request. The response is still validated by the caller. For semantic
  reviews that is `reviewerResponseSchema` in `parseSemanticReviewResponse`, so
  a wrong shape stays inconclusive rather than passing.
- **D2.** `adapter-openai.ts` sets `capabilities.structuredOutput = true` only
  for the ChatGPT subscription's cards: `source: "chatgpt_backend_discovery"`
  with `discoveredForProvider: "chatgpt"`. D1 makes exactly that execution path
  honour the request. The `codex` provider shares the discovery path but runs
  through a different `chat-adapter.ts` branch, so its cards, and cards from
  every other OpenAI-family source, are unchanged.
- **D3.** Existing ChatGPT ModelProfile rows converge on the next metadata sync,
  which rewrites `capabilities` from the card. No migration or mirrored write is
  needed.

Out of scope:
- Passing a concrete JSON Schema through the plan, so strict `json_schema` can
  be sent.
- Restoring the anthropic-sub and codex connections.
- Lifting the operator pause on local.
- Changing which endpoints are cleared for confidential work.

## Acceptance

- **AC-CSO-1:** When a plan requires a strict schema, a ChatGPT request body
  carries `text.format` of type `json_object`. Without that requirement, it
  carries no `text.format`.
- **AC-CSO-2:** A model card discovered for the `chatgpt` provider declares
  `structuredOutput: true`. A card discovered on the same path for `codex`, and
  one from plain OpenAI `/v1/models` discovery, still leave it unset.
- **AC-CSO-3:** On the dev install, after release and metadata sync, a
  `successShape: "json"` semantic review that local cannot serve routes to a
  ChatGPT endpoint and completes. The proof is #6884's or #6883's
  Failure Readiness review.
