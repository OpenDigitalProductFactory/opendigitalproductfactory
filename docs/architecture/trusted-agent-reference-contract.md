---
status: draft
---

# Portable trusted-agent reference contract

`@dpf/validators` provides draft **0.1.0** data contracts and a pure reference
execution loop for harness implementers. It runs without a DPF connection, model,
credential, filesystem or network. This is the portable reference deliverable for
BI-F9582C48 under EP-B932453F, implemented against the
[approved design](../superpowers/specs/2026-09-27-portable-tak-contracts-design.md)
and [implementation plan](../superpowers/plans/2026-10-01-portable-tak-contracts.md).
Those documents trace PC-01..08 to the TAK, JSI, GAID and GPP normative drafts.

## Run the examples

From the repository root, with its pinned dependencies already provisioned:

```sh
pnpm exec tsx -e 'import { runTrustedAgentExamples } from "./packages/validators/src/index.ts"; console.log(JSON.stringify(runTrustedAgentExamples(), null, 2))'
pnpm --filter @dpf/validators exec vitest run src/trusted-agent-contracts.test.ts src/trusted-agent-reference-loop.test.ts
```

`runTrustedAgentExamples()` returns success, refusal, scope mismatch, uncertain
effect/reconciliation, and extension negotiation cases. Every observation is
**simulated**. `conformanceClaim` is `none`. These fixtures neither qualify an agent
nor establish GPP-Modeled, GPP-Enforced or GPP-Evidenced. The package is currently a
private workspace package; a distributable bundle is separately tracked by
BI-07A2B207. Hermes (BI-FEA232AF), Cursor (BI-0E56BA38), the canonical DPF demo
(BI-F3C2EC7A) and family conformance (BI-2AB781FA) have separate acceptance evidence.

## Import and version negotiation

Import `importTrustedArtifact`, `trustedArtifactJsonSchema`, `createTrustedLoop`
and `advanceTrustedLoop` from `@dpf/validators`. Five discriminated artifacts are
supported: work definition, operating profile, qualification reference, decision
and effect receipt. `trustedArtifactJsonSchema()` returns structural JSON Schema
Draft 2020-12, identified by `urn:dpf:trusted-agent:0.1.0`.

There are three different checks:

| Check | What it establishes |
|---|---|
| Structural schema | Required fields, literal version, closed vocabularies, sizes and types |
| Full importer | Structural validity plus bounded JSON, exact extension support, uniqueness, references, selection eligibility and cross-field semantics |
| Authenticated host adapter | Origin, current policy, actual permission, trustworthy evidence, retention/export eligibility and effects |

JSON Schema does not establish the latter two. Pass an explicit observation time
as `now` to the importer when checking restriction expiry or qualification windows.
Qualification status belongs to its originating scheme and remains opaque; the
importer never turns it into a grant. WWMD, WWWD and WSID remain separate owning
scopes. An eligible selected option cannot override a hard constraint.

Every core object is strict. Unknown core fields and versions fail. Bounds include
64 stages/options/capabilities, 128 evidence references, 32 extensions, identifiers
of 512 characters and descriptions of 4,096. The importer also bounds JSON to depth
16, 20,000 visited nodes and 1,048,576 key/value characters. Excess is rejected,
never truncated. Errors are structured and bounded to 32 entries.

An extension has a namespaced ID, exact version, `mandatory` flag and JSON `data`.
Register semantic validators with `{ extensions: [{ id, version, validate }] }`.
A known name with an unsupported version cannot satisfy a mandatory extension.
Unknown optional extensions round-trip unchanged within the JSON limits; retaining
them does not authorize their execution. A changed required meaning needs a new,
explicitly supported contract version and compatibility fixtures. Optional extension
payloads are not a secret scanner: exporters must apply their disclosure policy.

## Host integration and effect recovery

Create a loop for one declared consequential stage and one exact effect. Supply the
validated work/profile projection, stage, selected-action candidate, effect binding,
initial attempt ID and current time. The owning workflow coordinator remains
responsible for stage order, allowed transitions and assembling the next stage.
The reference accepts only the sequential projection; unsupported parallel/token
semantics must not be flattened into it.

The loop produces these requests in sequence:

1. Obtain an owning-scope decision for the candidate and declared evidence.
2. Obtain current authorization for the exact actor, operation revision, target,
   account, argument digest/canonicalization, purpose, work/profile revisions,
   policy generation and applicable GPP bindings.
3. Reserve the effect/attempt durably before submission.
4. Dispatch through mediation that **rechecks at actual use**, including grant
   intersection, revocation, data/destination policy, GPP revision and exact binding.
5. Record a target observation; reconcile an uncertain effect before any retry.

Commands are requests, never tools or reusable permission tokens. The adapter must
authenticate every event and stored state, serialize transitions with a durable
revision/CAS, persist the state and outgoing command together, and consume each
reservation/dispatch once. A prior `authorization` event does not close a network
race. If the host cannot meet its claimed atomicity, it must refuse the claim or
use its explicitly documented containment mode. Supply trusted time; do not let a
model choose the clock or rewrite counters. Validate policy freshness again at use.

State contains bounded references, counters and binding metadata. Protect it under
its retained work and profile restrictions. `createTrustedLoop` cannot discover an
already-running effect in another process: the adapter must enforce uniqueness of
the effect identity and give an uncertain prior attempt precedence over a new one.
Replaying an old state outside that durable transaction is not a safe retry.

A timeout, exception, cancellation or restart after possible dispatch means
`unknown`. Resume an `awaiting-dispatch` state with `recover`; the command is
observation-only reconciliation, never another dispatch. Observations of an old
effect remain possible after revocation. A `no-effect` receipt needs target evidence;
`not-submitted` is a trusted adapter assertion that submission never occurred.
Neither may be inferred merely from a missing response. Cancellation is retained
separately from revocation: the old effect can still be observed, but the cancelled
work cannot retry. A new attempt requires
one of those outcomes, a fresh attempt ID, remaining budget and current
authorization, while retaining the original effect identity.

Step, attempt and reconciliation exhaustion holds for the named resolver with an
`inconclusive` disposition. It does not deny the business objective. Refusal and
waiting retain their canonical dispositions. Invalid inputs, wrong-order events,
duplicate completions or changed bindings return `ok: false` with no commands;
the adapter must hold the persisted attempt and resolve the error, never interpret
it as permission to recreate a loop. A stopped uncertain attempt remains unresolved
until the host's accountable recovery process obtains evidence.

GPP binding revision and shape revision are independent. A changed binding requires
renewed resolution; no version-string comparison can establish whether it narrowed
or widened authority. Shadow/off bindings do not admit reference advancement.
This module does not mint or verify deployment permits. The
[GPP architecture](gated-permissions-process.md) owns that runtime contract.

## Privacy and DPF compatibility

Artifacts carry references and digests instead of raw arguments, model context,
evidence bodies or credentials. Even references can be sensitive. The source
adapter must enforce classification, access, purpose, destination, retention and
expiry on export and resolve references through authenticated access. An optional
extension is still subject to these restrictions. A digest is not a signature.

The scope and outcome vocabularies now have one pure owner in validators; the web
modules retain compatibility exports and unchanged admission behavior. This change
adds no database model, policy engine, grant store, runtime status or second ledger.
DPF adapters continue to use the canonical identities, Workroom, DecisionInteraction
and ToolExecutionReceipt. Live integration and UX verification belong to the demo
item; standalone unit tests cannot substitute for them.
