---
status: active
title: Portal hostname resolution off the libuv worker pool
---

# Portal hostname resolution off the libuv worker pool

**Backlog item:** `BI-41EB722B`
**Epic:** `EP-ZERO-CONFIG-FEDERATION` — Zero-configuration same-organization federation
**Related completed repair:** `BI-E35E1183` — bounded immutable-provider retries
**Protected step-ca slices:** PR `#5061` — c-ares resolution; PR `#5063` —
fresh request agent and timeout-phase diagnostics

## Decision summary

Long-lived portal control-plane HTTP clients must resolve their known service
and provider hostnames through Node's c-ares DNS APIs rather than
`dns.lookup`/`getaddrinfo` on the process-global libuv worker pool. A small
server-only transport owns the lookup adapter and an Undici dispatcher.
GitHub immutable reads use an operation-scoped instance and close it in their
existing lifecycle. The singleton Inngest client uses a process-lived instance
because it sends events and registers functions for the lifetime of the portal.
Provider inference uses a separate process-lived instance injected at the
adapter boundary. Synchronous chat, Responses, embedding, image, transcription,
and asynchronous start/poll traffic all use that one transport so a fallback or
poll never returns to the poisoned process-global hostname path.

This is transport hardening only. It does not weaken immutable blob checks,
change authority, synthesize a receipt, retry a business operation, or turn a
network failure into success.

## Evidence and diagnosis

The development install reproduced one process-specific failure on a named
protected source state. The long-lived Next.js process timed out on
`inngest:8288` and exact GitHub content reads while a fresh Node process in the
same container resolved and fetched both endpoints successfully. After an
independent portal replacement, registration initially succeeded and hostname
timeouts recurred within minutes. At that point two of the four libuv workers
were parked in `do_sys_poll`; the other two were idle. IP-literal work-sync
traffic remained healthy.

This rules out the following candidate causes:

- **Remote or container outage:** fresh-process HTTP calls returned 200 and the
  Inngest container stayed healthy.
- **Bad GitHub credential, path, commit, or blob:** the exact provider adapter
  and database credential returned the expected immutable bytes from a fresh
  process.
- **Only a framework-patched fetch defect:** a fresh Undici `Agent` inside the
  already affected Next process still shares the same process-global hostname
  lookup pool.
- **A durable admin restart still executing:** its TaskRun was stale in
  `working`, had no tool execution or envelope, and ordinary reconciliation
  selects only `submitted` rows. It can falsely project liveness but cannot
  dispatch again without a governed state transition.

The evidence supports process-global `getaddrinfo` queue starvation as the
systemic cause. The names that originally occupied the two workers remain
unknown, so the repair removes known control-plane clients from that shared
queue instead of depending on attribution of the first bad lookup.

After the GitHub, Inngest, and step-ca slices were served at protected commit
`4e48b40a727b9a1bf02b355c69a2c661ab4af275`, those three surfaces succeeded in
the same long-lived portal process while every governed external reviewer still
failed before inference. Portal logs recorded four consecutive
`callWithFallbackChain` Gemini `fetch failed` outcomes followed by
`All endpoints failed for external-mcp`. A fresh Node process inside the same
portal container reached the Gemini HTTPS endpoint in 225 ms and received an
ordinary HTTP response. The remaining HTTP-backed inference adapters and async
poller still called process-global `fetch`, which isolates the residual defect
to the provider-inference transport boundary rather than model behavior,
credentials, routing, or the terminal-writer contract.

## Objectives

**OBJ-DNS-1:** Inngest and GitHub control-plane calls from a long-lived portal
process resolve without entering the process-global libuv `getaddrinfo` queue.

**OBJ-DNS-2:** Resolution stays bounded and fails closed when no exact A or AAAA
answer is available; no stale, forged, or unrelated address is substituted.

**OBJ-DNS-3:** One small resolver/transport boundary is reused instead of
copying bespoke DNS behavior into each caller.

