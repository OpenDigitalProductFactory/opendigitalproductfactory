# SSE Liveness Heartbeats — fixing the "Chrome wedged after a portal rebuild" defect

| Field | Value |
| --- | --- |
| Date | 2026-06-19 |
| Status | Implemented (this PR); functional proof across a real multi-tab rebuild outstanding |
| Backlog | `BI-864E83B0` (this fix); `BI-1AFF530D` (follow-up: migrate transient consumers) |
| Epic | `EP-UPGRADE-LIFECYCLE` (rebuild-triggered; organizationally grouped) |
| Related | `docs/superpowers/specs/2026-05-24-activity-quiescence-protocol-design.md` (server-side drain — adjacent, did NOT address client connection accounting) |

> **Current application-layer contract:** this spec owns SSE transport liveness. Connection sharing,
> targeted status rehydration, fallback reconciliation, and the prohibition on transport-owned
> navigation are governed by
> [`docs/architecture/background-operation-observation-contract.md`](../../architecture/background-operation-observation-contract.md).

## 1. Symptom

Recurring, operator-reported (Mark, "yet again"): the `localhost:3000` portal URL stops loading in
Chrome. **Restarting the browser is the only fix — restarting the server does not help.** It
correlates with portal re-builds / self-upgrade. It has been investigated multiple times and never
fixed; a knowledge-base + spec search on 2026-06-19 returned **no** prior artifact capturing the
client-side cause, which is why it kept recurring.

## 2. Root cause

The "only a browser restart fixes it" signature is decisive: the bad state lives in the **browser's
connection pool**, not on the server.

1. **The portal is HTTP/1.1.** It is served by the Next.js standalone server (`node server.js`) on
   `localhost:3000` with no HTTP/2 reverse proxy (see `docker-compose.yml` `portal` — a direct
   `3000:3000` port map). Browsers cap HTTP/1.1 at **~6 connections per origin**.
2. **Every SSE route was silent.** All long-lived Server-Sent-Events routes
   (`/api/agent/system-stream`, `/api/agent/stream`,
   `/api/platform/integrations/sync-progress/[syncId]`, `/api/internal/tasks/[taskId]/subscribe`)
   opened a stream, emitted one `: connected` comment, then sent **zero bytes** until a domain event
   happened — often minutes or hours.
3. **`PlatformBanner` holds one such silent stream on every page, in every tab** (it is mounted in
   the authenticated shell layout, `app/(shell)/layout.tsx`).
4. **A self-upgrade recreates the portal container.** The promoter runs `docker compose up` which
   tears down the host port proxy (`docker-proxy` for `3000:3000`) and kills the old Node process. A
   *silent* SSE socket has no in-flight traffic to fail on, so the browser's `EventSource` never
   sees an error, **never fires `onerror`, and never auto-reconnects.** It becomes a **zombie**:
   believed-alive, holding one of the 6 connection slots plus a half-open OS/Docker-proxy socket.
5. **Slot exhaustion → wedge.** Enough zombies across tabs and successive rebuilds consume the
   6-slot cap. A fresh navigation to `localhost:3000` then cannot acquire a socket and the page
   hangs indefinitely. A **browser restart** force-closes every socket, which is why — and only why
   — it clears.

This is exactly the "threads + portal re-builds with self-update" mechanism the operator intuited.

The Activity Quiescence Protocol (2026-05-24) hardened the **server side** of an upgrade (drain,
banner, reconnect contract) and even shipped `useResilientEventSource`, but (a) the hook was never
adopted by any consumer and (b) nothing addressed the **silent-stream → zombie** accounting. So the
defect survived.

## 3. Fix

Two halves. The server must produce an **observable liveness signal**; the client must **act on its
absence**.

### 3.1 Server — `apps/web/lib/sse/sse-stream.ts` (`createSseResponse`)

A single shared SSE builder (the five routes were near-identical copies — DRY + single source of
truth). It:

- emits the initial `: connected` comment (preserves prior behavior);
- emits a **named** `dpf-hb` event every `DPF_SSE_HEARTBEAT_MS` (default **15s**). Named, not a bare
  `:` comment, because a bare comment is invisible to JS — the client needs to *observe* the beat to
  run a watchdog;
- **reaps dead clients**: any `enqueue` failure (socket gone) or `request.signal` abort runs the
  caller's cleanup (event-bus unsubscribe) and closes the stream — no leaked subscriptions;
- supports an optional `maxAgeMs` hard lifetime (belt-and-suspenders; off by default — the watchdog
  is the primary reaper);
- sets anti-buffering headers (`Cache-Control: no-transform`, `X-Accel-Buffering: no`) so heartbeats
  actually flush through any intermediary.

All four long-lived routes were converted to it. The `/api/v1/agent/stream` stub (closes
immediately) was left alone.

### 3.2 Client — `useResilientEventSource` heartbeat watchdog

The hook (already carrying a 5s reconnect floor + jitter + Retry-After + stale-bundle check) gains a
**watchdog**: every inbound frame — `dpf-hb`, named event, or `data` — resets a timer; if nothing
arrives within `HEARTBEAT_WATCHDOG_MS` (**40s** ≈ 2 missed beats + slack) the connection is presumed
dead, force-closed, and reconnected on a fresh socket via the existing backoff. **This is what reaps
the zombie and frees the slot**, so the page self-heals within ~40s of a rebuild instead of needing
a browser restart. The `dpf-hb` frame is consumed internally and never forwarded to consumers.

### 3.3 Consumer migration (historical implementation)

The **always-on** consumers — `PlatformBanner` and `usePlatformReady` — were migrated to the
resilient hook. They now subscribe through one shell-owned `SystemEventProvider` connection to
`/api/agent/system-stream`, rather than opening one connection per consumer. These are the streams that persist
indefinitely and accumulate zombies, so they are the priority.

