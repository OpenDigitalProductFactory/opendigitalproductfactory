# BI-FE558C5C — Inngest executor-starvation watchdog

Backlog item: `BI-FE558C5C`  
Epic: `EP-B9DD37C7` — Coworker chat: runtime truthfulness, transparency & controls

## Current substrate

- `/api/inngest` is served by `apps/web/app/api/inngest/route.ts`.
- Portal boot already self-registers the function catalog from `apps/web/instrumentation.ts` and stores registration health in `apps/web/lib/queue/job-engine-health.ts`.
- Slice 1 exists as `apps/web/lib/queue/functions/inngest-retention-sweep.ts` and `apps/web/lib/operate/inngest-retention/run.ts`: it bounds Inngest history and reaps Redis-TTL orphan rows.
- `/platform/ai/runtime-health` already renders queue/runtime signals and is the right operator surface for this failure mode.

## Plan

1. Track executor traffic outside Inngest cron.
   - Wrap `/api/inngest` route handlers and record gateway hits, especially `POST` invocation hits, in `PlatformConfig`.
   - Keep this best-effort so health recording cannot break job dispatch.

2. Add a portal-side watchdog.
   - Evaluate from `instrumentation.ts` on a normal `setInterval`, not an Inngest cron.
   - Declare starvation when registration is healthy but no `/api/inngest` `POST` invocation has arrived within the threshold.
   - Keep fresh installs quiet until the first healthy registration is older than the threshold.

3. Recover only through the safe slice-1 mechanism.
   - On starvation, invoke `executeScheduledInngestRetentionSweep({ dryRun: false })` directly from the portal process.
   - Enforce a cooldown so the watchdog cannot hammer the Inngest database.
   - Do not add Redis `FLUSHALL`, container restart, or any destructive drain; those remain operator/capability-gated future work.

4. Surface the signal.
   - Extend `JobEngineHealth` with watchdog fields.
   - Add an operator-visible “Background job engine” panel to `/platform/ai/runtime-health`.

## Verification

- Unit-test the classifier, gateway recording, and watchdog recovery cooldown in `apps/web/lib/queue/job-engine-health.test.ts`.
- Run the targeted Vitest suite.
- Run source-local typecheck for `web`.
- Use PR CI as production-build evidence before merge.

## UX fit review

- Decision: fits-with-guardrails.
- Owning area: Platform.
- Route family: `/platform/ai/runtime-health`.
- Primary persona: founder/platform operator checking whether autonomous background work is alive.
- Navigation layer touched: no new navigation; one read-only status panel on the existing runtime-health page.
- Reuse/convergence: uses the page's existing token-based status-chip pattern; no new dashboard or component family.
- Source truth: `PlatformConfig` keys `ops.jobEngine.inngestRegistration` and `ops.jobEngine.inngestWatchdog`.
- Empty/failure behavior: fresh installs stay `unknown` until registration exists; degraded state names the missing executor POST and the safe recovery summary.
- AI boundary: no prompt-sending action added.
- Guardrail: the panel must not expose destructive drain/restart controls; the only automatic recovery is the existing non-destructive Inngest retention/orphan sweep.

## Rollback

Revert the route wrapper + `job-engine-health` additions. The existing boot registration health and scheduled retention sweep remain independently functional.