**OBJ-DNS-4:** The step-ca slice and this shared-client slice compose on
protected ancestry without duplicating source ownership.

**OBJ-DNS-5:** Every external HTTP provider inference path, including async
start and poll, resolves off the libuv worker pool without changing provider
authorization, routing, timeout, streaming, tool-call, or fail-closed behavior.

## Acceptance criteria

| Acceptance | Objective links | Observable evidence |
|---|---|---|
| `AC-DNS-1` | `OBJ-DNS-1`, `OBJ-DNS-3` | A deterministic transport test fetches a `.invalid` hostname through an injected c-ares resolver while the OS resolver could not resolve it. |
| `AC-DNS-2` | `OBJ-DNS-1`, `OBJ-DNS-2` | Lookup tests prove IP literals bypass DNS, requested families are honored, A then AAAA is bounded, and failed/empty answers return an error exactly once. |
| `AC-DNS-3` | `OBJ-DNS-1`, `OBJ-DNS-3` | `createGithubReadTransport` uses the shared lookup-bearing transport and preserves explicit close semantics. |
| `AC-DNS-4` | `OBJ-DNS-1`, `OBJ-DNS-3` | The singleton Inngest client receives the shared transport's fetch implementation, covering event sends and SDK function registration. |
| `AC-DNS-5` | `OBJ-DNS-2` | Existing GitHub immutable-provider refusals, Inngest send behavior, and typed error paths remain green; no retry or readiness policy changes. |
| `AC-DNS-6` | `OBJ-DNS-4` | Protected ancestry includes PR `#5061`, or the delivery record names it as a required protected predecessor for step-ca acceptance. |
| `AC-DNS-7` | `OBJ-DNS-1`, `OBJ-DNS-3`, `OBJ-DNS-5` | The central inference caller injects one process-lived off-threadpool fetch into every HTTP adapter; a Gemini chat fixture proves the injected transport is used while preserving a schema-valid tool call. |
| `AC-DNS-8` | `OBJ-DNS-1`, `OBJ-DNS-5` | Async interaction start and poll both use the provider transport while preserving provider API revision, opaque operation identity, timeout, and terminal-state handling. |
| `AC-DNS-9` | `OBJ-DNS-2`, `OBJ-DNS-5` | Adjacent provider adapter, fallback-chain, streaming, and terminal-writer suites remain green; transport failure remains an explicit provider failure and never fabricates a model or writer result. |

## Architecture

`apps/web/lib/network/off-threadpool-fetch.ts` owns two narrow adapters:

1. a Node-compatible `lookup(hostname, options, callback)` backed only by
   `dns.promises.resolve4` and `resolve6`; and
2. a Fetch-compatible Undici transport whose `Agent` is configured with that
   lookup and whose owner can close the dispatcher.

The lookup recognizes IP literals without DNS. For hostnames it honors an
explicit IPv4 or IPv6 family and otherwise tries IPv4 before IPv6. Each lookup
has one overall deadline. Empty answers, unsupported family requests, resolver
errors, and expiry are errors. There is deliberately no automatic
`dns.lookup` fallback: falling back would re-enter the exact poisoned queue this
repair exists to avoid.

The GitHub reader continues to expose `GithubReadTransport`; its factory now
delegates to the shared transport. Existing initiative-readiness callers retain
their operation-scoped `finally { close() }` behavior and test injection seams.

`apps/web/lib/queue/inngest-client.ts` creates one process-lived shared
transport and passes its fetch function through Inngest's supported `fetch`
option. The Inngest SDK then uses that fetch for event API and registration
traffic. The transport is not closed while the singleton remains reachable.

`apps/web/lib/inference/provider-inference-transport.ts` owns a separate
process-lived shared transport for provider calls. `callProvider` supplies its
Fetch-compatible function through a required, server-owned `AdapterRequest`
field. HTTP-backed adapters consume only that field; CLI adapters accept the
common request shape but do not use the transport. The async poller consumes
the same singleton as async start, so an operation cannot start off-threadpool
and later poll through process-global hostname resolution. No adapter creates
an Undici `Agent` per request, and the process-lived dispatcher is not closed
while the portal can issue or resume inference.

