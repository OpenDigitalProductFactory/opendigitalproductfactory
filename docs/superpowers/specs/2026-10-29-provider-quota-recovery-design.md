---
status: draft
---

# Provider quota recovery and visible reset options

Backlog: BI-D81CCC24. Parent outcome: BI-C5E51A15. Workroom: WC-2CCBB706.
This extends the existing [account quota reconciliation design](2026-10-14-provider-quota-revalidation-design.md), not its completed historical assurance.

## Objective and evidence

**OBJ-1:** The operator can see which limit blocks an account, when that evidence was observed, its expected reset, and the next supported recovery action.
**OBJ-2:** A bounded fresh inference observation can restore its own eligible channel before a distant recorded reset, without clearing another account, transport or independent restriction.
**OBJ-3:** Routine recovery is autonomous under its recorded commission; finite-use reset redemption and genuine authority changes remain separate decisions.

On 2026-10-29 the owner reported early limit releases and hidden reset offers. An authorized account test completed, but the provider page retained both shared-pool and provider-capacity holds. Existing `test` deliberately uses `verificationOnly`; its successful snapshot check does not reconcile quota. That contract remains unchanged. A normal COO turn separately excluded preferred models for missing streaming capability; BI-AF6DDF01 owns that repair. Successful authentication, model quality and routing eligibility are separate facts.

