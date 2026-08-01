# Plan — Attention Reach Layer P1 (BI-C7D25599)

Spec: `docs/superpowers/specs/2026-08-01-attention-reach-layer-design.md`
Kernel: DI-EFEB6002A5C5 · Work Capsule: WC-1CE601AC · Branch: `feat/attention-reach-layer`

One concern: **reach the owner off-site without letting any decision happen off the
authenticated surface.**

## Phase 1 — signed links (test-first)

1. `lib/attention/reach-link.ts` — `createReachLink` / `verifyReachLink`.
   - HMAC-SHA256 over a canonical JSON payload, base64url.
   - `timingSafeEqual` comparison; distinguishable failure reasons.
   - Secret throws when unset. No default.
2. Tests first: valid round trip; expired; tampered `itemId`; tampered `deepLink`;
   tampered signature; malformed input; missing secret throws.

## Phase 2 — risk-driven policy

3. `lib/attention/reach-policy.ts` — `planReach(item, bindings, now)`.
   - Composes `classifyOwnerAttentionLane` for risk; does not re-derive it.
   - `custodian` → no off-site send. `weekly-digest` → no individual send.
   - `hardFloor` → email earned even at routine urgency; `oneClickEligible: false`.
   - Returns the channel list intersected with verified/active bindings, reusing
     `selectCommunicationPlan` for the urgency ordering rather than duplicating it.
4. Tests: every `AttentionSource` classified; hard-floored sources never eligible;
   custodian/digest produce no send.

## Phase 3 — email adapter

5. `lib/communications/email-adapter.ts` — `CommunicationAdapter` for `email`,
   `interactive: false`, delegating to the Postmark client with an injected sender for test.
6. `lib/attention/reach-message.ts` — body composition. Outcome class + urgency + link only.
   Test asserts no business content leaks into the body.

## Phase 4 — landing route

7. `app/r/[token]/route.ts` — GET: verify → redirect. Invalid/expired → sign-in with a
   friendly reason. Unauthenticated → sign-in with `callbackUrl` preserving the item.

## Phase 5 — consolidation (~20%)

8. The secret-resolution + HMAC + `timingSafeEqual` triple now exists in
   `delegation-receipt.ts` and would be a second copy here. Extract one shared primitive
   (`lib/shared/hmac-token.ts`) and move both onto it rather than duplicating —
   the same drift the monitor-issue-writer extraction fixed last slice.

## Phase 6 — gates

Targeted vitest → repo typecheck → production build → docs → CI.
Migration: none expected (no schema change) — verify and state.

## Verification of the load-bearing property

A test must prove that for every hard-floored `AttentionSource`, no policy path and no
adapter capability combination yields an actionable message. That is the acceptance
criterion the kernel's negative score on the one-click option was protecting.
