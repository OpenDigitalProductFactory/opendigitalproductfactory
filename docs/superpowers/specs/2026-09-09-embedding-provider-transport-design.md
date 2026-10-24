---
status: draft
---

# Embedding provider transport

BI-9298C4D5; WC-1077E882; small bug fix.

## Reproduction and scope

While delivering BI-E78DC21D on reviewer-recovery.3, research requests reached
their immutable design and then failed to save a receipt. WWMD decisions
DI-3BCF95FF6377 and DI-449FCE95C4FA reported unusable retrieval. Portal logs
recorded embedding fetch failures and the eight-second retrieval deadline.
Independent probes in that portal container returned an embedding with 768
dimensions and a model list in 64 milliseconds. These observations establish
an application-path failure, not that the model is absent or credentials expired.

Source inspection found a transport inconsistency: `embedding.ts` uses global
fetch for both generation and availability, while synchronous and asynchronous
reasoning use `provider-inference-transport.ts`. PR #5075 introduced that shared
transport to avoid the process-global libuv hostname lookup queue. Whether this
inconsistency caused the observed live failure remains a hypothesis until
served acceptance. A portal DNS probe confirmed the existing c-ares resolver
can resolve the configured Docker Model Runner hostname.

## Design and verification

Reuse `providerInferenceFetch` for both embedding calls. Its process-lived
dispatcher already owns inference transport; do not create another dispatcher
or change the global fetch implementation. Retain the model, dimensions,
endpoint selection, request deadlines, bounded oversize retries, and detailed
failure/deferred results. No configuration, schema, dependency, permission,
reviewer routing, or WWMD decision rule changes.

First reproduce generation and availability failing when global fetch is
unusable but the canonical provider transport succeeds. Then change both calls
and run existing oversize, capacity-result, transport, and retrieval tests.
Typecheck and protected CI remain required. Source implementation follows the
operator's standing authorization to bypass the unavailable procedural research
receipt; it does not assert a research or authority pass.

After canonical publication and normal self-upgrade, retry a fresh exact-bound
research request. Require the real WWMD result and persisted receipt, not a
direct embedding probe alone. If retrieval still fails, retain that result and
diagnose the remaining path; do not weaken usability or autonomy checks.

The change is consolidation of existing transport ownership. Rollback reverts
the two call sites and import without altering stored embeddings or receipts.