Official sources consulted 2026-10-29:
- [Codex resets](https://help.openai.com/en/articles/20001498-how-resets-work-in-codex): banked, automatic and paid resets differ; availability and coverage vary. Usage settings report the current reset date and expiry; model or feature allowances can remain separate. DPF neither redeems an offer nor purchases one.
- [Claude limit resets](https://support.claude.com/en/articles/17007452-what-is-a-limit-reset): occasional eligible offers can reset session or weekly allocation; expiry may apply; redemption is irreversible and occurs in provider Usage settings.
- [Claude API limits](https://platform.claude.com/docs/en/api/rate-limits): rate windows and API spending caps differ. Subscription offers do not prove a changed API spending cap.

## Existing substrate and decision

Reuse the existing provider account, capacity observation, credential-revision hash, CLI pool, ScheduledJob, governed provider-management operation, strict Responses completion validator, account overview/detail and canonical conditional reconciliation. No new table, credential store, provider, inference route, billing allowance or automatic reset redemption.

Keep ordinary connection `test` verification-only. Add an explicit quota-recheck operation to the existing account-management contract because restoring routing is a different effect from checking authentication. Both the portal action and MCP operation call one bounded server implementation. It is admitted through existing account capabilities and governance, with exact account identity. No actor-name exemption or relaxed explicit-always policy.

The request uses a fixed synthetic prompt, a supported current model, bounded response/timeout, no business transcript or tools, and existing spend/privacy controls. An unknown result never authorizes replay of original coworker work.

### CT-QUOTA-OBSERVATION: current channel proof

Capture the selected active install-owned default subscription account, credential revision and relevant quota generations before dispatch. Check the same account/credential again before the request and transaction. Preserve operator pause/disable/disconnect, authentication/billing/terms/grants restrictions and newer observations. A completed response alone is not full routing acceptance.

Keep broad provider and CLI quota observations intact: success on one model is not evidence that every model's allocation recovered. Reconcile the selected candidate through its own current, bounded verification evidence. An account cannot clear another provider's quota by alias. In particular, a ChatGPT Responses completion cannot clear the Codex CLI pool.

Where conservative shared quota projections would otherwise reapply an older sibling forecast, a newer exact-account, credential-bound successful Responses observation can qualify only the actually tested model on the same endpoint and execution contract. It does not establish separate budgets or CLI availability, or prove another model's allocation. Bind evidence to the current model/catalog and endpoint identity; a changed model, endpoint or contract cannot borrow it. A later applicable failure defeats the older success. Unknown ownership, stale credentials, missing evidence and simultaneous non-quota vetoes remain restrictions. This projection must be shared by routing and provider UI, not implemented as a page-only green label.

The existing account-scoped `ProviderCapacityStatus` already owns successful availability and credential-revision evidence. Its columns cannot bind that result to model/catalog/endpoint identity. `AdapterRunTelemetry` lacks account/credential generation, while `RouteOutcome` lacks endpoint/credential generation. Extend the existing capacity row with one nullable, strictly validated execution-proof payload rather than create another ledger or parse human summaries as authority. Legacy/null/malformed proof grants nothing. Store only fixed identifiers, one-way configuration/revision fingerprints, observation time and captured quota-generation fingerprints; no credentials, business prompt or raw provider body. Retain the existing model's confidentiality and lifecycle. The migration is additive/nullable and requires no data rewrite.

The inspected canonical writer separates account health from provider-scoped quota: it creates owned-account rows for availability and account authentication/billing/plan health, and writes quota to the provider scope. An owned-account row carrying a quota state is therefore an unsupported ownership shape for this recheck, not proof it cannot exist in live data. Detect it before dispatch or any write, retain it byte-for-byte, and return an explicit reconciliation-needed result. A legacy or concurrent unsupported row must never be converted to available by persisting proof. Add a real PostgreSQL regression with that row and assert zero probe/zero writes and unchanged provider/CLI observations; retain a positive supported-shape test. This is a bounded refusal contract, not permission to invent a second capacity dimension, normalize live ownership or add a tightening schema constraint without the separate data-architecture review.

Bound proof to the existing `accountExecutionVersion` plus credential revision, exact model profile revision, adapter/endpoint fingerprint and current captured shared-quota generations. A fresh proof can qualify its selected candidate for at most the hourly recheck interval; it does not guarantee the next request will succeed. An account, credential, model, endpoint or applicable quota-generation change invalidates it. Compare generations before committing proof; concurrent/later failures remain effective. Ordinary success cannot renew proof age or bindings. A still-current proof keeps its original expiry; stale or changed proof grants nothing. Ordinary failures invalidate it.

### CT-RECOVERY-COMMISSION: bounded early rechecks

Reuse the durable scheduler for the already-requested hourly subscription-recovery commission. Check only eligible active install-owned default subscription accounts with quota observations; serialize the sweep, bound its batch and requests, and record last attempt/result without a recurring owner approval. Respect a current short Retry-After. Distant weekly forecasts may be revalidated hourly; no fixed-date busy loop. Do not activate paused accounts, reset financial caps, redeem offers, broaden trust or infer CLI recovery from a Responses result. Persist uncertainty as uncertainty and retain the execution identity.

The existing account operation explicitly records its optional hourly commission on the existing per-account ScheduledJob. Omission preserves an existing commission or performs a one-off check. Viewing a page never commissions inference, and other installs gain no automatic opt-in. The existing serialized subscription-maintenance cron wakes only due, enabled commissions; it sends at most two checks per sweep and never checks a paused account. A per-account conditional job claim prevents overlapping clicks and retries. Stopping hourly recovery does not claim capacity recovery or replay an old check.

`Check now` explicitly sends one bounded observation and may also set the future hourly preference. A separate stop-only operation on the same account-management tool, and a matching contextual UI action, stop its existing commission without any inference request. Stopping works for paused or disconnected accounts. It cannot create a commission, activate an account or broaden any permission. The handler and consequence refinement verify the exact existing default subscription account/job; explicit-always policy and current capability checks remain authoritative. Interactive checks have a short duplicate-click cooldown independent of the hourly sweep, so a person can confirm an early provider reset without waiting for the next routine sweep. Current short provider waits remain authoritative.

### CT-RECOVERY-VIEW: useful evidence and actions

Extend the existing provider account view instead of adding a dashboard. Show session/short-window, weekly/shared subscription and API spend restrictions distinctly when evidence identifies them; otherwise label the limit unknown. Show last observation and source, expected reset in the operator locale, and check-again result separately from authentication.

Expose the provider Usage page for supported reset offers. Since the inspected supported contracts expose no authoritative reset-offer feed, show availability as unknown rather than claiming no offer. Explain the provider can offer an early reset and show its expiry only when actually observed. Opening Usage or checking capacity never consumes a reset. Redemption remains an explicit finite-use owner action; no provider credential is entered by an agent.

## Failure and verification cases

FLOW-RECHECK: exact account → admission/current snapshot → bounded synthetic inference → strict completion → conditional reconciliation → shared routing/UI readback.
FLOW-HOURLY: recorded commission → eligible quota candidates → per-account bounded observation → durable result/backoff; unchanged routine outcomes remain technical history.
FLOW-RESET: account restriction → provider Usage link → owner-controlled reset → explicit recheck → actual routing evidence.

VERIFY-ISOLATION covers foreign/changed credentials, manual pause, billing/auth holds, missing/non-quota rows, concurrent newer quota, incomplete output, network/timeout, uncertain settlement, shared CLI versus Responses independence, model-specific limits and changed catalog/endpoint/contract identity. VERIFY-RECOVERY covers real old-hold/new-success/late-failure ordering and actual PostgreSQL predicates. VERIFY-UI covers light/dark, desktop/mobile, keyboard, unknown evidence, localized times and safe external Usage links, with one dominant hold/action and secondary evidence disclosed. VERIFY-LIVE requires canonical deployment and fresh observed account/coworker/watch results for the actual pinned model (including COO gpt-6.1-sol), not an arbitrary cheap model; source tests cannot supply this acceptance.

Served verification extends the existing UX Route Sweep runtime and scoped fixture pattern through `apps/web/scripts/provider-quota-recovery-{fixtures,verification}.ts`. Bind fixtures to the admitted nonproduction/CI target; preserve its existing privacy, memory and timeout limits. Cover supported model success, failed/unknown check, account pause, stop-only behavior, retained broad holds, reset availability unknown, current proof, desktop/mobile, light/dark and keyboard. UI fixtures are not actual provider-capacity acceptance. Capture real rendered states for the completed UX Critic contribution; use the existing account route and record measurement provenance rather than fabricated budget values.

## Scope and rollback

Existing consultation error handling and account readiness are reused; independently owned streaming/quality corrections are not copied here. Revert the scoped source through protected PR delivery if needed, preserving existing observations and audit history. Pause the same recovery commission through supported controls if verification is inconclusive. Never clear quota rows manually or replay unsettled original work.
