# CLI infrastructure re-dispatch — ending the permanent BLOCKED strand

**BI-2B9E16CC** · 2026-07-22

## The strand

A Build Studio task dispatched to a CLI engine (codex / claude / grok / opencode)
that dies mid-work leaves the build stuck in `build` phase with no path forward.
Three things compound:

1. **`classifyOutcome` collapses every CLI failure to `BLOCKED`.** In
   `build-orchestrator.ts` the CLI branch reads:

   ```ts
   if (!result.success) {
     if (content.includes("timed out")) return "BLOCKED";
     return "BLOCKED";
   }
   ```

   A transport timeout and "I need a product decision before I can write this"
   produce the identical terminal verdict.

2. **The only existing recovery gives up after one second.**
   `classifyRetrySafePreDispatchFailure` returns `null` once
   `durationMs > 1000`. That guard is *correct* for what it does — it exists so a
   run that may already have applied sandbox side effects is never silently
   re-run on a different engine. But it means nothing that fails *after* dispatch
   is recoverable, and mid-work deaths are by definition after dispatch.

3. **`hasBlocked` then refuses build → review advancement**, so the build reports
   "not ready for review" and waits for a human forever.

## The asymmetry that makes it a bug

The **agentic** path has always retried failures up to `MAX_SPECIALIST_RETRIES`,
re-prompting with `RETRY (attempt N): The previous attempt had issues: …`. The
**CLI** path retried nothing after dispatch. The same failure is routine on one
path and terminal on the other — purely because of which engine was selected.

## The fix

Give the CLI path the bounded retry the agentic path already takes, gated on
*why* it failed.

- **`integrate/blocked-cause.ts`** (new) — `classifyBlockedCause({content, exitCode})`
  → `"infrastructure" | "substantive"`. Infrastructure covers transport and
  process death: timeouts, `ECONNRESET`/`EPIPE`/socket hang up, 429/5xx,
  overloaded/rate-limit/quota, SIGKILL/SIGTERM/OOM, `fetch failed`, empty output,
  and exit codes 137/143/124. Everything else — including a specialist that wrote
  a considered explanation of what it needs — is substantive.

- **`build-orchestrator.ts`** — the runner invocation is extracted to a local
  `dispatchOnce(candidate)`. On a failure classified `infrastructure`, the same
  engine is re-dispatched **once** per task, with an
  `orchestrator:specialist_retry` event and a `BuildActivity` row recording it.
  A substantive block is not retried — re-running will not answer the question it
  asked.

The pre-dispatch engine-fallback path is untouched: it still governs *switching
engines* before side effects, which is a different and stricter question.

## Bias, stated deliberately

`classifyBlockedCause` resolves ambiguity toward `infrastructure`. Reading a
substantive block as infrastructure costs **one bounded re-dispatch**; reading
infrastructure as substantive **strands the build permanently**. The costs are
not symmetric, so neither is the classifier. There is a test asserting this
explicitly (a report that both implements a handler and mentions a test timeout
resolves to infrastructure).

## Evidence

```bash
pnpm --filter web exec vitest run lib/integrate/blocked-cause.test.ts lib/integrate/build-orchestrator.test.ts
```

19 new tests; the 56 existing build-orchestrator tests unchanged and green;
`tsc --noEmit` clean across the touched files.

## Not covered

`classifyOutcome` itself still returns a flat `BLOCKED` — the cause is consumed at
the dispatch site, not carried on `SpecialistOutcome`. Surfacing
infrastructure-vs-substantive in the build-complete message and the phase gate
(so an operator sees *which* kind of blocked they are looking at) is the natural
follow-on.