The **transient** consumers (`AgentCoworkerPanel`, `BuildStudio`, `BrandExtractionSection`,
`McpSyncButton`) still use raw `EventSource`; they benefit from server-side dead-client reaping but
not yet the client watchdog. They are open only during active work and don't accumulate, so they are
deferred to `BI-1AFF530D`.

## 4. Research & Benchmarking

| Source | Pattern | DPF decision |
| --- | --- | --- |
| [WHATWG HTML — Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html) | Servers send periodic `:` comment lines as keep-alive; clients auto-reconnect with `retry:`. | Adopted keep-alive, but as a **named** event (not a comment) so the client can run a watchdog — the spec's client reconnect only triggers on a *detected* drop, which a silent dead socket never produces. |
| [MDN EventSource](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) | Native auto-reconnect on error. | Insufficient alone: no error fires on a silently-stranded socket after a container swap. The watchdog covers that gap. |
| Chrome / Firefox connection limits ([RFC 7230 §6.4](https://www.rfc-editor.org/rfc/rfc7230#section-6.4) recommends limits; browsers use 6/origin for HTTP/1.1) | 6 concurrent connections per origin. | The hard constraint that turns leaked SSE streams into a page-wide wedge. Long-term mitigation (HTTP/2 multiplexing) tracked separately. |
| nginx / proxy SSE guidance (`X-Accel-Buffering: no`, disable proxy buffering) | Prevent intermediaries from buffering the event stream. | Adopted on the shared builder. |
| Kubernetes liveness probes; TCP keepalive | Liveness must be *actively probed*; you cannot infer health from silence. | The core principle here: a heartbeat the peer can miss, plus a watchdog that acts on the miss. |

**Rejected for now:** HTTP/2 on the portal (removes the per-origin cap entirely) — requires TLS on
localhost and a custom server; larger infra change, separate item. `SharedWorker` to share one
connection across all tabs — real complexity; the heartbeat watchdog already reaps per-tab zombies.

## 5. Verification

- **Unit:** `apps/web/lib/hooks/useResilientEventSource.test.ts` (watchdog reconnects on silence,
  does NOT reconnect while heartbeats/data flow, tears down on unmount) and
  `apps/web/lib/sse/sse-stream.test.ts` (headers, initial comment, heartbeat cadence, single-run
  cleanup on abort, no post-close leakage) — 9 tests, green.
- **Regression:** 374 blast-radius tests (`lib/hooks lib/sse lib/proxy components/platform
  components/agent`) green; touched files typecheck clean (remaining `tsc` errors are pre-existing
  stale-`@dpf/db` junction artifacts, not from this change). Substrate: worktree source-local gates.
- **Outstanding (runtime-bound):** functional proof across a real self-upgrade rebuild with multiple
  tabs open — run against the canonical install or a leased nonprod sandbox after the change deploys
  via the governed self-upgrade path. Structurally: confirm `curl -N /api/agent/system-stream` emits
  `event: dpf-hb` frames on the interval.

## 6. Rollback / risk

Low blast radius: transport-layer only, no schema or data changes, no user-visible UI change. The
shared builder preserves the prior `: connected` + event-shape contract; consumers' `onmessage`
bodies are unchanged. Tunables (`DPF_SSE_HEARTBEAT_MS`, the 40s client watchdog) bound behavior.
Revert = restore the per-route `ReadableStream` blocks and the raw `EventSource` in the two migrated
consumers.

## 7. Post-merge regression — full-page reload loop (BI-864E83B0-followup)

**Symptom (operator-reported):** after the always-on consumers were migrated to
`useResilientEventSource`, the whole page reloaded every ~1-2 seconds.

**Cause:** the hook carried a dormant `detectStaleBundle()` that ran `window.location.reload()` on
**every (re)connect** when the boot identity didn't match the server's. That code had never executed
before because no component used the hook; migrating the always-mounted `PlatformBanner` armed it.
It then looped because the two identities are derived from **divergent env sources**:

- `__DPF_BOOT__.bundleHash` (`app/layout.tsx`) read `PORTAL_BUNDLE_HASH ?? PORTAL_GIT_SHA ?? "unknown"`
  — none of which the container sets → `"unknown"`.
- `/api/internal/quiescence-state.bundleHash` reads `getDeployedSha()` → `DEPLOYED_SHA`, which the
  Dockerfile **always** seeds on a built image → the real SHA.

`"<sha>" !== "unknown"` is permanently true, so the hook reloaded, the page re-booted to the same
`"unknown"`, and it reloaded again — a tight loop.

**Fix (two parts):**

1. **The transport hook never reloads the page.** Removed `detectStaleBundle()`, the
   `stale-bundle-reload` status, and the `window.location.reload()` from `useResilientEventSource`.
   Reconnecting a stream is a transport concern; reloading after a deploy is an application concern.
   This makes the loop impossible on any install regardless of env config.
2. **The identities now agree.** `__DPF_BOOT__.bundleHash` derives from `DEPLOYED_SHA` first — the
   same source `getDeployedSha()` uses — so the comparison is meaningful (equal when not upgraded).

The legitimate post-upgrade soft-reload is unchanged and still owned by `PlatformBanner`'s
`detectBundleMismatchAndReload`, which fires **only** on the explicit `system:quiescence`
"succeeded" event (once per upgrade), not on every connect.

**Lesson:** adopting a shared hook means owning *all* of its side effects. A page-reload buried in a
"resilient EventSource" wrapper, fed by two independently-maintained identity sources, was a latent
trap; the heartbeat/watchdog design was sound but the wholesale hook adoption was not vetted for
on-connect behavior.
