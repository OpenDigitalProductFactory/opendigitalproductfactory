---
status: active
title: Initiative-readiness provider transport isolation
---

# Initiative-readiness provider transport isolation

**Backlog item:** `BI-362FD051`  
**Epic:** `EP-ABB3AC9D` — Change-delivery latency: tier by risk, fail open on infrastructure  
**Parent contract:** `docs/superpowers/specs/2026-08-25-initiative-readiness-reviewer-packet-design.md`

## Decision summary

Initiative-readiness repository reads must use a Node-owned, explicitly closed
GitHub transport by default. They must not depend on the framework-patched
global `fetch` installed by the Next.js server. Tests retain their existing
`fetchImpl` injection seam. Provider errors still fail closed and no readiness
requirement, receipt, authority check, or immutable-artifact check changes.

## Observed failure

Live readiness decision `IRD-213A96135F6D` for `BI-7C1F43E3` returned
`no-canonical-artifact` because the provider call threw in the MCP/Next process.
The exact same shipped `discoverCanonicalDesignArtifact` function, using the
same live database and credentials in a standalone process inside
`dpf-portal-1`, resolved the design at blob
`f669291397c9ffcd2a61a27150a092ee15214f22`. A direct request for the exact
base/head comparison also returned HTTP 200. This isolates the divergence to
the server execution context rather than repository identity, credentials,
branch publication, or GitHub availability.

## Objectives and acceptance

| Objective | Target |
|---|---|
| `OBJ-IRPT-CONTEXT` | Repository reads behave the same in the Next/MCP process and a standalone Node process. |
| `OBJ-IRPT-FAIL-CLOSED` | Real network, authentication, comparison, and artifact failures remain typed refusals and never become readiness PASS. |
| `OBJ-IRPT-ONE-BOUNDARY` | Initiative-readiness provider reads share one transport factory rather than selecting the global client independently. |

| Acceptance | Objective | Observable evidence |
|---|---|---|
| `AC-IRPT-001` | `OBJ-IRPT-CONTEXT`, `OBJ-IRPT-ONE-BOUNDARY` | Default canonical-discovery and artifact-verification calls use an isolated Undici transport and close it after the operation. |
| `AC-IRPT-002` | `OBJ-IRPT-FAIL-CLOSED` | Existing zero/many/provider-failure and immutable-artifact rejection tests remain green. |
| `AC-IRPT-003` | `OBJ-IRPT-CONTEXT` | Injected test transports remain supported without opening or closing a production transport. |
| `AC-IRPT-004` | `OBJ-IRPT-CONTEXT`, `OBJ-IRPT-FAIL-CLOSED` | After protected delivery, the live claim for the published Phase 1 design returns executable reviewer routes; no gate is waived. |

## Research and option comparison

- [Next.js documents that it extends server `fetch` with framework Data Cache
  semantics](https://nextjs.org/docs/app/api-reference/functions/fetch).
  That behavior is valuable for rendering, but readiness recovery is a
  control-plane provider read and must not inherit route/cache context.
- [Node documents that its global `fetch` is powered by Undici and that callers
  may supply an Undici dispatcher](https://nodejs.org/api/globals.html#fetch).
  DPF already uses an isolated `undici.Agent` plus explicit `close()` for the
  registry release reader.
- **Chosen:** a small `createGithubReadTransport()` factory in the existing
  GitHub reader module, reused by initiative-readiness discovery and repository
  verification. It preserves the native Fetch shape and test injection while
  making ownership and cleanup explicit.
- **Rejected:** merely remove `cache: "no-store"`. The evidence establishes a
  context-dependent global client, not a cache-policy error; retaining the
  global leaves other framework state in the control-plane path.
- **Rejected:** call `node:https` directly in each readiness module. That would
  duplicate redirect, response, test, and lifecycle behavior and create a
  second provider client contract.

## Architecture and boundaries

`apps/web/lib/contributor-change-lanes/github-rest-reader.ts` already owns
canonical repository identity and GitHub read credentials. It will also expose
the narrow transport factory:

```ts
type GithubReadTransport = { fetch: typeof fetch; close(): Promise<void> };
createGithubReadTransport(): GithubReadTransport;
```

The factory owns one Undici `Agent`, adapts Undici's response to the existing
Fetch-compatible type, and closes the dispatcher. Readiness functions choose
an injected `fetchImpl` when supplied; otherwise they create the production
transport, perform the complete provider operation, and close it in `finally`.
No token, request body, or response payload is persisted by this change.

Canonical artifact discovery continues to read one GitHub comparison bounded
to the provider's first 300 files. Repository-artifact verification preserves
its existing bounded metadata/content reads and canonical digest checks. The
database schema, Workroom identity, receipt schema, authorization model, and
public MCP contract do not change.

## Failure, security, and compatibility

- Network and dispatcher failures keep returning the existing
  `provider-unavailable`/artifact-resolution refusal; they do not synthesize a
  review route or receipt.
- Authentication still comes only from `resolveGithubToken`; transport
  isolation neither widens scopes nor logs the token.
- An injected fetch remains authoritative in tests and callers, so existing
  deterministic fixtures and compatibility are preserved.
- The production dispatcher is closed on success, non-OK response, parse
  failure, and thrown exception. Repeated blocked claims therefore do not leak
  sockets.
- Rollback is the single code commit; no migration or data repair is required.

## Scale and blast radius

The change adds no request and no collection. Each existing readiness operation
continues to make its current bounded GitHub reads. The transport has per-call
connection setup cost on an already exceptional governance path; correctness
and deterministic cleanup take precedence. If this becomes a measured
throughput bottleneck, `EP-ABB3AC9D` owns a separately governed pooled-client
optimization.

Blast radius is limited to the shared GitHub transport factory,
`canonical-artifact-discovery.ts`, `repository-artifact.ts`, and their focused
tests. Contributor inventory behavior is unchanged in this slice.

## Verification contract

1. Capture RED tests showing the default factory is selected and closed while
   injected fetches bypass it.
2. Make the focused canonical-discovery and repository-artifact suites green.
3. Run related initiative-readiness suites, lint/typecheck, production build,
   and the repository's semantic and local-CI gates without weakening them.
4. Deliver through a DCO-signed protected PR and verify the exact merged commit
   on the live install.
5. Repeat the real Phase 1 claim and retain the readiness decision proving
   executable routes rather than `no-canonical-artifact`.

## Implementation sequence

1. Capture RED lifecycle fixtures proving a framework-global failure is bypassed
   by the default isolated transport, the injected-fetch path is unchanged, and
   every production dispatcher is closed.
2. Add `createGithubReadTransport()` beside the existing repository identity
   and credential helpers, using `undici.Agent` and `undici.fetch`.
3. Move canonical discovery and both repository-artifact read paths onto one
   operation-scoped transport while preserving their existing error mapping.
4. Run focused and graph-linked tests, typecheck, build, semantic review, and
   protected CI; record any unavailable local capacity lane as inconclusive.
5. Deliver through a DCO-signed protected PR, advance the canonical runtime,
   and replay the real `BI-7C1F43E3` claim. The replay proves reachability only;
   it does not satisfy a review gate.

## Non-goals

- Changing readiness policy or treating infrastructure failure as PASS.
- Adding retries, a cache, database state, or a new provider abstraction.
- Migrating all application GitHub reads in this patch.
- Implementing any Phase 1 adversarial fixture on this repair branch.
