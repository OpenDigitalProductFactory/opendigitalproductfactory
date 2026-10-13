---
status: active
---

# Delegated DEV local containment — BI-5818F811

This atomic break fix follows BI-B22C8E02. The original fix intentionally retained general account activation authority. BI-734C1534 owns transactional disable persistence; BI-56F2AB99 owns timed pause. Neither implements this narrower consequence classification. Explicit operator authorization covers DEV traffic containment.

## Design grounding

Base: 007eef1a3bc035a5f7906cf92cd2432819695534. Reuse `apps/web/lib/mcp/packs/provider-account-tools.ts`, `apps/web/lib/tool-consequence.ts`, `apps/web/lib/install/instance-stance.ts`, `apps/web/lib/inference/provider-account-management.ts`, `packages/db/src/provider-connection.ts`, and `apps/web/lib/routing/provider-locality.ts`. No new tool, schema, grant, provider status writer or UI control. Preserve the existing handler and its management capability. Extract the account consequence callback into a tested helper rather than adding another approval mechanism.

## Requirements and contracts

REQ-CONTAINMENT: Only explicit disable of a server-confirmed credentialless default local or ollama connection on development/evolve-dpf may use routine delegation.

CONTRACT-BOUNDARIES: Management capability remains required. Production, unknown stance, nondefault/cloud/credentialed accounts, enable and credential/grant operations retain authority. Malformed or additional arguments retain authority. Classification failures retain authority.

FLOW-DISABLE: Read canonical stance and selected connection facts. Require canonical default identity, local provider, local authentication/runtime channel, no credential entry and no organization ownership. An optional providerId must match persisted identity. Existing transactional status handler remains canonical; no alternate runtime writer. Ordinary classification still needs current steering; absent delegation and restricted data retain escalation.

VERIFY-CONTAINMENT: Run regression tests against the unchanged definition first, then extracted classifier, affected account/stance/consequence tests and web typechecks. Independently assess exact source, publish through DCO/protected PR and canonical release. Verify native disable of the already inactive account without introducing a duplicate approval or enabling it. A blocked native review or unrun live proof is recorded as such.

## Execution

1. Claim exact paths and consume impact contract. Coordinate the existing provider definition claim before edits.
2. Reproduce the missing eligible containment classification. Implement fail-closed helper and preserve discovery behavior.
3. Run affected tests/typechecks and canonical gate, obtain independent review, publish protected PR.
4. Coordinate one canonical deployment owner and verify served source and native delegation behavior.

## Backlog coverage

Atomic BI-5818F811: classification, tests and boundary documentation form one repair; no phase alone delivers containment. Immutable coverage receipt is recorded after this plan is published. No receipt is claimed here.
