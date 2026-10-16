---
status: active
---
# Provider readiness repair

Backlog: BI-2ECA4E9C. Workroom WC-01B6B6AF. Prototype: [interactive account states](2026-10-15-provider-readiness.html).

## Evidence and scope

Source base b338f06e581e6cc7886c334b519f098feb142865. `AgentCoworkerShell` ignores a resolved unsuccessful consultation result. Regression changes the existing denial test to return the real result union: 19 tests pass, that test fails because the last message remains “Provider review requested”. This proves a client contract defect, not the cause of every provider inference failure. The screenshot's subsequent question reports no available model; do not conflate that with a failed handoff.

Read-only live PostgreSQL observations: ChatGPT rate_limited retry October 20, last observed October 14; Codex quota_resets_at retry October 20, last observed October 13. Both have usable saved credentials. CLI pool backoff caps at an hour, but the separate persistent quota still blocks until its distant reset. No durable quota revalidation worker exists on this ref. Existing `providerRecovery` handles automatically disabled auth/billing; `rateRecovery` restores model grading, neither revalidates these quota rows. Preserve all independent holds.

## Design grounding

Extend existing provider-capacity-recovery (2026-06-29), provider routing setup (2026-07-26), provider pause (2026-10-11), account-scoped health and active-account verification. Reuse ProviderAccountsOverview, StatusBadge/DataTable/FilterBar, provider-account overview loader, capacity store CAS, bounded Responses readiness probe, scheduled-job catalog and durable queue. No new table, navigation entry, credential owner, or parallel health registry. Primary persona: founder/operator on `/platform/ai/providers`. Scope is platform administration. Health never confers company-data permission.

## Research & Benchmarking

- [LiteLLM routing](https://docs.litellm.ai/docs/routing): adopt bounded cooldown and exclusion of failed deployments; reject treating a timer as proof of successful recovery. Its deployment cooldown differs from account configuration.
- [Grafana state and health](https://grafana.com/docs/grafana/latest/alerting/fundamentals/alert-rule-evaluation/alert-rule-state-and-health/): adopt explicit separation of evaluation health and configured state; reject coloring missing observations green.
- [Portkey gateway](https://portkey.ai/buyers-guide/ai-gateway-solutions): benchmark provider health and circuit-breaker visibility, without adopting another gateway dependency.
- [AWS CloudWatch alarm states](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html): adopt explicit insufficient-data distinction; reject unexplained red/green color alone.

No external dependency is introduced. Prototype represents proposed states, not observed live account health. UX advisory requested as CE-9A18E31A. MCDA favored status-first over a second dashboard but returned low confidence due sparse feature evidence; this is advisory, not a gate receipt. Existing explicit operator direction authorizes this bounded status design.

## Ordered implementation

1. Handle structured consultation failures; preserve deterministic delivered fallback, expose actionable failure otherwise, and allow a later retry.
2. Refactor overview status derivation into a pure account-scoped projection. Strong badge plus reason distinguishes configured/ready, temporary wait/operator pause, hard credential/billing failure and unavailable evidence. Show recent success only when account evidence proves it. Keep allowed work separate. Move model detail into disclosure and reduce repeated copy/actions.
3. Reuse verification-only subscription inference and canonical quota CAS in an hourly durable worker for active install-owned default ChatGPT/Codex accounts with quota holds. Preserve credentials, lifecycle, manual pauses and concurrent newer restrictions. Timestamp attempts durably so restarts do not storm. Failed/incomplete inference never clears a hold. Recheck each provider path separately; never infer sibling health from a shared sign-in.
4. Run focused tests, package typecheck, governed build gate and served dark/light, mobile, keyboard checks. Record measured UX evidence. No live “fixed” claim before deployment and actual request evidence.

## Acceptance

- AC-1: Consultation returns an acknowledgement, a delivered advisory, or one actionable failure; structured refusal cannot silently succeed.
- AC-2: Status-first overview uses canonical semantics, neutral uncertainty, explicit allowed work and account-specific recovery facts.
- AC-3: Hourly subscription checks may discover recovery before provider reset; only completed inference and unchanged ownership clear the matching quota.
- AC-4: Paused, disabled, disconnected and hard credential/billing cases are never automatically enabled by quota recovery.
- AC-5: Verification covers refusal, incomplete streams, concurrent changes and preserved independent restrictions; served UI checked before completion.

Refactoring allocation: at least 20% of this repair consolidates account status presentation and reuses existing verification/CAS rather than adding alternate provider state. No runtime install files are changed.

## Failure analysis and verification

### Native quota observation while execution remains held

October 16 occurrence: native review task ending `99B4B339F227` reported a structured quota error while its remote effects remained unverified. Both provider capacity and CLI cooldown retained an expired October 15 observation. At served commit c38edb55c0d, native error paths throw execution uncertainty before the existing quota recorder. This is independent of settling or retrying that task.

Extend AC-3 and AC-5 using the existing adapter error boundary: only a validated terminal result with error status, explicit error flag and quota hint records a fixed safe usage-limit observation. Await the existing recorder once with the execution plan's actual CLI pool identity; retain canonical conservative quota sharing. The provider reset remains unknown and the existing bounded heuristic backoff applies. Never persist raw stdout, infer credential lineage, clear the execution hold, fall back within this execution, or retry its original work. Persistence failure must preserve the same uncertainty error.

Ordered verification: reproduce both exit-zero and nonzero native quota misses; implement the common error-boundary observer; reject malformed, successful and nonquota evidence; verify recorder failure leaves the hold; exercise canonical bounded pool/capacity writes and future routing to a permitted alternative. No provider probe, new task, schema, lifecycle or permission change is required. Independent review, exact-tree gates and actual deployment remain separate requirements.

People affected: operators choosing provider accounts and coworkers waiting for inference. A misleading green can send work to an unusable connection; a stale red/wait can waste recovered capacity.

- Refused consultation: returned failure is handled, queued success is acknowledged, deterministic delivered advice is retained. Regression failed before the patch and passed after. Network failures remain explicit; a specialist task that later fails retains its existing runtime handling.
- Stale quota success: the worker locks account and credential ownership and the existing quota CAS checks observation version. Paused/replaced accounts and newer restrictions prevent stale clearing. Incomplete or unsuccessful inference leaves quota unchanged. A new auth/billing response creates account-scoped hard health and prevents subsequent probes.
- Restart or concurrent tick: claim and next-attempt time persist before network I/O. A lost result may delay recovery by an hour; it cannot cause unbounded retries. The queue serializes the sweep. No lifecycle or permission is broadened.
- Unknown telemetry: neutral status remains explicit. Green enabled is configuration, while Working requires recent successful evidence from the selected account. Shared success is not borrowed. Company-data allowance remains independent.

Observed live verification on October 15 (America/Chicago): both ChatGPT and Codex completed their existing governed verification requests before October20 reset estimates, yet neither existing persistent quota hold changed. This confirms that response success and routing-state reconciliation are separate concerns. The new worker must be deployed and exercised before claiming live recovery.

Source-local evidence: affected production and test TypeScript programs passed; 82 focused tests passed before final hard-failure coverage, and the later focused verification run passed 74 tests including the provider-auth suite and hard-failure stop case. These counts overlap and are not a combined total. Local gate checks required design-grounding path correction and module-size reduction; neither initial failure was hidden. Shared merged build, semantic review and served acceptance remain required.
