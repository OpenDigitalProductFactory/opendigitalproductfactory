---
title: Claude Code assessor envelope
status: draft
backlogItem: BI-AE054B53
---

# Claude Code assessor envelope

**Backlog:** BI-AE054B53

**Workroom:** WC-416AC94B

**Status:** Draft. Implementation admission and immutable coverage are pending.

The owner moved the S5 coordinator assessment to the Claude Code subscription CLI. WWMD DI-B46C1B2A1671 chose exact `claude-sonnet-5` as the candidate, not as a qualified route. This plan adds the missing dispatch boundary. The approved [TAK-JSI issuance design](../specs/2026-11-25-tak-jsi-qualification-issuance-design.md) keeps assessment, issuance and activation separate. The [owned subscription evaluation design](../specs/2026-11-01-owned-subscription-evaluation-design.md) supplies a precedent for reserving before dispatch and retaining uncertain attempts. Its direct-API calibration path is not an assessor route.

## Acceptance

- AC-1: The server binds the exact approved host, owner-authenticated Claude Code subscription account, Claude Sonnet 5 model, independent assessor, frozen rubric and redacted synthetic evidence. A missing, changed or unreadable binding refuses before dispatch, with no API, paid overage or fallback.
- AC-2: Each admitted invocation runs at most one turn, with zero tools or inherited context and enforceable limits of 16k input and 2k output tokens. Reserve at most six calls per assessment, including smoke, retries and uncertain attempts. A retry cannot widen the budget or release uncertain capacity.
- AC-3: The governed nonproduction proof records the served CLI version, exact account/model, usage, disabled tools, one-turn and retry fences, and no fallback under refusal. Missing exact proof by Dec 21 holds Dec 28. No real assessment or issuance happens in this delivery.

## Contract and sequence

**CONTRACT-CLI-ASSESSOR:** One server-owned envelope binds a versioned rubric and redacted packet digest, independent assessor, exact installation and execution host, authenticated subscription account, model, and the existing Workroom/TaskRun. Unknown identity, plan headroom, usage or execution state is not an allow. A synthetic smoke attempt uses the same envelope and counts as one of six. Model flags are not authority.

1. **FLOW-CLI-ADMIT.** Before touching the CLI, validate the exact registered route and seat, the live subject/assessor separation, the synthetic packet projection and the full input allowance. Reuse the canonical provider choke point and existing Workroom/TaskRun attempt or checkpoint carrier. Verify that it can atomically reserve across retries and concurrent launches without creating a new usage ledger. Keep an uncertain reservation consumed. The reservation used by `subscription-calibration-execution.ts` is a precedent, not authority to use its API path. If the existing execution carrier cannot supply a current atomic bound, hold and return the design gap rather than count in process.
2. **FLOW-CLI-INVOKE.** Extend the existing `executor-drivers/claude/one-shot.ts` and `routing/cli-adapter.ts` only for the admitted envelope. Pin the exact model, use a fresh isolated CLI context, and prove zero tools, no inherited MCP, hooks, history or project context. Verify controls for one turn, no concealed retries and a request-side 2k output ceiling including charged thinking. The 16k input bound includes the rendered system/user payload and any added context, not just the redacted packet. Refuse before launch when either hard token limit is unproven. Reject route drift rather than entering an ordinary fallback chain. Do not add a DPF credential collection flow or pass an API key.
3. **FLOW-CLI-VERIFY.** First use deterministic no-network fixtures and affected package typecheck. Then verify the exact served version and owner-authenticated CLI using canonical nonproduction. After authorization for one synthetic smoke attempt, verify the accepted result and refusal path on that same pinned route. Observe attempts, tool count, total tokens, exact resolved model and account, and whether any fallback, tool call or paid overage occurred. Record structured receipts and usage totals without packet text, session transcripts or credentials. No real assessment, qualification writer, issuance or pilot wake is authorized.

## Verification

- **VERIFY-CLI-ADMIT:** A missing, changed or unreadable account, host, model, frozen rubric or approved packet refuses before the process launches. Run concurrency, seventh-attempt, uncertain-dispatch and retry cases against the existing reservation boundary. A new invocation cannot reset the assessment count.
- **VERIFY-CLI-INVOKE:** Add failing tests before changes beside `routing/cli-adapter.test.ts` and the Claude driver tests. Cover exact model, empty tool surface, neutral context, no fallback on both quota and auth refusal, bounded retries, and one turn. Exercise a request that would exceed input limits and one that tries to exhaust output. Reject post-hoc truncation as proof of an enforced cap.
- **VERIFY-CLI-SERVED:** Verify the current native CLI/account discovery, entitlement and included plan allowance before the smoke. The platform's generic Claude account discovery uses HTTP, so it is not this verification path. Require one real synthetic served receipt that proves request-side limits, exact provider/model and zero hidden retries or tools. Record the pin and the before/after plan-usage observation. If limits, settlement or headroom are missing or unprovable, mark held rather than accepting a fixture or allowing a substitute.

## Schedule and rollback

- Dec 11 target for reviewed source, red-to-green focused tests and an exact integrated gate. Ask the coordinator for the full local gate slot before running it.
- Dec 18 target for the served, isolated synthetic proof on the owner's approved CLI account.
- Dec 21 deadline for accepted route proof and current plan headroom. A miss holds Dec 28. The assessment itself needs separate owner approval.

The existing neutral CLI adapter serves other callers. Keep the stricter behavior opt-in only from server-owned assessor admission and do not change those callers' defaults. Roll back by closing the assessor route, retaining reserved attempts and verification evidence. Never restore the direct API or ordinary CLI as fallback.

## Backlog coverage

One atomic deliverable, the exact bounded CLI assessor route, belongs to BI-AE054B53. Admission, invocation and served evidence follow each other and cannot be accepted independently. Traceability is AC-1 through AC-3, CONTRACT-CLI-ASSESSOR, FLOW-CLI-ADMIT, FLOW-CLI-INVOKE and FLOW-CLI-VERIFY, and the three corresponding verification entries. The independent issuer remains BI-6DB95601. A live plan-coverage receipt is owed once this draft resolves to an immutable provider artifact. No receipt is claimed here.
