# Attention Surface — keystone + triage implementation

| Field | Value |
| ----- | ----- |
| Status | **Implemented in this branch** (keystone BI-D39484E7 + triage model BI-61B9EB88). Verified: `pnpm --filter web typecheck` clean, 40 vitest tests green, route-manifest regenerated. |
| Date | 2026-06-23 |
| Spec | [2026-06-23 human attention surface design](../specs/2026-06-23-human-attention-surface-design.md) (§4, §4.4, §6) |
| Epic | `EP-ATTENTION-SURFACE` |
| Delivers | BI-D39484E7 (keystone), BI-61B9EB88 (triage model) |

## What shipped

The decisions plane (escalations / AI-decision residue / paused-AI / agent-proposals) is now a single **"Needs you"** inbox on `/workspace`, separate from the `/ops` work backlog, kernels-first and triaged — with **no composite priority score** (the #2315 discipline applied to ranking).

### Pure core (`apps/web/lib/attention/`)
- `types.ts` — `AttentionItem` projector contract incl. `triage{}` (time-to-act, residue-reason, blast-radius, decide-effort, irreversible). No persisted entity, no priority number.
- `triage.ts` — the tiered order: **override tier** (hard-deadline-imminent OR irreversible-high-risk, shown with reason) → time-to-act → risk → blast → age (FIFO). Pure; reuses the `command-center` rank idiom. Plus explainability helpers (`orderReason`, residue/risk/effort labels, `attentionAgeLabel`, `timeToActFromDeadline`).
- `sources/{escalation,ai-decision,paused-ai,agent-proposal}.ts` — pure mappers + loaders over the verified source models. **All four are `unscorable` residue** (the kernel already could not decide them) → honest facts, never a 0.000 ledger.
- `aggregate.ts` — `Promise.all` fan-out, tiered ordering, audience filter; a failing source degrades to `failedSources` (never a blank inbox).

### Surface
- `components/attention/{AttentionInbox,NeedsYouBand}.tsx` — full inbox + first-viewport band (renders nothing when empty); theme tokens only; "why it's here / what's blocked" context per row; "Pinned · reason" affordance for the override tier.
- `app/(shell)/workspace/inbox/page.tsx` — the full queue (operator-view V1).
- `app/(shell)/workspace/page.tsx` — `<NeedsYouBand/>` wired into the first viewport.
- `lib/navigation/portal-navigation-model.ts` — `/workspace/inbox` as a **workspace-section sibling** (no new rail destination, no cross-section teleport); route-manifest regenerated.

### Re-home
- `app/(shell)/ops/page.tsx` — the escalation band is **removed from `/ops`** (it now projects into the inbox via the `escalation` source). `runEscalationHygiene` (auto-resolve) stays; `/ops` is work-only.

## Tests (40, green)
- `triage.test.ts` — override tier, tiered ordering, FIFO tie-break, determinism, `orderReason`, deadline mapping, age labels.
- `sources/sources.test.ts` — each mapper: residue reason, risk mapping, unscorable, irreversible-high-risk pause, auth-required ≠ judgment.
- `aggregate.test.ts` — fan-out collection + ordering, failing-source degradation, operator vs worker audience scoping.

## Verification
- `pnpm --filter web typecheck` — 0 errors.
- `pnpm --filter web exec vitest run lib/attention` — 3 files, 40 tests pass.
- `pnpm --filter web build:route-manifest` — 508 routes, `/workspace/inbox` present.

## Not in this slice (the remaining filed BIs)
- BI-04ECEE9F (`decisionClass.scorability` routing tag + 0.000-guard test for kernel-scorable build decisions) — the keystone sources are all unscorable, so this lands with the first kernel-scorable source.
- BI-094A124F (`Notification`/`HitlNotificationEvent` spine + badge + SSE).
- BI-8EA88797 (finance/business adapters: outbound/bill/expense/compliance/research — these carry real deadlines, exercising the override tier + worker audience scoping).
- BI-C7D25599 (email/message channel), BI-7D99B25C (record-outcome write-back), BI-C1B96972 (trust-dial overview).

## Notes
- V1 is operator-view, consistent with the command-center already on `/workspace`; worker scoping (the `audience` field + `filterAttentionForAudience` are in place and tested) wires up with the finance adapters (BI-8EA88797).
- `components/ops/EscalationsAttention.tsx` is now unused on `/ops` (kept, not deleted — it may compose into the inbox's escalation row later).
- `paused-ai` deep-links to `/platform/ai/operations-map` until `/platform/ai/paused-work` lands; `agent-proposal` deep-links to `/platform/ai` (no governance UI exists yet).
