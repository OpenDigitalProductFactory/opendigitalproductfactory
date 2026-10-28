---
status: active
backlog_item: BI-24092DC9
workroom: WC-1966F6F3
---

# AI-capacity watch and issue-report signature dedup (fix design)

| | |
|---|---|
| Date | 2026-10-27 |
| Backlog / Workroom | BI-24092DC9 / WC-1966F6F3 |
| Profile | fix (ordered deliverables live here; no separate plan) |
| WWMD | DI-BA01CDC705DB (host and surface), DI-E5208C7D1666 (window and thresholds, agent override of a near-tie), DI-80DB1197D7E4 (absorb intake dedup) |
| Builds on | BI-A53C594E / PR #6680 (subscription OAuth renewal and its Needs-you item), PR #6679 (Codex usage limit as quota), BI-ADB574AB (monitor-clears rows), the issue-report reach gate (`lib/quality/issue-report-promotion.ts`) |
| Leaves to | BI-AE428731, BI-02A513D1, BI-DDDC8E9D (providers page status, per-provider classification) |

## Defect

Reproduced on `027053263fe`:

- Nothing measures usable AI capacity. On 10-27 the hourly served share of `AdapterRunTelemetry` sat at 2-15% for 24 hours. No attention item, notification or monitor row named it.
- The issue-report intake (`apps/web/lib/operate/issue-report-triage.ts`) dedups only by title, and the LLM rewrites titles. 392 open `BI-PIR-*` items trace to a report with a `dedupeKey`, but they have only 174 distinct signatures. 111 reports were each minted twice or more: the 15-minute sweep and the immediate projection event both select the same OPEN report while the LLM call runs.

## Deliverables, in order

1. **Capacity watch** (`apps/web/lib/routing/ai-capacity-watch.ts`). Pure `assessAiCapacity` over a 30-minute window. Served means success or refusal. Failed means error or timeout. Cancelled and policy-block are not counted. A provider with at least 5 calls and none served is a total failure; its cause is one of sign-in, usage limit (with reset), spend limit, no credentials, local engine overloaded, or failing for an unknown reason. Platform collapse means at least 10 calls with under 50% served. If a row's provider got no calls this window, the row is held, not resolved.
2. **Monitor rows**: new registered `ai_capacity_loss` monitor-clears type in `packages/db/src/quality-issue-registry.ts`, written through `monitor-issue-writer`. Absent-clean resolves recovered rows. Only newly opened rows push a bell notification.
3. **Host**: a `watch-ai-capacity` step in the existing 5-minute `ops/alert-delivery-bridge` cron. It is a separate step, so it runs even when both alert evaluators are unreachable.
4. **Needs-you projection** (`apps/web/lib/attention/sources/ai-capacity.ts`), loaded from the platform-health lane. Each cycle the watch records on the row whether the provider-credential lane already shows a reconnect item for that provider. If it does, the projection drops the sign-in or no-credential row, so the operator sees one item.
5. **Intake dedup**: minted items carry `Signature: <dedupeKey>` and `Source report: <id>`. Before the LLM runs, and again right before minting, a live bug item with the same report or signature is looked up. Earlier reports with the same `dedupeKey` are included, so legacy items are found too. A match goes through `incrementOccurrence`, which bumps the tally and raises priority. The report is claimed atomically (`updateMany` on OPEN) before minting and released if minting fails.
6. **Docs**: user guide (`docs/user-guide/ai-workforce/connecting-providers.md`) and `docs/operations/observability-coverage.md`.

## Not in this change

- Self-repair actions stay with their owners: background OAuth renewal is #6680, and usage-limit reclassification is #6679. The watch reports what is still failing after those mechanisms have acted.
- The credential-coverage check in deliverable 4 reads the provider-credential lane through its own loader, so the #6680 sign-in-required renewal lane is included.
- The providers page's "Routable / No action needed" status belongs to BI-AE428731.

## Verification

- `apps/web/lib/routing/ai-capacity-watch.test.ts`: a total-failure provider raises exactly one row and pushes one notification; recovery clears it; a capacity collapse raises the platform row; the held and inactive cases.
- `apps/web/lib/attention/sources/ai-capacity.test.ts`: the projection, and a single item per provider.
- `apps/web/lib/operate/issue-report-triage.test.ts` (signature dedup suite): a duplicate signature mints no BI; the race re-check; the claim and its release.