PRs `#5061` and `#5063` own the already-written step-ca lookup, request-agent,
and timeout-diagnostic behavior. This change composes on both protected merge
commits and moves only their lookup implementation onto the shared resolver.
All three observed hostname-dependent surfaces then avoid the starved default
lookup path without losing the step-ca diagnostics or connection lifecycle.

## Security and failure behavior

- DNS answers only influence connection addresses; HTTPS continues to verify
  the original URL hostname through SNI and certificate validation.
- Callers still construct and authorize their own URLs. The transport does not
  add redirects, widen host allowlists, or accept caller-provided IPs.
- Resolution failure rejects the request. It never falls back to cached
  business data, an unverified address, or a PASS/readiness receipt.
- The resolver deadline prevents one c-ares query from becoming an unbounded
  control-plane wait. Closing an operation-scoped GitHub transport remains
  mandatory on success and failure.
- Provider tokens and response bodies are unchanged and are never included in
  DNS diagnostics.
- Transport injection cannot alter provider selection, endpoint URLs, request
  headers, credential material, retry/fallback budgets, abort signals,
  streaming bodies, tool schemas, or response parsing. It changes only how the
  already-authorized hostname is resolved and dispatched.

## Options rejected

- **Restart the portal:** temporarily clears the process state but the live
  evidence shows the failure recurs. A restart is recovery, not a repair.
- **Increase `UV_THREADPOOL_SIZE`:** increases how many lookups can be poisoned
  and changes unrelated crypto/filesystem scheduling; it does not bound or
  isolate hostname resolution.
- **Install one process-global Undici dispatcher:** changes every server fetch,
  including framework and security-sensitive callers, and obscures lifecycle
  ownership.
- **Retry `dns.lookup`:** queued retries share the same blocked pool and amplify
  load.
- **Persist DNS answers:** introduces freshness and rebinding risk without being
  necessary; c-ares is already nonblocking and Docker/service DNS is local.

## Ordered fix sequence

1. Add RED fixtures for a lookup that must succeed without OS `getaddrinfo`, a
   bounded resolver failure, and Inngest/GitHub transport selection.
2. Implement the shared c-ares lookup and explicitly owned Undici transport;
   make the focused fixtures green.
3. Move the GitHub transport factory and singleton Inngest client onto the
   shared boundary without changing their public contracts.
4. Run focused and graph-linked suites, web typecheck, repository guards, and
   blast-radius checks. Record an unavailable local immutable/semantic slot as
   INCONCLUSIVE only; never infer PASS.
5. Merge current protected main normally after PRs `#5061` and `#5063` land,
   publish one DCO-signed PR, and require every protected PR and merge-group
   check.
6. After a separately governed release/deployment, verify long-lived Inngest,
   GitHub immutable reads, and step-ca calls without a portal restart.
7. Add RED fixtures proving chat/tool-call dispatch, async interaction start,
   and async poll use an injected provider transport even when process-global
   `fetch` fails.
8. Add the process-lived provider inference transport, require it at the
   adapter boundary, and migrate every external HTTP inference dispatch and
   poll without changing their protocol behavior.
9. Run focused and adjacent provider, fallback, streaming, and terminal-writer
   suites plus typecheck and guards; then deliver through protected CI and
   verify one governed reviewer reaches its real terminal writer on the served
   commit.

## Non-goals

- Changing readiness, approval, receipt, or retry policy.
- Recovering or mutating the stale admin-restart TaskRun.
- Editing the installed runtime or deploying from this worktree.
- Replacing application-wide DNS behavior or adding a DNS cache.
- Changing model selection, provider fallback order, async protocol identity,
  terminal-writer enforcement, or provider OAuth/discovery behavior.
