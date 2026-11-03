---
status: draft
---

# Preserve the Responses request contract during compatibility recovery

Corrective carrier: BI-E78253FF. Historical carrier: BI-EFA3869E / PR5520 remains delivered. This is a bounded defect correction, not a new routing capability.

**OBJ-1:** Preserve the caller's required behavior when a provider rejects a request field.
**OBJ-2:** Retain the existing optional-temperature compatibility behavior.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-CONTRACT | OBJ-1 | A named unsupported required field receives one classified provider rejection without deleting the field and retrying. |
| AC-OPTIONAL | OBJ-2 | An unsupported temperature setting may be removed for one retry, with every remaining field identical. |
| AC-CHATGPT | OBJ-2 | The ChatGPT backend continues to omit temperature before its first request. |
| AC-DELIVERY | OBJ-1, OBJ-2 | Affected tests, TypeScript checks, independent source assessment and governed integration qualify the correction before protected publication. |

## Evidence and research

At source23d1cad11fc55165b51cbe9374860c920191ffe1, the actual adapter accepted a text-only response after deleting tools, required tool_choice or instructions. The in-memory reproduction exited1 and is recorded as cmvx218cf4f3r01pndtrpj4nh. It used no real provider, credential, private data or stored task. This proves the source defect, not causality for a previous live failure.

The official [OpenAI Function calling guide](https://developers.openai.com/api/docs/guides/function-calling) defines required tool choice as requiring tool calls. Deleting that requirement changes the request. The existing adapter's request builder also carries storage policy, instructions, identity and output limits. We adopt the explicit required/optional distinction and reject silent broad deletion. This bug correction introduces no dependency or competing implementation; a market comparison cannot change the provider's request contract.

## Existing substrate and decision

Keep unsupportedParameterName and the existing two-attempt loop in apps/web/lib/routing/responses-adapter.ts. Permit the narrowing branch only when the named field is temperature and exists in the actual body. All other HTTP errors retain current classification. A denylist of today's semantic fields is rejected because future fields could escape it; general deletion is rejected by the reproduction.

Boundary: the adapter owns serialization and optional compatibility retry. Existing authentication, authorization, provider selection, model quality, quota and task lifecycle remain with their current owners. This repair does not authorize replay, change any public response schema, persist data or create a provider. No migration, seed or install change is required.

## Verification and rollback

Add table-driven regression cases for tools, tool_choice, instructions, input, model, store, max_output_tokens, reasoning and previous_response_id. First demonstrate failure against the unchanged adapter, then constrain the predicate. Keep an optional-temperature control returning a synthetic tool call, comparing the entire second request body with the first minus temperature. Preserve existing ChatGPT omission and bounded-attempt controls. Run affected tests, both web TypeScript programs and impact-selected guards, then use canonical integration and independent exact-source review.

Compatibility risk: providers that reject required fields now report an honest error instead of silently returning degraded work. Optional-temperature recovery remains. Rollback is a protected revert of this correction; do not edit live credentials, floors, limits or stored executions to compensate.
